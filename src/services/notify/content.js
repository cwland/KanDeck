/**
 * Notification content builder (channel-agnostic).
 *
 * Turns a content config ({ upcoming, dueToday, pastDue }) into an ordered list
 * of sections, each with its matching open tasks enriched with board/column,
 * due date, days-until-due, and priority. Providers render these sections into
 * their own format (HTML email, Discord embeds, …) so adding a channel never
 * touches this logic.
 */
import { allCards } from '../../storage/boards.js';
import { getPriorities } from '../../storage/settings.js';
import { dueInDays } from '../../util.js';

/**
 * @returns {{ sections: Array<{key,title,emoji,tasks:Array}>, total: number, generatedAt: Date }}
 */
export async function buildSections(content = {}, now = new Date()) {
  const open = await allCards(); // excludes archived + completed
  const scored = open
    .map((x) => ({ x, dueInDays: dueInDays(x.card.dueDate, now) }))
    .filter((o) => o.dueInDays !== null);

  // Use the app's actual category colors so notifications match the board.
  const prios = await getPriorities().catch(() => []);
  const pmap = Object.fromEntries((prios || []).map((p) => [p.id, p]));

  const enrich = ({ x, dueInDays }) => {
    const id = x.card.priority || 'none';
    const p = pmap[id] || {};
    return {
      subject: x.card.subject,
      boardId: x.board.id,
      boardName: x.board.name,
      columnName: x.col.name,
      dueDate: x.card.dueDate || null,
      dueInDays,
      priority: id,
      priorityName: p.name || id,
      priorityColor: p.color || null,
      priorityTextColor: p.textColor || null,
    };
  };

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
