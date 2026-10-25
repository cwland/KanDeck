/**
 * "What's new" data source: parses CHANGELOG.md at the repo root.
 *
 * Expected format (newest first, but order doesn't matter — we sort):
 *   ## 1.2.0 — 2026-10-25
 *   - change one
 *   - change two
 *     (indented lines continue the previous bullet)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import config from '../config.js';

const FILE = path.join(config.root, 'CHANGELOG.md');
let cache = { mtimeMs: -1, entries: [] };

/** Compare "1.10.0" vs "1.2.3" numerically. */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function parseChangelog(text) {
  const entries = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const h = raw.match(/^##\s+\[?v?(\d+\.\d+\.\d+)\]?\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?/);
    if (h) {
      cur = { version: h[1], date: h[2] || null, changes: [] };
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    const b = raw.match(/^\s{0,1}[-*]\s+(.*)$/);
    if (b) cur.changes.push(b[1].trim());
    else if (/^\s{2,}\S/.test(raw) && cur.changes.length)
      cur.changes[cur.changes.length - 1] += ' ' + raw.trim();
  }
  return entries.sort((x, y) => compareVersions(y.version, x.version));
}

async function readEntries() {
  try {
    const st = await fs.stat(FILE);
    if (st.mtimeMs !== cache.mtimeMs) {
      cache = { mtimeMs: st.mtimeMs, entries: parseChangelog(await fs.readFile(FILE, 'utf8')) };
    }
    return cache.entries;
  } catch {
    return []; // missing changelog → empty window, never an error
  }
}

/** The running version's entry plus the `previous` releases before it. */
export async function getChangelog({ previous = 10 } = {}) {
  const all = await readEntries();
  const released = all.filter((e) => compareVersions(e.version, config.version) <= 0);
  return released.slice(0, previous + 1);
}
