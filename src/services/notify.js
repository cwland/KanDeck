/**
 * Real-time notifications — a Discord ping when a card enters a board's notify
 * column (default: Done), using the same settings-driven Discord config as the
 * scheduled summaries. Also starts the summary scheduler (email + Discord).
 *
 * The periodic email/Discord summaries live in ./notify/.
 */
import { events } from '../events.js';
import * as boards from '../storage/boards.js';
import { getNotificationConfig } from '../storage/settings.js';
import { startScheduler } from './notify/index.js';
import * as discordProvider from './notify/discord.js';

export function startNotifications() {
  // Card-moved ping: Discord message when a card enters a board's notify column.
  events.on('card:moved', async ({ boardId, card, toColumn }) => {
    if (!toColumn) return;
    const board = await boards.getBoard(boardId);
    if (!board) return;
    const notifyCol = board.settings.notifyColumn || 'Done';
    if (toColumn.name.toLowerCase() !== notifyCol.toLowerCase()) return;
    const cfg = await getNotificationConfig();
    if (cfg.discord.enabled && cfg.discord.webhookUrl) {
      await discordProvider.send(cfg.discord.webhookUrl, {
        content: `✅ **${card.subject}** moved to **${toColumn.name}** on *${board.name}*`,
      }).catch((e) => console.error('[notify] move ping', e.message));
    }
  });

  // Configurable, settings-driven task summaries (email + Discord).
  startScheduler();

  console.log('[notify] engine started (summaries + card-moved pings).');
}
