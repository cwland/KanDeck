/**
 * Inbox store — a holding area for incoming items (spec: new feature).
 * All API-created tasks that don't name a board land here for triage; users
 * drag them onto a board/column from the UI. Backed by data/inbox.json.
 */
import config from '../config.js';
import { readJson, updateJson, ensureDir } from './store.js';
import { newId, nowIso } from '../util.js';
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
    alarm: !!input.alarm,
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

/** Move an inbox item onto a board column, creating a card and removing it. */
export async function moveToBoard(id, boardId, columnId, index) {
  const items = await listItems();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const card = await boards.addCard(boardId, columnId, {
    subject: item.subject,
    description: item.description,
    priority: item.priority,
    color: item.color,
    dueDate: item.dueDate,
    alarm: item.alarm,
    tags: item.tags,
  });
  if (typeof index === 'number') {
    await boards.moveCard(boardId, card.id, columnId, index).catch(() => {});
  }
  await removeItem(id);
  return { boardId, columnId, card };
}
