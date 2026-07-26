/**
 * Real-time notification engine — per-card alarms and card-moved pings.
 *
 * Consolidated onto the same settings-driven config as the scheduled summaries
 * (App Settings → Notifications): the email connection and Discord webhook come
 * from settings, not env vars. Alarms/pings fire only when the matching channel
 * is enabled and configured.
 *
 *   - Alarm trigger: when a card's alarm is on and its due time is reached,
 *     email + Discord the reminder once (sets alarmSent).
 *   - Card-moved ping: Discord message when a card enters a board's notify
 *     column (default: Done).
 *
 * The periodic email/Discord summaries live in ./notify/ and are started here.
 */
import cron from 'node-cron';
import { events } from '../events.js';
import * as boards from '../storage/boards.js';
import { getPriorities, getNotificationConfig } from '../storage/settings.js';
import { startScheduler } from './notify/index.js';
import * as emailProvider from './notify/email.js';
import * as discordProvider from './notify/discord.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// Category color (from settings) as a Discord embed int, matching the board.
function priorityHex(prios, id) {
  const p = (prios || []).find((x) => x.id === id);
  let c = String((p && p.color) || '#868e96').replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const n = parseInt(c, 16);
  return Number.isNaN(n) ? 0x868e96 : n;
}

/** Fire due alarms. Called on a 1-minute cron. */
export async function checkAlarms(now = new Date()) {
  const fired = [];
  const due = (await boards.allCards()).filter(
    ({ card }) => card.alarm && !card.alarmSent && card.dueDate && new Date(card.dueDate) <= now
  );
  if (!due.length) return fired;

  const cfg = await getNotificationConfig();
  const prios = await getPriorities().catch(() => []);

  for (const { board, col, card } of due) {
    const when = new Date(card.dueDate).toLocaleString();
    if (cfg.discord.enabled && cfg.discord.webhookUrl) {
      await discordProvider.send(cfg.discord.webhookUrl, {
        embeds: [{
          title: `⏰ ${card.subject}`.slice(0, 256),
          description: (card.description || 'Reminder').slice(0, 300),
          color: priorityHex(prios, card.priority),
          fields: [
            { name: 'Board', value: board.name, inline: true },
            { name: 'Column', value: col.name, inline: true },
            { name: 'Due', value: when, inline: true },
          ],
        }],
      }).catch((e) => console.error('[notify] alarm discord', e.message));
    }
    if (cfg.email.enabled && cfg.email.host && cfg.email.to) {
      const html =
        `<h2>${esc(card.subject)}</h2><p>${esc(card.description || '')}</p>` +
        `<p><b>Board:</b> ${esc(board.name)} — <b>Column:</b> ${esc(col.name)}<br>` +
        `<b>Due:</b> ${esc(when)}</p>`;
      await emailProvider.send(cfg.email, { subject: `⏰ Reminder: ${card.subject}`, html })
        .catch((e) => console.error('[notify] alarm email', e.message));
    }
    await boards.updateCard(board.id, card.id, { alarmSent: true }); // fire once
    fired.push(card.id);
  }
  return fired;
}

// ---- Wire it all up --------------------------------------------------------

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

  // Alarm scan every minute (per-card alarms — distinct from summaries).
  cron.schedule('* * * * *', () => checkAlarms().catch((e) => console.error('[notify] alarm', e)));

  // Configurable, settings-driven task summaries (email + Discord).
  startScheduler();

  console.log('[notify] engine started (alarms + configurable summaries).');
}
