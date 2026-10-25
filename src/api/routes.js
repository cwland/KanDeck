/**
 * REST API (spec 2.7 + the richer endpoints the UI needs).
 *
 * Spec-required:
 *   GET  /api/boards            list boards + summary meta
 *   GET  /api/boards/:id        full board schema (columns + cards)
 *   POST /api/tasks             create a task/card programmatically
 *   PUT  /api/tasks/:id         update a task (status/move)
 *
 * Plus board/column/card management used by the web UI.
 * All routes are mounted under /api and protected by requireApiAuth.
 */
import { Router } from 'express';
import * as boards from '../storage/boards.js';
import * as inbox from '../storage/inbox.js';
import * as settings from '../storage/settings.js';
import { getApiKey, setApiKey, generateApiKeyValue } from '../auth.js';
import { events } from '../events.js';
import { createBackup, listBackups, restoreBackup, rescheduleBackups } from '../services/backup.js';
import { testEmail, testDiscord, emailProvider, discordProvider } from '../services/notify/index.js';
import config from '../config.js';
import { getChangelog } from '../services/changelog.js';

const router = Router();

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[api]', err);
    // Don't leak filesystem paths / low-level errors to the client; keep clean
    // validation messages (thrown Errors without path/errno text).
    const msg = err && err.message ? String(err.message) : '';
    const leaky = /[\/\\]|ENOENT|EACCES|EPERM|errno/i.test(msg);
    res.status(400).json({ error: leaky || !msg ? 'Request failed' : msg });
  });

// ---- Boards ----------------------------------------------------------------

// ?archived=1 lists archived boards (App settings → Archives) instead.
router.get('/boards', wrap(async (req, res) => {
  const archived = ['1', 'true', 'yes'].includes(String(req.query.archived || '').toLowerCase());
  res.json({ boards: await boards.listBoards({ archived }) });
}));

router.post('/boards', wrap(async (req, res) => {
  const board = await boards.createBoard({
    name: req.body?.name,
    description: req.body?.description,
  });
  res.status(201).json(board);
}));

// Global search-as-you-type across all boards.
router.get('/search', wrap(async (req, res) => {
  res.json({ results: await boards.searchCards(req.query.q) });
}));

// Live event stream (Server-Sent Events) so the UI can refresh in real time
// when inbox items or cards arrive (e.g. via the webhook API). Auth is via the
// session cookie (EventSource can't send a bearer header).
router.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 3000\n\n');

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data || {})}\n\n`);
  };
  const onInbox = (p) => send('inbox', p);
  const onCard = (p) => send('card', p);
  events.on('inbox:created', onInbox);
  events.on('card:created', onCard);
  events.on('card:moved', onCard);
  events.on('card:updated', onCard);

  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    events.off('inbox:created', onInbox);
    events.off('card:created', onCard);
    events.off('card:moved', onCard);
    events.off('card:updated', onCard);
  });
});

router.get('/boards/:id', wrap(async (req, res) => {
  const board = await boards.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
}));

router.put('/boards/:id', wrap(async (req, res) => {
  const board = await boards.updateBoard(req.params.id, req.body || {});
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
}));

router.post('/boards/:id/archive', wrap(async (req, res) => {
  const board = await boards.setBoardArchived(req.params.id, true);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
}));

router.post('/boards/:id/unarchive', wrap(async (req, res) => {
  const board = await boards.setBoardArchived(req.params.id, false);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
}));

// ---- Calendar feed (.ics) management --------------------------------------
// The feed itself is served publicly at /ics/:boardId/:token.ics (server.js).

router.post('/boards/:id/ics', wrap(async (req, res) => {
  const ics = await boards.enableIcs(req.params.id, { rotate: !!req.body?.rotate });
  if (!ics) return res.status(404).json({ error: 'Board not found' });
  res.json(ics);
}));

router.put('/boards/:id/ics', wrap(async (req, res) => {
  const ics = await boards.updateIcsOptions(req.params.id, req.body || {});
  if (!ics) return res.status(404).json({ error: 'Board not found' });
  res.json(ics);
}));

router.delete('/boards/:id/ics', wrap(async (req, res) => {
  const ics = await boards.disableIcs(req.params.id);
  if (!ics) return res.status(404).json({ error: 'Board not found' });
  res.json(ics);
}));

router.delete('/boards/:id', wrap(async (req, res) => {
  await boards.deleteBoard(req.params.id);
  res.json({ ok: true });
}));

router.post('/boards/reorder', wrap(async (req, res) => {
  res.json({ boards: await boards.reorderBoards(req.body?.order || []) });
}));

// ---- Columns ---------------------------------------------------------------

router.post('/boards/:id/columns', wrap(async (req, res) => {
  res.status(201).json(await boards.addColumn(req.params.id, req.body?.name, req.body?.color));
}));

router.put('/boards/:id/columns/:columnId', wrap(async (req, res) => {
  res.json(await boards.updateColumn(req.params.id, req.params.columnId, req.body || {}));
}));

router.delete('/boards/:id/columns/:columnId', wrap(async (req, res) => {
  res.json(await boards.deleteColumn(req.params.id, req.params.columnId));
}));

router.post('/boards/:id/columns/reorder', wrap(async (req, res) => {
  res.json(await boards.reorderColumns(req.params.id, req.body?.order || []));
}));

// ---- Cards / tasks ---------------------------------------------------------

// UI-friendly create under a board+column
router.post('/boards/:id/cards', wrap(async (req, res) => {
  const card = await boards.addCard(req.params.id, req.body?.columnId, req.body || {});
  res.status(201).json(card);
}));

// Read-only task query for external assistants (n8n) — flattened cards across
// all boards with server-side date filtering. See boards.queryTasks for params.
// e.g. GET /api/tasks/query?due=today  ·  ?due=week  ·  ?status=complete&completedWithin=3
router.get('/tasks/query', wrap(async (req, res) => {
  res.json(await boards.queryTasks(req.query || {}));
}));

/** Tag routing for incoming tasks with no boardId: if one of the task's tags
 *  is a board's routing tag, add it to that board's first lane; otherwise
 *  return null (caller puts it in the Inbox). */
async function routeByTags(body, defaultSource) {
  const tags = boards.parseTags(body.tags);
  const match = tags.length ? await boards.findBoardForTags(tags) : null;
  if (!match) return null;
  const card = await boards.addCard(match.board.id, null, { ...body, tags, source: body.source || defaultSource });
  events.emit('card:created', { boardId: match.board.id, card });
  return { target: 'board', boardId: match.board.id, boardName: match.board.name, routedBy: match.tag, card };
}

// Spec endpoint: create a task programmatically.
// Routing: with a boardId it goes straight to that board; with no boardId, a
// task whose tags match a board's routing tags goes to that board's first
// lane; anything else lands in the Inbox for triage.
router.post('/tasks', wrap(async (req, res) => {
  const body = req.body || {};
  if (body.boardId) {
    const card = await boards.addCard(body.boardId, body.columnId, body);
    events.emit('card:created', { boardId: body.boardId, card });
    return res.status(201).json({ target: 'board', boardId: body.boardId, card });
  }
  const routed = await routeByTags(body, 'api');
  if (routed) return res.status(201).json(routed);
  const item = await inbox.addItem({ ...body, tags: boards.parseTags(body.tags), source: body.source || 'api' });
  events.emit('inbox:created', { item });
  res.status(201).json({ target: 'inbox', item });
}));

// Every board's routing tags (for the board-settings duplicate check).
router.get('/route-tags', wrap(async (req, res) => {
  const map = await boards.getRouteTagMap();
  res.json({ tags: [...map.values()] });
}));

// Spec endpoint: update a task (edit fields, move columns).
router.put('/tasks/:id', wrap(async (req, res) => {
  const located = await boards.findCardAnywhere(req.params.id);
  if (!located) return res.status(404).json({ error: 'Task not found' });
  const { boardId } = located;
  const body = req.body || {};

  // Move if a target column is supplied.
  if (body.columnId || body.toColumnId) {
    const move = await boards.moveCard(
      boardId,
      req.params.id,
      body.toColumnId || body.columnId,
      body.index
    );
    if (move?.movedColumns) events.emit('card:moved', { boardId, ...move });
  }

  const patch = { ...body };
  delete patch.columnId;
  delete patch.toColumnId;
  delete patch.index;
  const card = await boards.updateCard(boardId, req.params.id, patch);
  events.emit('card:updated', { boardId, card });
  res.json({ boardId, card });
}));

router.post('/boards/:id/cards/:cardId/move', wrap(async (req, res) => {
  const move = await boards.moveCard(
    req.params.id,
    req.params.cardId,
    req.body?.toColumnId,
    req.body?.index
  );
  if (!move) return res.status(404).json({ error: 'Card not found' });
  if (move.movedColumns) events.emit('card:moved', { boardId: req.params.id, ...move });
  res.json(move);
}));

router.delete('/boards/:id/cards/:cardId', wrap(async (req, res) => {
  res.json({ ok: await boards.deleteCard(req.params.id, req.params.cardId) });
}));

// ---- Archived cards (rec #2) ----------------------------------------------

router.get('/boards/:id/archived', wrap(async (req, res) => {
  const board = await boards.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  const archived = [];
  for (const col of board.columns)
    for (const card of col.cards)
      if (card.archived) archived.push({ ...card, columnId: col.id, columnName: col.name });
  res.json({ archived });
}));

// ---- Backups (spec 2.1) ----------------------------------------------------

router.get('/backups', wrap(async (req, res) => {
  res.json({ backups: await listBackups() });
}));

router.post('/backups', wrap(async (req, res) => {
  res.status(201).json(await createBackup('manual'));
}));

router.post('/backups/restore', wrap(async (req, res) => {
  if (!req.body?.file) return res.status(400).json({ error: 'file required' });
  res.json(await restoreBackup(req.body.file));
}));

// ---- App-level settings (priorities + default colors) ----------------------

router.get('/settings', wrap(async (req, res) => {
  res.json({ ...(await settings.getSettings()), version: config.version, appUrl: config.appUrl });
}));

// General merge: accepts { theme?, priorities?, laneColors? }.
router.put('/settings', wrap(async (req, res) => {
  res.json(await settings.updateSettings(req.body || {}));
}));

router.put('/settings/priorities', wrap(async (req, res) => {
  const priorities = await settings.updatePriorities(req.body?.priorities || []);
  res.json({ priorities });
}));

// ---- What's new (changelog) -------------------------------------------------
// Current version's changes + the 10 releases before it, and whether the user
// has already dismissed the window for this version.
router.get('/changelog', wrap(async (req, res) => {
  const lastSeenVersion = await settings.getLastSeenVersion();
  res.json({
    current: config.version,
    lastSeenVersion,
    unseen: lastSeenVersion !== config.version,
    entries: await getChangelog({ previous: 10 }),
  });
}));

// Dismissing the window marks the running version as seen.
router.put('/changelog/seen', wrap(async (req, res) => {
  res.json({ lastSeenVersion: await settings.setLastSeenVersion(config.version) });
}));

// ---- App-wide calendar feed (App settings → Calendar) ----------------------
// The feed itself is served publicly at /ics/all/:token.ics (server.js).

router.get('/ics', wrap(async (req, res) => {
  res.json(await settings.getGlobalIcs());
}));

router.post('/ics', wrap(async (req, res) => {
  res.json(await settings.enableGlobalIcs({ rotate: !!req.body?.rotate }));
}));

router.put('/ics', wrap(async (req, res) => {
  res.json(await settings.updateGlobalIcsOptions(req.body || {}));
}));

router.delete('/ics', wrap(async (req, res) => {
  res.json(await settings.disableGlobalIcs());
}));

// ---- API key management (for external apps) --------------------------------
// Behind requireApiAuth, so only an authenticated session (or an existing key)
// can read or rotate it.

router.get('/apikey', wrap(async (req, res) => {
  res.json({ apiKey: await getApiKey() });
}));

router.post('/apikey', wrap(async (req, res) => {
  const key = generateApiKeyValue();
  await setApiKey(key);
  res.status(201).json({ apiKey: key });
}));

router.delete('/apikey', wrap(async (req, res) => {
  await setApiKey(null);
  res.json({ apiKey: '' });
}));

// ---- Notifications (email + Discord summaries) -----------------------------

// Reject an enable-save that's missing categories, days, or a time.
function validateContentAndSchedule(body) {
  const c = body.content || {};
  const anyCat = (c.upcoming && c.upcoming.enabled) || (c.dueToday && c.dueToday.enabled) || (c.pastDue && c.pastDue.enabled);
  if (!anyCat) return 'Enable at least one notification category.';
  const days = (body.schedule || {}).days;
  if (!Array.isArray(days) || days.length === 0) return 'Select at least one day of the week.';
  if (!/^\d{1,2}:\d{2}$/.test((body.schedule || {}).time || '')) return 'Set a send time.';
  return null;
}

router.get('/notifications', wrap(async (req, res) => {
  res.json(await settings.getNotificationConfigMasked());
}));

router.put('/notifications/email', wrap(async (req, res) => {
  const body = req.body || {};
  if (body.enabled) {
    for (const f of ['host', 'user', 'from', 'to']) {
      if (!String(body[f] || '').trim()) return res.status(400).json({ error: `${f === 'from' ? 'Sender' : f === 'to' ? 'Recipient' : f} is required.` });
    }
    const saved = await settings.getNotificationConfig();
    const pass = body.pass || saved.email.pass;
    if (!pass) return res.status(400).json({ error: 'SMTP password is required.' });
    const vmsg = validateContentAndSchedule(body);
    if (vmsg) return res.status(400).json({ error: vmsg });
    const v = await emailProvider.verify({ host: body.host, port: body.port, user: body.user, encryption: body.encryption, pass });
    if (!v.ok) return res.status(400).json({ error: `SMTP validation failed: ${v.error}` });
  }
  await settings.updateEmailConfig(body);
  res.json((await settings.getNotificationConfigMasked()).email);
}));

router.put('/notifications/discord', wrap(async (req, res) => {
  const body = req.body || {};
  if (body.enabled) {
    const vmsg = validateContentAndSchedule(body);
    if (vmsg) return res.status(400).json({ error: vmsg });
    const v = await discordProvider.validate(body.webhookUrl || '');
    if (!v.ok) return res.status(400).json({ error: v.error });
  }
  await settings.updateDiscordConfig(body);
  res.json((await settings.getNotificationConfigMasked()).discord);
}));

router.post('/notifications/email/test', wrap(async (req, res) => {
  res.json(await testEmail(req.body || {}));
}));

router.post('/notifications/discord/test', wrap(async (req, res) => {
  res.json(await testDiscord(req.body || {}));
}));

// ---- Backup auto-schedule config -------------------------------------------

router.get('/backups/config', wrap(async (req, res) => {
  res.json(await settings.getBackupConfig());
}));

router.put('/backups/config', wrap(async (req, res) => {
  const cfg = await settings.updateBackupConfig(req.body || {});
  await rescheduleBackups(); // apply the new schedule live
  res.json(cfg);
}));

// ---- Inbox -----------------------------------------------------------------

router.get('/inbox', wrap(async (req, res) => {
  res.json({ items: await inbox.listItems() });
}));

router.post('/inbox', wrap(async (req, res) => {
  const body = req.body || {};
  // Tag routing applies here too, so pushes to /api/inbox behave like /api/tasks.
  const routed = await routeByTags(body, 'api');
  if (routed) return res.status(201).json(routed);
  const item = await inbox.addItem({ ...body, tags: boards.parseTags(body.tags), source: body.source || 'ui' });
  events.emit('inbox:created', { item });
  res.status(201).json(item);
}));

// Re-run routing tags over everything in the Inbox (the ↻ button).
router.post('/inbox/reprocess', wrap(async (req, res) => {
  const result = await inbox.reprocess();
  for (const m of result.moved) events.emit('card:created', { boardId: m.boardId, card: m.card });
  res.json({ moved: result.moved.map(({ card, ...rest }) => rest), remaining: result.remaining });
}));

router.put('/inbox/:id', wrap(async (req, res) => {
  const item = await inbox.updateItem(req.params.id, req.body || {});
  if (!item) return res.status(404).json({ error: 'Inbox item not found' });
  res.json(item);
}));

router.delete('/inbox/:id', wrap(async (req, res) => {
  res.json({ ok: !!(await inbox.removeItem(req.params.id)) });
}));

router.post('/inbox/:id/move', wrap(async (req, res) => {
  const { boardId, columnId, index } = req.body || {};
  // columnId is optional: omit it to drop the card into the board's first
  // column (used by the inbox card's "send to board" menu).
  if (!boardId) return res.status(400).json({ error: 'boardId required' });
  const result = await inbox.moveToBoard(req.params.id, boardId, columnId, index);
  if (!result) return res.status(404).json({ error: 'Inbox item not found' });
  if (result.card) events.emit('card:created', { boardId, card: result.card });
  res.json(result);
}));

export default router;
