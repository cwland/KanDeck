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
