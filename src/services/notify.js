/**
 * Notification & alert engine (spec 2.6 + rec #3).
 *   - Channels: SMTP email (nodemailer) + Discord webhooks.
 *   - Daily digest: tasks due within the current week.
 *   - Alarm trigger: real-time alert when a card's alarm is on and its due
 *     time is reached (fires once; sets alarmSent).
 *   - Webhook-on-move: outgoing Discord ping when a card moves to a board's
 *     configured "notify" column (default: Done).
 */
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import config from '../config.js';
import { events } from '../events.js';
import * as boards from '../storage/boards.js';
import { listJson } from '../storage/store.js';
import { startScheduler } from './notify/index.js';

let transporter = null;
function mailer() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

async function sendEmail(subject, html) {
  const t = mailer();
  if (!t || !config.smtp.to) return false;
  await t.sendMail({ from: config.smtp.from, to: config.smtp.to, subject, html });
  return true;
}

async function sendDiscord(payload, url = config.discordWebhookUrl) {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    console.error('[notify] discord error', e.message);
    return false;
  }
}

const PRIORITY_HEX = { urgent: 0xe03131, high: 0xf76707, medium: 0xf59f00, low: 0x4dabf7, none: 0x868e96 };

// ---- Alarm + digest scanning ----------------------------------------------

async function allCards() {
  const ids = (await listJson(config.boardsDir)).filter((id) => id !== '_index');
  const out = [];
  for (const id of ids) {
    const board = await boards.getBoard(id);
    if (!board) continue;
    for (const col of board.columns)
      for (const card of col.cards)
        if (!card.archived) out.push({ board, col, card });
  }
  return out;
}

/** Fire due alarms. Called on a 1-minute cron. */
export async function checkAlarms(now = new Date()) {
  const fired = [];
  for (const { board, col, card } of await allCards()) {
    if (!card.alarm || card.alarmSent || !card.dueDate) continue;
    if (new Date(card.dueDate) <= now) {
      await sendDiscord({
        embeds: [{
          title: `⏰ ${card.subject}`,
          description: card.description?.slice(0, 300) || 'Reminder',
          color: PRIORITY_HEX[card.priority] ?? PRIORITY_HEX.none,
          fields: [
            { name: 'Board', value: board.name, inline: true },
            { name: 'Column', value: col.name, inline: true },
            { name: 'Due', value: new Date(card.dueDate).toLocaleString(), inline: true },
          ],
        }],
      });
      await sendEmail(
        `⏰ Reminder: ${card.subject}`,
        `<h2>${card.subject}</h2><p>${card.description || ''}</p>` +
          `<p><b>Board:</b> ${board.name} — <b>Column:</b> ${col.name}<br>` +
          `<b>Due:</b> ${new Date(card.dueDate).toLocaleString()}</p>`
      );
      await boards.updateCard(board.id, card.id, { alarmSent: true }); // fire once
      fired.push(card.id);
    }
  }
  return fired;
}

/** Daily digest of tasks due within the current week. */
export async function sendDigest(now = new Date()) {
  const weekEnd = new Date(now.getTime() + 7 * 864e5);
  const due = (await allCards())
    .filter(({ card }) => card.dueDate && new Date(card.dueDate) <= weekEnd)
    .sort((a, b) => new Date(a.card.dueDate) - new Date(b.card.dueDate));
  if (due.length === 0) return { sent: false, count: 0 };

  const rows = due
    .map(({ board, col, card }) => {
      const overdue = new Date(card.dueDate) < now;
      return `<tr><td>${overdue ? '⚠️ ' : ''}${card.subject}</td><td>${board.name}</td><td>${col.name}</td><td>${new Date(card.dueDate).toLocaleString()}</td></tr>`;
    })
    .join('');
  await sendEmail(
    `KanDeck — ${due.length} task(s) due this week`,
    `<h2>Tasks due this week</h2><table border="1" cellpadding="6" cellspacing="0">` +
      `<tr><th>Task</th><th>Board</th><th>Column</th><th>Due</th></tr>${rows}</table>`
  );
  await sendDiscord({
    content: `📋 **Daily digest** — ${due.length} task(s) due this week`,
    embeds: due.slice(0, 10).map(({ board, col, card }) => ({
      title: card.subject,
      color: PRIORITY_HEX[card.priority] ?? PRIORITY_HEX.none,
      fields: [
        { name: 'Board', value: board.name, inline: true },
        { name: 'Due', value: new Date(card.dueDate).toLocaleString(), inline: true },
      ],
    })),
  });
  return { sent: true, count: due.length };
}

// ---- Wire it all up --------------------------------------------------------

export function startNotifications() {
  // Webhook-on-move (rec #3): ping when a card enters a board's notify column.
  events.on('card:moved', async ({ boardId, card, toColumn }) => {
    const board = await boards.getBoard(boardId);
    if (!board) return;
    const notifyCol = board.settings.notifyColumn || 'Done';
    const url = board.settings.webhookUrl || config.discordWebhookUrl;
    if (toColumn.name.toLowerCase() === notifyCol.toLowerCase()) {
      await sendDiscord({
        content: `✅ **${card.subject}** moved to **${toColumn.name}** on *${board.name}*`,
      }, url);
    }
  });

  // Alarm scan every minute (per-card alarms — distinct from summaries).
  cron.schedule('* * * * *', () => checkAlarms().catch((e) => console.error('[notify] alarm', e)));

  // Configurable, settings-driven task summaries (email + Discord).
  startScheduler();

  console.log('[notify] engine started (alarms + configurable summaries).');
}

export { sendEmail, sendDiscord };
