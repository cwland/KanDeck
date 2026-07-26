/**
 * Notification content builder (channel-agnostic).
 *
 * Turns a content config ({ upcoming, dueToday, pastDue }) into an ordered list
 * of sections, each with its matching open tasks enriched with board/column,
 * due date, days-until-due, and priority. Providers render these sections into
 * their own format (HTML email, Discord embeds, …) so adding a channel never
 * touches this logic.
 */
import config from '../../config.js';
import * as boards from '../../storage/boards.js';
import { listJson } from '../../storage/store.js';

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

const MS_DAY = 86400000;
const localMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// dueDate may be date-only or a full ISO datetime — take the leading date.
function dueInDaysOf(dueDate, startOfToday) {
  const m = String(dueDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const dueMid = new Date(+m[1], +m[2] - 1, +m[3]);
  return Math.round((dueMid - startOfToday) / MS_DAY);
}

/**
 * @returns {{ sections: Array<{key,title,emoji,tasks:Array}>, total: number, generatedAt: Date }}
 */
export async function buildSections(content = {}, now = new Date()) {
  const startOfToday = localMidnight(now);
  const open = (await allCards()).filter(({ card }) => !card.complete);
  const scored = open
    .map((x) => ({ x, dueInDays: dueInDaysOf(x.card.dueDate, startOfToday) }))
    .filter((o) => o.dueInDays !== null);

  const enrich = ({ x, dueInDays }) => ({
    subject: x.card.subject,
    boardId: x.board.id,
    boardName: x.board.name,
    columnName: x.col.name,
    dueDate: x.card.dueDate || null,
    dueInDays,
    priority: x.card.priority || 'none',
  });

  const sections = [];
  if (content.pastDue && content.pastDue.enabled !== false) {
    const tasks = scored.filter((o) => o.dueInDays < 0).sort((a, b) => a.dueInDays - b.dueInDays).map(enrich);
    sections.push({ key: 'pastDue', title: 'Past Due', emoji: '⚠️', tasks });
  }
  if (content.dueToday && content.dueToday.enabled !== false) {
    const tasks = scored.filter((o) => o.dueInDays === 0).map(enrich);
    sections.push({ key: 'dueToday', title: 'Due Today', emoji: '📅', tasks });
  }
  if (content.upcoming && content.upcoming.enabled !== false) {
    const n = Math.max(1, Math.min(30, parseInt(content.upcoming.days, 10) || 7));
    const tasks = scored.filter((o) => o.dueInDays >= 1 && o.dueInDays <= n).sort((a, b) => a.dueInDays - b.dueInDays).map(enrich);
    sections.push({ key: 'upcoming', title: `Upcoming (next ${n} day${n === 1 ? '' : 's'})`, emoji: '🔜', tasks });
  }

  const total = sections.reduce((sum, s) => sum + s.tasks.length, 0);
  return { sections, total, generatedAt: now };
}

/** Human-friendly due label used by every provider. */
export function dueLabel(task) {
  if (task.dueInDays == null) return 'no due date';
  if (task.dueInDays < 0) return `${Math.abs(task.dueInDays)} day${task.dueInDays === -1 ? '' : 's'} overdue`;
  if (task.dueInDays === 0) return 'today';
  if (task.dueInDays === 1) return 'tomorrow';
  return `in ${task.dueInDays} days`;
}
