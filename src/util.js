/** Small shared helpers. */
import { randomUUID } from 'node:crypto';

/** Short, url-safe, time-ordered-ish id. */
export function newId(prefix = '') {
  return prefix + randomUUID().replace(/-/g, '').slice(0, 12);
}

export function nowIso() {
  return new Date().toISOString();
}

/** Filesystem-safe timestamp: 2026-07-25_153000 */
export function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Whole-day difference between a due date and today (local calendar days).
 *  Accepts a date-only string (YYYY-MM-DD) or a full ISO datetime — the leading
 *  date is used either way. Returns null if unparseable. Negative = overdue. */
export function dueInDays(dueDate, now = new Date()) {
  const m = String(dueDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(+m[1], +m[2] - 1, +m[3]);
  return Math.round((due - start) / 86400000);
}

/** slugify a board name into a safe filename stem. */
export function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'board'
  );
}
