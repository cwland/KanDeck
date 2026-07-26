/**
 * Board / column / card repository — the data model on top of the flat-file
 * store. One JSON file per board at data/boards/<id>.json, plus an index file
 * data/boards/_index.json that holds board order + summary metadata.
 */
import path from 'node:path';
import config from '../config.js';
import { newId, nowIso, slugify } from '../util.js';
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

export async function listBoards() {
  const idx = await readIndex();
  // Enrich with card counts for summary meta (spec: "summary meta").
  const out = [];
  for (const entry of idx.boards) {
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
      // The lane whose cards count as "complete" (default: last / Done).
      completeColumnId: columns[columns.length - 1]?.id || null,
      // Complete lane shows only cards completed within this many days
      // (0 = show all). Older ones hide from view but are never deleted.
      completeWindowDays: 0,
      // Which fields render on cards (priority + due date on by default).
      cardFields: { priority: true, dueDate: true, tags: false, source: false },
    },
    columns,
  };
  await writeJsonAtomic(boardFile(id), board);
  await upsertIndexEntry(board);
  return board;
}

export async function updateBoard(id, patch) {
  return withLock(boardFile(id), async () => {
    const board = await readJson(boardFile(id), null);
    if (!board) return null;
    if (patch.name !== undefined) board.name = patch.name;
    if (patch.description !== undefined) board.description = patch.description;
    if (patch.settings) board.settings = { ...board.settings, ...patch.settings };
    board.updatedAt = nowIso();
    await writeJsonAtomic(boardFile(id), board);
    await upsertIndexEntry(board);
    return board;
  });
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
      idx.boards = orderedIds
        .map((id, i) => {
          const b = map.get(id);
          if (b) b.order = i;
          return b;
        })
        .filter(Boolean);
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
    if (board.settings.completeColumnId === columnId) board.settings.completeColumnId = null;
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
    alarm: !!input.alarm,
    alarmSent: false,
    priority: input.priority || 'none', // urgent|high|medium|low|none
    color: input.color || null,
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
    card.complete = col.id === board.settings.completeColumnId;
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
      'alarm',
      'alarmSent',
      'priority',
      'color',
      'tags',
      'archived',
    ]) {
      if (patch[key] !== undefined) card[key] = patch[key];
    }
    // Re-arm the alarm when it's (re)enabled, unless caller set alarmSent explicitly.
    if (patch.alarm === true && patch.alarmSent === undefined) card.alarmSent = false;
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
    fromCol.cards = fromCol.cards.filter((k) => k.id !== cardId);
    const idx = Math.max(0, Math.min(toIndex ?? toCol.cards.length, toCol.cards.length));
    toCol.cards.splice(idx, 0, card);
    // Complete status follows the lane: set when entering the complete lane,
    // cleared when leaving it. completedAt is stamped on the transition.
    card.complete = toCol.id === board.settings.completeColumnId;
    if (card.complete) {
      if (!card.completedAt) card.completedAt = nowIso();
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
  const due = String(opts.due || 'any').toLowerCase();
  const completedWithin =
    opts.completedWithin != null && opts.completedWithin !== '' && !Number.isNaN(parseInt(opts.completedWithin, 10))
      ? parseInt(opts.completedWithin, 10)
      : null;
  let status = opts.status ? String(opts.status).toLowerCase() : (completedWithin != null ? 'complete' : 'open');
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
    const b = await getBoard(entry.id);
    if (!b) continue;
    if (boardFilter && !(b.name.toLowerCase().includes(boardFilter) || b.id === opts.board)) continue;
    for (const col of b.columns) {
      for (const card of col.cards) {
        if (card.archived) continue;
        const isComplete = !!card.complete;

        if (status === 'open' && isComplete) continue;
        if (status === 'complete' && !isComplete) continue;

        // Due date is date-only (YYYY-MM-DD); compare at local midnight.
        let dueInDays = null, overdue = false;
        if (card.dueDate) {
          const d = new Date(card.dueDate + 'T00:00:00');
          if (!Number.isNaN(d.getTime())) {
            const dueMid = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            dueInDays = Math.round((dueMid - startOfToday) / MS_DAY);
            overdue = dueInDays < 0 && !isComplete;
          }
        }

        if (due !== 'any') {
          if (due === 'none') { if (card.dueDate) continue; }
          else if (dueInDays === null) continue;
          else if (due === 'today') { if (dueInDays !== 0) continue; }
          else if (due === 'tomorrow') { if (dueInDays !== 1) continue; }
          else if (due === 'week') { if (dueInDays < 0 || dueInDays > 7) continue; }
          else if (due === 'overdue') { if (!(dueInDays < 0) || isComplete) continue; }
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
          dueDate: card.dueDate || null, dueInDays, overdue,
          priority: card.priority || 'none', priorityName: prioName(card.priority || 'none'),
          tags: card.tags || [], source: card.source || null,
          complete: isComplete, completedAt: card.completedAt || null, completedDaysAgo,
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

export { INDEX_FILE, DEFAULT_COLUMNS, sortColumn };
