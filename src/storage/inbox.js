/**
 * Inbox store — a holding area for incoming items (spec: new feature).
 * All API-created tasks that don't name a board land here for triage; users
 * drag them onto a board/column from the UI. Backed by data/inbox.json.
 */
import config from '../config.js';
import { readJson, updateJson, ensureDir } from './store.js';
import { newId, nowIso, parseAlarm } from '../util.js';
import * as boards from './boards.js';

const EMPTY = { items: [] };

export async function init() {
  await ensureDir(config.dataDir);
  const cur = await readJson(config.inboxFile, null);
  if (!cur) await updateJson(config.inboxFile, () => EMPTY, EMPTY);
}

export async function listItems() {
  const inbox = await readJson(config.inboxFile, EMPTY);
  return inbox.items || [];
}

export async function addItem(input = {}) {
  const item = {
    id: newId('in_'),
    subject: input.subject || 'New item',
    description: input.description || '',
    priority: input.priority || 'none',
    dueDate: input.dueDate || null,
    alarm: parseAlarm(input.alarm),
    tags: Array.isArray(input.tags) ? input.tags : [],
    source: input.source || 'api',
    createdAt: nowIso(),
  };
  await updateJson(
    config.inboxFile,
    (inbox) => {
      inbox = inbox || { items: [] };
      inbox.items.unshift(item); // newest on top
      return inbox;
    },
    EMPTY
  );
  return item;
}

export async function updateItem(id, patch = {}) {
  let updated = null;
  const alarm = patch.alarm !== undefined ? parseAlarm(patch.alarm) : undefined; // validate before writing
  await updateJson(
    config.inboxFile,
    (inbox) => {
      inbox = inbox || { items: [] };
      const item = inbox.items.find((i) => i.id === id);
      if (item) {
        for (const k of ['subject', 'description', 'priority', 'dueDate', 'tags', 'source']) {
          if (patch[k] !== undefined) item[k] = patch[k];
        }
        if (alarm !== undefined) item.alarm = alarm;
        updated = item;
      }
      return inbox;
    },
    EMPTY
  );
  return updated;
}

/** Testing helper: empty the Inbox. Returns how many items were removed. */
export async function clearAll() {
  let n = 0;
  await updateJson(config.inboxFile, (inbox) => { n = ((inbox && inbox.items) || []).length; return { items: [] }; }, EMPTY);
  return n;
}

export async function removeItem(id) {
  let removed = null;
  await updateJson(
    config.inboxFile,
    (inbox) => {
      inbox = inbox || { items: [] };
      removed = inbox.items.find((i) => i.id === id) || null;
      inbox.items = inbox.items.filter((i) => i.id !== id);
      return inbox;
    },
    EMPTY
  );
  return removed;
}

/** Move an inbox item onto a board column, creating a card and removing it.
 *  Returns null if the item or target board can't be found — the caller turns
 *  that into a 404, and crucially the inbox item is NOT deleted, so a stale or
 *  deleted board id can never silently lose the item. */
/** Re-run tag routing over the whole Inbox: every item whose tags match a
 *  board's routing tags moves to that board's first lane. Returns what moved. */
export async function reprocess() {
  const moved = [];
  for (const item of await listItems()) {
    if (!item.tags || !item.tags.length) continue;
    const match = await boards.findBoardForTags(item.tags);
    if (!match) continue;
    const res = await moveToBoard(item.id, match.board.id);
    if (res && res.card)
      moved.push({ id: item.id, subject: item.subject, boardId: match.board.id, boardName: match.board.name, routedBy: match.tag, card: res.card });
  }
  return { moved, remaining: (await listItems()).length };
}

export async function moveToBoard(id, boardId, columnId, index) {
  const items = await listItems();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const card = await boards.addCard(boardId, columnId, {
    subject: item.subject,
    description: item.description,
    priority: item.priority,
    dueDate: item.dueDate,
    alarm: item.alarm || null,
    tags: item.tags,
    source: item.source,
  });
  if (!card) return null; // board missing/deleted — leave the inbox item intact
  if (typeof index === 'number') {
    await boards.moveCard(boardId, card.id, columnId, index).catch(() => {});
  }
  await removeItem(id);
  return { boardId, card };
}
