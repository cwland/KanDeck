/**
 * Board / column / card repository — the data model on top of the flat-file
 * store. One JSON file per board at data/boards/<id>.json, plus an index file
 * data/boards/_index.json that holds board order + summary metadata.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';
import { newId, nowIso, dueInDays, parseAlarm } from '../util.js';
import { getLaneColors, getPriorities, DEFAULT_LANE_COLORS } from './settings.js';
import {
  readJson,
  writeJsonAtomic,
  updateJson,
  withLock,
  listJson,
  removeFile,
  ensureDir,
} from './store.js';

const INDEX_FILE = path.join(config.boardsDir, '_index.json');
const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'];

function boardFile(id) {
  return path.join(config.boardsDir, `${id}.json`);
}

export async function init() {
  await ensureDir(config.boardsDir);
  await ensureDir(config.backupsDir);
  const index = await readJson(INDEX_FILE, null);
  if (!index) await writeJsonAtomic(INDEX_FILE, { boards: [] });
  // Seed a first board on a fresh install so the UI isn't empty.
  const idx = await readJson(INDEX_FILE, { boards: [] });
  if (idx.boards.length === 0) {
    await createBoard({ name: 'My First Board', description: 'Welcome to KanDeck 👋' });
  }
  await migrateLaneColors();
  await migrateDoneLane();
}

// ---- Done lane -------------------------------------------------------------
// The LAST lane is always the "done" lane, whatever it's called. Cards in it
// are complete; cards anywhere else are not. completedAt is stamped when a
// card enters the done lane (drag or check-off) — see moveCard.

/** Id of the board's done lane (always the last column). */
export function doneColumnId(board) {
  const cols = (board && board.columns) || [];
  return cols.length ? cols[cols.length - 1].id : null;
}

/** Re-derive every card's complete flag from its lane. Runs after every board
 *  mutation so adding / deleting / reordering lanes keeps status consistent.
 *  Structural changes keep an existing completedAt (so a lane reshuffle doesn't
 *  wipe dates); only an explicit move out of the done lane clears it. */
function syncComplete(board) {
  const doneId = doneColumnId(board);
  let changed = false;
  for (const col of board.columns || []) {
    const isDone = col.id === doneId;
    for (const card of col.cards || []) {
      if (isDone && !card.complete) {
        card.complete = true;
        if (!card.completedAt) card.completedAt = nowIso();
        changed = true;
      } else if (!isDone && card.complete) {
        card.complete = false;
        changed = true;
      }
    }
  }
  board.settings = board.settings || {};
  // Mirrored for API consumers that still read it; no longer user-settable.
  if (board.settings.completeColumnId !== doneId) {
    board.settings.completeColumnId = doneId;
    changed = true;
  }
  return changed;
}

// One-time, idempotent: boards that picked a non-last lane as "complete" now
// follow the last-lane rule, and the old "show done tasks for X days" window
// (completeWindowDays) becomes "auto-archive done tasks after X days".
async function migrateDoneLane() {
  const ids = (await listJson(config.boardsDir)).filter((id) => !id.startsWith('_'));
  for (const id of ids) {
    await withLock(boardFile(id), async () => {
      const board = await readJson(boardFile(id), null);
      if (!board) return;
      let changed = syncComplete(board);
      const s = board.settings || {};
      if (s.completeWindowDays !== undefined) {
        if (s.autoArchiveDays === undefined) s.autoArchiveDays = Math.max(0, parseInt(s.completeWindowDays, 10) || 0);
        delete s.completeWindowDays;
        changed = true;
      }
      if (changed) await writeJsonAtomic(boardFile(id), board);
    });
  }
}

// ---- Auto-archive ----------------------------------------------------------
// Cards in the done lane are archived once they've been complete for
// settings.autoArchiveDays days (0 = never). Archived cards keep their
// completed date and stay in the done lane — the board just hides them unless
// "Show archived" is on. A card that is manually unarchived gets a fresh
// grace period (counted from unarchivedAt) so it isn't re-archived at once.

/** Archive overdue done cards on one board in place. Returns true if changed. */
function autoArchiveBoard(board, now = Date.now()) {
  const days = parseInt((board.settings || {}).autoArchiveDays, 10) || 0;
  if (days <= 0 || board.archived) return false;
  const doneId = doneColumnId(board);
  const col = (board.columns || []).find((c) => c.id === doneId);
  if (!col) return false;
  const cutoff = now - days * 86400000;
  let changed = false;
  for (const card of col.cards) {
    if (card.archived || !card.completedAt) continue;
    const since = Math.max(Date.parse(card.completedAt) || 0, Date.parse(card.unarchivedAt || '') || 0);
    if (since && since < cutoff) {
      card.archived = true;
      card.archivedAt = new Date(now).toISOString();
      card.autoArchived = true;
      changed = true;
    }
  }
  return changed;
}

/** Run auto-archive across every active board. */
export async function autoArchiveAll() {
  const idx = await readIndex();
  let total = 0;
  for (const entry of idx.boards) {
    if (entry.archived) continue;
    await withLock(boardFile(entry.id), async () => {
      const board = await readJson(boardFile(entry.id), null);
      if (board && autoArchiveBoard(board)) {
        board.updatedAt = nowIso();
        await writeJsonAtomic(boardFile(entry.id), board);
        total++;
      }
    });
  }
  return total;
}

/** Run now, then hourly. */
export function startAutoArchive() {
  const run = () => autoArchiveAll().catch((e) => console.error('[auto-archive]', e.message));
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}

// One-time, idempotent: remap legacy vibrant lane colors to the new pastels
// (kept index-aligned by hue) so existing boards adopt the softer palette.
const OLD_LANE_COLORS = [
  '#0079bf', '#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46',
  '#c377e0', '#00c2e0', '#ff78cb', '#344563', '#838c91',
];
async function migrateLaneColors() {
  const ids = (await listJson(config.boardsDir)).filter((id) => id !== '_index');
  for (const id of ids) {
    const board = await readJson(boardFile(id), null);
    if (!board) continue;
    let changed = false;
    for (const col of board.columns || []) {
      const oi = OLD_LANE_COLORS.indexOf(col.color);
      if (oi >= 0) { col.color = DEFAULT_LANE_COLORS[oi] || col.color; changed = true; }
    }
    if (changed) await writeJsonAtomic(boardFile(id), board);
  }
}

// ---- Index helpers ---------------------------------------------------------

async function readIndex() {
  return readJson(INDEX_FILE, { boards: [] });
}

async function upsertIndexEntry(board) {
  await updateJson(
    INDEX_FILE,
    (idx) => {
      idx = idx || { boards: [] };
      const entry = {
        id: board.id,
        name: board.name,
        description: board.description || '',
        order: board.order,
        updatedAt: board.updatedAt,
        archived: !!board.archived,
        archivedAt: board.archivedAt || null,
      };
      const i = idx.boards.findIndex((b) => b.id === board.id);
      if (i === -1) idx.boards.push(entry);
      else idx.boards[i] = entry;
      idx.boards.sort((a, b) => a.order - b.order);
      return idx;
    },
    { boards: [] }
  );
}

async function removeIndexEntry(id) {
  await updateJson(
    INDEX_FILE,
    (idx) => {
      idx = idx || { boards: [] };
      idx.boards = idx.boards.filter((b) => b.id !== id);
      return idx;
    },
    { boards: [] }
  );
}

// ---- Board CRUD ------------------------------------------------------------

/** Active boards by default; `{ archived: true }` lists only archived ones. */
export async function listBoards({ archived = false } = {}) {
  const idx = await readIndex();
  // Enrich with card counts for summary meta (spec: "summary meta").
  const out = [];
  for (const entry of idx.boards) {
    if (!!entry.archived !== !!archived) continue;
    const board = await readJson(boardFile(entry.id), null);
    const cardCount = board
      ? board.columns.reduce(
          (n, c) => n + c.cards.filter((k) => !k.archived).length,
          0
        )
      : 0;
    out.push({ ...entry, columns: board ? board.columns.length : 0, cardCount });
  }
  return out;
}

export async function getBoard(id) {
  return readJson(boardFile(id), null);
}

/** Every card across all boards with its board + column context. By default
 *  excludes archived and completed cards; opts can include either. Shared by
 *  the notification engine and content builder. */
export async function allCards({ includeComplete = false, includeArchived = false } = {}) {
  const idx = await readIndex();
  const out = [];
  for (const entry of idx.boards) {
    if (entry.archived) continue; // archived boards are out of notifications
    const board = await getBoard(entry.id);
    if (!board) continue;
    for (const col of board.columns)
      for (const card of col.cards) {
        if (!includeArchived && card.archived) continue;
        if (!includeComplete && card.complete) continue;
        out.push({ board, col, card });
      }
  }
  return out;
}

export async function createBoard({ name, description = '' }) {
  const idx = await readIndex();
  const id = newId('b_');
  const now = nowIso();
  const laneColors = await getLaneColors();
  const columns = DEFAULT_COLUMNS.map((title, i) => ({
    id: newId('c_'),
    name: title,
    color: laneColors[i % laneColors.length] || null,
    autoSort: false,
    cards: [],
    order: i,
  }));
  const board = {
    id,
    name: name || 'Untitled Board',
    description,
    createdAt: now,
    updatedAt: now,
    order: idx.boards.length,
    settings: {
      zoom: 100, // 75 | 100 | 125 ...
      autoSort: false,
      autoSortKey: 'priority', // priority | due
      // Mirror of the done lane (always the last column) — see doneColumnId.
      completeColumnId: columns[columns.length - 1]?.id || null,
      // Archive done-lane cards this many days after completion (0 = never).
      autoArchiveDays: 0,
      // Which fields render on cards (priority + due date on by default).
      cardFields: { priority: true, dueDate: true, tags: false, source: false },
    },
    columns,
    archived: false,
    archivedAt: null,
    // Tags that auto-route incoming API tasks to this board's first lane.
    routeTags: [],
    // Calendar feed: off until enabled. token is a secret capability URL part.
    ics: { token: null, includeDescriptions: false, includeCompleted: false },
  };
  await writeJsonAtomic(boardFile(id), board);
  await upsertIndexEntry(board);
  return board;
}

// ---- Routing tags ------------------------------------------------------------
// Each board can own a set of tags. A task pushed through the API without a
// boardId whose tags match one of them goes straight to that board's first
// lane instead of the Inbox. A tag can belong to only one board (checked
// across ALL boards, archived ones included, so restoring a board can never
// create a clash). Matching is case-insensitive.

export function normalizeTag(t) {
  return String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Accepts an array or a comma-separated string; returns clean display tags. */
export function parseTags(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  return list.map((t) => String(t ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** Map of normalized tag → { tag, boardId, boardName, archived } for every board. */
export async function getRouteTagMap() {
  const idx = await readIndex();
  const map = new Map();
  for (const entry of idx.boards) {
    const b = await getBoard(entry.id);
    if (!b) continue;
    for (const tag of b.routeTags || [])
      map.set(normalizeTag(tag), { tag, boardId: b.id, boardName: b.name, archived: !!b.archived });
  }
  return map;
}

/** Validate a board's routing tags: trims, de-dupes within the board, and
 *  throws a readable error if any tag already belongs to another board. */
async function validateRouteTags(boardId, tags) {
  const clean = [];
  const seen = new Set();
  for (const t of parseTags(tags)) {
    if (t.length > 40) throw new Error(`Tag "${t.slice(0, 20)}…" is too long (max 40 characters).`);
    const k = normalizeTag(t);
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push(t);
  }
  const map = await getRouteTagMap();
  for (const t of clean) {
    const owner = map.get(normalizeTag(t));
    if (owner && owner.boardId !== boardId)
      throw new Error(`Tag "${t}" is already used by board "${owner.boardName}"${owner.archived ? ' (archived)' : ''}. Each tag can belong to only one board.`);
  }
  return clean;
}

/** First active board whose routing tags match one of `tags` (checked in the
 *  task's tag order). Returns { board, tag } or null. */
export async function findBoardForTags(tags) {
  const wanted = parseTags(tags);
  if (!wanted.length) return null;
  const map = await getRouteTagMap();
  for (const t of wanted) {
    const owner = map.get(normalizeTag(t));
    if (owner && !owner.archived) {
      const board = await getBoard(owner.boardId);
      if (board && !board.archived && board.columns.length) return { board, tag: owner.tag };
    }
  }
  return null;
}

export async function updateBoard(id, patch) {
  // Validate routing tags before taking the lock (reads other boards).
  const routeTags = patch.routeTags !== undefined ? await validateRouteTags(id, patch.routeTags) : undefined;
  return withLock(boardFile(id), async () => {
    const board = await readJson(boardFile(id), null);
    if (!board) return null;
    if (routeTags !== undefined) board.routeTags = routeTags;
    if (patch.name !== undefined) board.name = patch.name;
    if (patch.description !== undefined) board.description = patch.description;
    if (patch.settings) board.settings = { ...board.settings, ...patch.settings };
    syncComplete(board); // completeColumnId isn't user-settable — re-derive it
    autoArchiveBoard(board); // a new auto-archive setting applies right away
    board.updatedAt = nowIso();
    await writeJsonAtomic(boardFile(id), board);
    await upsertIndexEntry(board);
    return board;
  });
}

/** Archive / restore a board. Archived boards drop out of menus, search,
 *  notifications and calendar feeds, but keep all their data. */
export async function setBoardArchived(id, archived) {
  return withLock(boardFile(id), async () => {
    const board = await readJson(boardFile(id), null);
    if (!board) return null;
    board.archived = !!archived;
    board.archivedAt = archived ? nowIso() : null;
    if (!archived) {
      // Restored boards go to the end of the active list.
      const idx = await readIndex();
      board.order = idx.boards.reduce((m, b) => Math.max(m, b.order ?? 0), -1) + 1;
    }
    board.updatedAt = nowIso();
    await writeJsonAtomic(boardFile(id), board);
    await upsertIndexEntry(board);
    return board;
  });
}

// ---- Calendar (.ics) feed --------------------------------------------------

function newIcsToken() {
  return crypto.randomBytes(24).toString('base64url'); // 192 bits
}

/** Enable the feed (keeps an existing token) or rotate it (`rotate: true`). */
export async function enableIcs(id, { rotate = false } = {}) {
  return mutateBoard(id, (board) => {
    board.ics = { includeDescriptions: false, includeCompleted: false, ...(board.ics || {}) };
    if (rotate || !board.ics.token) board.ics.token = newIcsToken();
    return board.ics;
  });
}

export async function disableIcs(id) {
  return mutateBoard(id, (board) => {
    board.ics = { includeDescriptions: false, includeCompleted: false, ...(board.ics || {}), token: null };
    return board.ics;
  });
}

export async function updateIcsOptions(id, patch = {}) {
  return mutateBoard(id, (board) => {
    board.ics = { includeDescriptions: false, includeCompleted: false, ...(board.ics || {}) };
    if (patch.includeDescriptions !== undefined) board.ics.includeDescriptions = !!patch.includeDescriptions;
    if (patch.includeCompleted !== undefined) board.ics.includeCompleted = !!patch.includeCompleted;
    return board.ics;
  });
}

/** Resolve a feed request. Returns the board only if it exists, is active, has
 *  a feed enabled, and the token matches (constant-time); otherwise null. */
export async function getBoardForIcs(id, token) {
  if (!/^b_[a-z0-9]{6,32}$/i.test(String(id || ''))) return null; // no path tricks
  const board = await getBoard(id);
  const expected = board && !board.archived && board.ics && board.ics.token;
  if (!expected || !token) return null;
  const a = crypto.createHash('sha256').update(String(expected)).digest();
  const b = crypto.createHash('sha256').update(String(token)).digest();
  return crypto.timingSafeEqual(a, b) ? board : null;
}

/** Testing helper: delete every card (active + archived) on every board,
 *  archived boards included. Boards, lanes, routing tags, feeds and settings
 *  are kept. Returns { boards, cards } counts. */
export async function clearAllCards() {
  const idx = await readIndex();
  let cards = 0;
  for (const entry of idx.boards) {
    await mutateBoard(entry.id, (board) => {
      for (const col of board.columns || []) { cards += (col.cards || []).length; col.cards = []; }
      return board;
    });
  }
  return { boards: idx.boards.length, cards };
}

export async function deleteBoard(id) {
  await removeFile(boardFile(id));
  await removeIndexEntry(id);
  return true;
}

export async function reorderBoards(orderedIds) {
  await updateJson(
    INDEX_FILE,
    (idx) => {
      idx = idx || { boards: [] };
      const map = new Map(idx.boards.map((b) => [b.id, b]));
      const listed = orderedIds
        .map((id, i) => {
          const b = map.get(id);
          if (b) b.order = i;
          return b;
        })
        .filter(Boolean);
      // Keep boards the caller didn't list (e.g. archived ones) instead of
      // silently dropping them from the index.
      const ids = new Set(listed.map((b) => b.id));
      const rest = idx.boards.filter((b) => !ids.has(b.id));
      rest.forEach((b, i) => (b.order = listed.length + i));
      idx.boards = [...listed, ...rest];
      return idx;
    },
    { boards: [] }
  );
  // persist order onto each board file too
  for (let i = 0; i < orderedIds.length; i++) {
    await updateBoard(orderedIds[i], {}).catch(() => {});
  }
  return listBoards();
}

// ---- Column ops ------------------------------------------------------------

function mutateBoard(id, fn) {
  return withLock(boardFile(id), async () => {
    const board = await readJson(boardFile(id), null);
    if (!board) return null;
    const result = await fn(board);
    syncComplete(board);
    board.updatedAt = nowIso();
    await writeJsonAtomic(boardFile(id), board);
    await upsertIndexEntry(board);
    return result === undefined ? board : result;
  });
}

export async function addColumn(boardId, name, color) {
  const laneColors = await getLaneColors();
  return mutateBoard(boardId, (board) => {
    const col = {
      id: newId('c_'),
      name: name || 'New Lane',
      color: color || laneColors[board.columns.length % laneColors.length] || null,
      autoSort: false,
      cards: [],
      order: board.columns.length,
    };
    board.columns.push(col);
    return col; // return the created column (callers need its id)
  });
}

export async function updateColumn(boardId, columnId, patch) {
  return mutateBoard(boardId, (board) => {
    const col = board.columns.find((c) => c.id === columnId);
    if (!col) return board;
    if (patch.name !== undefined) col.name = patch.name;
    if (patch.color !== undefined) col.color = patch.color;
    if (patch.autoSort !== undefined) col.autoSort = patch.autoSort;
    if (col.autoSort) sortColumn(col, board.settings.autoSortKey);
    return board;
  });
}

export async function deleteColumn(boardId, columnId) {
  return mutateBoard(boardId, (board) => {
    board.columns = board.columns.filter((c) => c.id !== columnId);
    board.columns.forEach((c, i) => (c.order = i));
    return board;
  });
}

export async function reorderColumns(boardId, orderedColumnIds) {
  return mutateBoard(boardId, (board) => {
    const map = new Map(board.columns.map((c) => [c.id, c]));
    board.columns = orderedColumnIds.map((id) => map.get(id)).filter(Boolean);
    board.columns.forEach((c, i) => (c.order = i));
    return board;
  });
}

// ---- Card ops --------------------------------------------------------------

function findCard(board, cardId) {
  for (const col of board.columns) {
    const card = col.cards.find((k) => k.id === cardId);
    if (card) return { col, card };
  }
  return null;
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

function sortColumn(col, key = 'priority') {
  col.cards.sort((a, b) => {
    if (key === 'due') {
      const ad = a.dueDate ? Date.parse(a.dueDate) : Infinity;
      const bd = b.dueDate ? Date.parse(b.dueDate) : Infinity;
      if (ad !== bd) return ad - bd;
    }
    const ap = PRIORITY_RANK[a.priority] ?? 4;
    const bp = PRIORITY_RANK[b.priority] ?? 4;
    return ap - bp;
  });
  col.cards.forEach((c, i) => (c.order = i));
}

export function makeCard(input = {}) {
  return {
    id: newId('k_'),
    subject: input.subject || 'New Card',
    description: input.description || '',
    createdAt: nowIso(),
    dueDate: input.dueDate || null,
    alarm: parseAlarm(input.alarm), // reminder date-time (ISO, UTC) or null
    priority: input.priority || 'none', // urgent|high|medium|low|none
    tags: Array.isArray(input.tags) ? input.tags : [],
    source: input.source || null, // provenance (from inbox item or 'manual')
    archived: false,
    complete: false, // set true when the card lives in the board's complete lane
    completedAt: null, // auto-set when the card becomes complete
    prevColumnId: null, // column it came from when completed (for un-complete)
    order: 0,
  };
}

/** Add a card. `columnId` optional → defaults to first column. */
export async function addCard(boardId, columnId, input = {}) {
  return mutateBoard(boardId, (board) => {
    const col =
      board.columns.find((c) => c.id === columnId) || board.columns[0];
    if (!col) throw new Error('Board has no columns');
    const card = makeCard(input);
    card.complete = col.id === doneColumnId(board);
    if (card.complete) card.completedAt = nowIso();
    card.order = col.cards.length;
    col.cards.push(card);
    if (col.autoSort) sortColumn(col, board.settings.autoSortKey);
    return card;
  });
}

export async function updateCard(boardId, cardId, patch) {
  return mutateBoard(boardId, (board) => {
    const found = findCard(board, cardId);
    if (!found) return null;
    const { col, card } = found;
    for (const key of [
      'subject',
      'description',
      'dueDate',
      'priority',
      'tags',
    ]) {
      if (patch[key] !== undefined) card[key] = patch[key];
    }
    if (patch.alarm !== undefined) card.alarm = parseAlarm(patch.alarm);
    if (patch.archived !== undefined && !!patch.archived !== !!card.archived) {
      card.archived = !!patch.archived;
      if (card.archived) {
        card.archivedAt = nowIso();
        card.autoArchived = false;
      } else {
        card.archivedAt = null;
        card.autoArchived = false;
        card.unarchivedAt = nowIso(); // restarts the auto-archive countdown
      }
    }
    if (col.autoSort) sortColumn(col, board.settings.autoSortKey);
    return card;
  });
}

/**
 * Move a card to `toColumnId` at `toIndex`. Returns { board, card, from, to,
 * movedColumns } so callers (e.g. webhook-on-move) can react.
 */
export async function moveCard(boardId, cardId, toColumnId, toIndex) {
  return mutateBoard(boardId, (board) => {
    const found = findCard(board, cardId);
    if (!found) return null;
    const { col: fromCol, card } = found;
    const wasComplete = !!card.complete;
    const toCol = board.columns.find((c) => c.id === toColumnId) || fromCol;
    if (card.archived && toCol.id !== fromCol.id) {
      // Moving an archived card to another lane brings it back.
      card.archived = false;
      card.archivedAt = null;
      card.autoArchived = false;
      card.unarchivedAt = nowIso();
    }
    fromCol.cards = fromCol.cards.filter((k) => k.id !== cardId);
    const idx = Math.max(0, Math.min(toIndex ?? toCol.cards.length, toCol.cards.length));
    toCol.cards.splice(idx, 0, card);
    // Complete status follows the lane: set when entering the done (last)
    // lane, cleared when leaving it. completedAt is (re)stamped every time the
    // card enters the done lane; reordering within it keeps the date.
    card.complete = toCol.id === doneColumnId(board);
    if (card.complete) {
      if (!wasComplete || !card.completedAt) card.completedAt = nowIso();
      if (!wasComplete) card.prevColumnId = fromCol.id; // remember origin for un-complete
    } else {
      card.completedAt = null;
      card.prevColumnId = null;
    }
    if (toCol.autoSort) sortColumn(toCol, board.settings.autoSortKey);
    fromCol.cards.forEach((c, i) => (c.order = i));
    toCol.cards.forEach((c, i) => (c.order = i));
    return {
      card,
      fromColumn: { id: fromCol.id, name: fromCol.name },
      toColumn: { id: toCol.id, name: toCol.name },
      movedColumns: fromCol.id !== toCol.id,
    };
  });
}

export async function deleteCard(boardId, cardId) {
  return mutateBoard(boardId, (board) => {
    for (const col of board.columns) {
      const before = col.cards.length;
      col.cards = col.cards.filter((k) => k.id !== cardId);
      if (col.cards.length !== before) {
        col.cards.forEach((c, i) => (c.order = i));
        return true;
      }
    }
    return false;
  });
}

/** Global card search across every board (subject, description, tags). */
export async function searchCards(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const idx = await readIndex();
  const out = [];
  for (const entry of idx.boards) {
    if (entry.archived) continue;
    const board = await getBoard(entry.id);
    if (!board) continue;
    for (const col of board.columns) {
      for (const card of col.cards) {
        if (card.archived) continue;
        const hay = (
          card.subject + ' ' + (card.description || '') + ' ' + (card.tags || []).join(' ')
        ).toLowerCase();
        if (hay.includes(q))
          out.push({
            boardId: board.id, boardName: board.name,
            columnId: col.id, columnName: col.name,
            cardId: card.id, subject: card.subject, complete: !!card.complete,
          });
      }
    }
  }
  return out;
}

/**
 * Flattened, filtered task query across every board — built for external
 * assistants (n8n) to answer "what's due today / this week / completed N days
 * ago". All date math is done server-side against the server's local clock, so
 * the caller never has to reason about dates.
 *
 * Options (all optional):
 *   due:             today | tomorrow | week | overdue | none | any  (default any)
 *   status:          open | complete | all
 *                    (default: complete if completedWithin is set, else open)
 *   completedWithin: integer N → only cards completed within the last N days
 *   board:           board id or case-insensitive name substring
 *   priority:        category id (e.g. 'high')
 *   q:               text match on subject/description/tags
 *   limit:           max cards returned (default 200, cap 1000)
 */
export async function queryTasks(opts = {}) {
  let due = String(opts.due || 'any').toLowerCase();
  // Be forgiving of loose values an LLM might send (e.g. "this week", "").
  if (['week', 'this week', 'thisweek', 'this-week'].includes(due)) due = 'week';
  else if (['today', 'due today'].includes(due)) due = 'today';
  else if (['tomorrow'].includes(due)) due = 'tomorrow';
  else if (['overdue', 'late', 'past due'].includes(due)) due = 'overdue';
  else if (['none', 'no due date', 'nodue'].includes(due)) due = 'none';
  else due = 'any';
  const completedWithin =
    opts.completedWithin != null && opts.completedWithin !== '' && !Number.isNaN(parseInt(opts.completedWithin, 10))
      ? parseInt(opts.completedWithin, 10)
      : null;
  let status = opts.status ? String(opts.status).toLowerCase() : '';
  if (!['open', 'complete', 'all'].includes(status)) status = completedWithin != null ? 'complete' : 'open';
  const boardFilter = opts.board ? String(opts.board).toLowerCase() : null;
  const priority = opts.priority ? String(opts.priority) : null;
  const q = opts.q ? String(opts.q).toLowerCase() : null;
  const limit = Math.max(1, Math.min(1000, parseInt(opts.limit, 10) || 200));

  const MS_DAY = 86400000;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const prios = await getPriorities().catch(() => []);
  const prioName = (id) => (prios.find((p) => p.id === id) || {}).name || id;

  const idx = await readIndex();
  const all = [];
  for (const entry of idx.boards) {
    if (entry.archived) continue;
    const b = await getBoard(entry.id);
    if (!b) continue;
    if (boardFilter && !(b.name.toLowerCase().includes(boardFilter) || b.id === opts.board)) continue;
    for (const col of b.columns) {
      for (const card of col.cards) {
        // Auto-archived done cards are still completion history, so keep
        // archived *complete* cards; drop archived open ones.
        if (card.archived && !card.complete) continue;
        const isComplete = !!card.complete;

        if (status === 'open' && isComplete) continue;
        if (status === 'complete' && !isComplete) continue;

        // dueDate may be date-only or a full ISO datetime; dueInDays() handles both.
        const dueDays = dueInDays(card.dueDate, now);
        const overdue = dueDays != null && dueDays < 0 && !isComplete;

        if (due !== 'any') {
          if (due === 'none') { if (card.dueDate) continue; }
          else if (dueDays === null) continue;
          else if (due === 'today') { if (dueDays !== 0) continue; }
          else if (due === 'tomorrow') { if (dueDays !== 1) continue; }
          else if (due === 'week') { if (dueDays < 0 || dueDays > 7) continue; }
          else if (due === 'overdue') { if (!(dueDays < 0) || isComplete) continue; }
        }

        let completedDaysAgo = null;
        if (card.completedAt) {
          const ca = new Date(card.completedAt);
          if (!Number.isNaN(ca.getTime())) completedDaysAgo = Math.floor((now - ca) / MS_DAY);
        }
        if (completedWithin != null) {
          if (!isComplete || completedDaysAgo == null || completedDaysAgo > completedWithin) continue;
        }

        if (priority && (card.priority || 'none') !== priority) continue;

        if (q) {
          const hay = (card.subject + ' ' + (card.description || '') + ' ' + (card.tags || []).join(' ')).toLowerCase();
          if (!hay.includes(q)) continue;
        }

        all.push({
          boardId: b.id, boardName: b.name,
          columnId: col.id, columnName: col.name,
          cardId: card.id, subject: card.subject,
          dueDate: card.dueDate || null, dueInDays: dueDays, overdue,
          alarm: card.alarm || null,
          priority: card.priority || 'none', priorityName: prioName(card.priority || 'none'),
          tags: card.tags || [], source: card.source || null,
          complete: isComplete, completedAt: card.completedAt || null, completedDaysAgo,
          archived: !!card.archived,
        });
      }
    }
  }

  all.sort((a, z) => {
    if (a.complete !== z.complete) return a.complete ? 1 : -1;
    if (!a.complete) return (a.dueInDays == null ? Infinity : a.dueInDays) - (z.dueInDays == null ? Infinity : z.dueInDays);
    return (a.completedDaysAgo == null ? Infinity : a.completedDaysAgo) - (z.completedDaysAgo == null ? Infinity : z.completedDaysAgo);
  });

  const tasks = all.slice(0, limit);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    now: now.toISOString(),
    today: ymd(startOfToday),
    filters: { due, status, completedWithin, board: opts.board || null, priority, q: opts.q || null },
    summary: {
      matched: all.length,
      returned: tasks.length,
      dueToday: all.filter((t) => t.dueInDays === 0 && !t.complete).length,
      overdue: all.filter((t) => t.overdue).length,
      dueThisWeek: all.filter((t) => !t.complete && t.dueInDays != null && t.dueInDays >= 0 && t.dueInDays <= 7).length,
      completed: all.filter((t) => t.complete).length,
    },
    tasks,
  };
}

/** Find a card across all boards (used by REST PUT /api/tasks/:id). */
export async function findCardAnywhere(cardId) {
  const ids = await listJson(config.boardsDir);
  for (const id of ids) {
    if (id.startsWith('_')) continue;
    const board = await getBoard(id);
    if (!board) continue;
    const found = findCard(board, cardId);
    if (found) return { boardId: id, ...found };
  }
  return null;
}

