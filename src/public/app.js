/* ===================== KanDeck front-end ===================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const THEMES = window.THEMES || [];

  const state = {
    boards: [],       // summary list
    boardId: null,    // active board id
    board: null,      // active full board
    priorities: [],   // app-level categories (id, name, color)
    laneColors: [],   // app-level lane color palette
    badges: { due: { color: '#d0ebff', textColor: '#1864ab' }, tag: { color: '#e5dbff', textColor: '#5f3dc4' }, source: { color: '#c3fae8', textColor: '#0b7285' } },
    themeId: window.DEFAULT_THEME || 'light-blue',
    inbox: [],        // inbox items
    zoom: 100,        // current board zoom %
    search: '',
    editingCardId: null,
    editingColumnId: null,
    editingInboxId: null, // set while editing an inbox item in the card modal
    newBoardId: null, // set while configuring a brand-new board (rollback on cancel)
  };

  // Close the board modal; if it's an unsaved brand-new board, roll it back.
  function closeBoardModal() {
    boardModal.hidden = true;
    if (state.newBoardId) {
      const id = state.newBoardId; state.newBoardId = null;
      state.boardId = null; // don't try to reopen the board we're deleting
      api('/boards/' + id, { method: 'DELETE' })
        .then(() => loadBoards())
        .catch(() => {});
    }
  }

  // ---- Keep password managers out of the app's own fields ----
  // The settings windows contain username/password boxes (Account tab, SMTP
  // password) that aren't a login form, so 1Password & co. kept popping up
  // while clicking through tabs. Mark every field in the app shell as "ignore"
  // for the common managers. The sign-in page (login.html) is untouched, so
  // your password manager still fills the real login there.
  const PM_IGNORE = { 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' };
  function pmIgnore(root) {
    const els = root.matches && root.matches('input, textarea, select') ? [root] : [];
    if (root.querySelectorAll) els.push(...root.querySelectorAll('input, textarea, select'));
    for (const el of els) for (const [k, v] of Object.entries(PM_IGNORE)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
  }
  pmIgnore(document.body);
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => n.nodeType === 1 && pmIgnore(n)); })
    .observe(document.body, { childList: true, subtree: true });

  // ---- App-level categories (a.k.a. priorities) ----
  function priObj(id) { return (state.priorities || []).find((p) => p.id === id); }
  function priColor(id) { const p = priObj(id); return p ? p.color : null; }
  function priText(id) { const p = priObj(id); return p && p.textColor ? p.textColor : null; }
  function priName(id) { const p = priObj(id); return p ? p.name : id; }
  // Which fields to show on cards (per board; priority + due date on by default).
  function cardFields() {
    return { priority: true, dueDate: true, tags: false, source: false, alarm: true, email: true, ...((state.board && state.board.settings.cardFields) || {}) };
  }
  // The last lane is always the done lane, whatever it's called.
  function doneColId(board = state.board) {
    const cols = (board && board.columns) || [];
    return cols.length ? cols[cols.length - 1].id : null;
  }
  // Per-board "Show archived" toggle on the done lane (a per-browser convenience).
  function showArchivedDone(boardId) {
    try { return localStorage.getItem('kandeck.showArchivedDone.' + boardId) === '1'; } catch (_) { return false; }
  }
  function setShowArchivedDone(boardId, on) {
    try { localStorage.setItem('kandeck.showArchivedDone.' + boardId, on ? '1' : '0'); } catch (_) {}
  }
  function laneColorAt(i) { const l = state.laneColors; return l.length ? l[i % l.length] : '#838c91'; }
  async function loadSettings() {
    const s = await api('/settings');
    state.settings = s;
    state.priorities = s.priorities || [];
    state.laneColors = s.laneColors || [];
    if (s.badges) state.badges = s.badges;
    state.themeId = s.theme || window.DEFAULT_THEME || 'light-blue';
    applyTheme(state.themeId);
    if (s.version) {
      $('#versionFoot').textContent = 'KanDeck v' + s.version;
    }
  }

  // ---- API ----
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { window.location.href = '/login'; throw new Error('unauth'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.status === 204 ? null : res.json();
  }

  // ---- Contrast helper: pick black/white text for any bg (WCAG AA) ----
  function textOn(hex) {
    if (!hex) return 'inherit';
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16) / 255;
    const g = parseInt(c.substr(2, 2), 16) / 255;
    const b = parseInt(c.substr(4, 2), 16) / 255;
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // contrast vs white vs black; choose the higher.
    const cWhite = 1.05 / (L + 0.05);
    const cBlack = (L + 0.05) / 0.05;
    return cBlack >= cWhite ? '#000000' : '#ffffff';
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---- Theme (app-level presets: 10 light + 10 dark) ----
  function themeObj(id) { return THEMES.find((t) => t.id === id) || THEMES[0]; }
  function hexToRgb(h) { const c = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(c.substr(i, 2), 16)); }
  function mix(a, b, ratio) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const m = A.map((x, i) => Math.round(x * ratio + B[i] * (1 - ratio)));
    return '#' + m.map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function applyTheme(id) {
    const t = themeObj(id);
    if (!t) return;
    state.themeId = t.id;
    const root = document.documentElement;
    root.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    const s = root.style;
    s.setProperty('--accent', t.accent);
    // Vertical accent wash: a saturated accent tint under the menu that
    // fades lighter toward the bottom. The topbar is the darkest band, so the
    // whole page reads dark-at-top → light-at-bottom. The inbox uses the SAME
    // accent hue but a deeper shade, so it reads as a sibling panel of the main
    // window rather than a contrasting color.
    if (t.dark) {
      s.setProperty('--bg-grad-1', mix(t.accent, '#1d2125', 0.34)); // board top
      s.setProperty('--bg-grad-2', mix(t.accent, '#1d2125', 0.06)); // board bottom
      s.setProperty('--topbar', mix(t.accent, '#12151a', 0.30));    // darkest band
      s.setProperty('--inbox-grad-1', mix(t.accent, '#1d2125', 0.46)); // inbox top (richer)
      s.setProperty('--inbox-grad-2', mix(t.accent, '#1d2125', 0.16)); // inbox bottom
    } else {
      s.setProperty('--bg-grad-1', mix(t.accent, '#ffffff', 0.62)); // board top
      s.setProperty('--bg-grad-2', mix(t.accent, '#ffffff', 0.16)); // board bottom
      s.setProperty('--topbar', t.accent);                          // darkest band
      s.setProperty('--inbox-grad-1', mix(t.accent, '#ffffff', 0.76)); // inbox top (deeper shade)
      s.setProperty('--inbox-grad-2', mix(t.accent, '#ffffff', 0.40)); // inbox bottom
    }
    // Cache the resolved vars so the inline <head> boot script can paint the
    // right theme on the very first frame (no blue→theme flash on reload).
    try {
      localStorage.setItem('kandeck.themeCache', JSON.stringify({
        dark: !!t.dark,
        accent: t.accent,
        g1: s.getPropertyValue('--bg-grad-1'),
        g2: s.getPropertyValue('--bg-grad-2'),
        topbar: s.getPropertyValue('--topbar'),
        ig1: s.getPropertyValue('--inbox-grad-1'),
        ig2: s.getPropertyValue('--inbox-grad-2'),
      }));
    } catch (_) {}
  }

  // ---- Boards / tabs ----
  async function loadBoards(selectId) {
    const { boards } = await api('/boards');
    state.boards = boards;
    renderBoardSwitcher();
    const current = boards.some((b) => b.id === state.boardId) ? state.boardId : null;
    const target = selectId || current || boards[0]?.id;
    if (target) await openBoard(target);
    else {
      state.boardId = null; state.board = null; $('#board').innerHTML = '';
      $('#boardName').textContent = 'No boards';
      $('#boardDesc').textContent = 'Create one with ＋, or restore one from App settings → Archives.';
    }
  }

  async function openBoard(id) {
    state.boardId = id;
    state.board = await api('/boards/' + id);
    const s = state.board.settings;
    setZoom(s.zoom, false);
    $('#autoSort').checked = !!s.autoSort;
    $('#autoSortKey').value = s.autoSortKey || 'priority';
    renderHeader();
    renderBoard();
    renderBoardSwitcher();
  }

  // Clicking a card's ✉️ opens the link without opening the card window.
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.email-badge')) e.stopPropagation(); }, true);

  // ---- Board tabs (top, centered): "Home (1) | Work (5)" ----
  // Counts are open cards (not done, not archived). They're refreshed from the
  // server whenever any board changes — locally or behind the scenes (API,
  // n8n, tag routing, auto-archive) via the live event stream.
  function renderBoardSwitcher() {
    const nav = $('#boardSwitcher'); if (!nav) return;
    nav.innerHTML = '';
    state.boards.forEach((b, i) => {
      if (i) { const sep = document.createElement('span'); sep.className = 'bs-sep'; sep.textContent = '|'; sep.setAttribute('aria-hidden', 'true'); nav.appendChild(sep); }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bs-tab' + (b.id === state.boardId ? ' active' : '');
      if (b.id === state.boardId) btn.setAttribute('aria-current', 'page');
      const n = b.openCount || 0;
      btn.title = `${b.name} — ${n} open card${n === 1 ? '' : 's'}`;
      btn.innerHTML = `<span class="bs-name">${esc(b.name)}</span> <span class="bs-count${n ? '' : ' zero'}">(${n})</span>`;
      btn.onclick = async () => { if (b.id !== state.boardId) await openBoard(b.id); };
      nav.appendChild(btn);
    });
    const act = $('.bs-tab.active', nav); if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  async function refreshBoardCounts() {
    try { state.boards = (await api('/boards')).boards; renderBoardSwitcher(); } catch {}
  }

  function renderHeader() {
    $('#boardName').textContent = state.board.name;
    $('#boardDesc').textContent = state.board.description || '';
  }

  // ---- Zoom (floating split bubble: left half out, right half in) ----
  function setZoom(z, persist = true) {
    z = Math.max(60, Math.min(140, z));
    state.zoom = z;
    document.documentElement.style.setProperty('--z', z / 100);
    const lbl = $('#zbLabel'); if (lbl) lbl.textContent = z + '%';
    if (persist && state.board) {
      state.board.settings.zoom = z;
      api('/boards/' + state.boardId, { method: 'PUT', body: { settings: { zoom: z } } }).catch(() => {});
    }
  }
  $('#zbOut').onclick = () => setZoom((state.zoom || 100) - 10);
  $('#zbIn').onclick = () => setZoom((state.zoom || 100) + 10);

  // ---- Render board columns + cards ----
  function cardMatchesSearch(card) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return (
      card.subject.toLowerCase().includes(q) ||
      (card.description || '').toLowerCase().includes(q) ||
      (card.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }

  function renderCard(card, inDoneLane = false) {
    const li = document.createElement('li');
    li.className = 'card' + (card.complete ? ' complete' : '') + (card.archived ? ' archived' : ''); // cards are always white
    li.dataset.id = card.id;

    const cf = cardFields();
    let badges = '';
    if (cf.priority && card.priority && card.priority !== 'none') {
      const pc = priColor(card.priority) || '#868e96';
      const tc = priText(card.priority) || textOn(pc);
      badges += `<span class="badge" style="background:${pc};color:${tc}">${esc(priName(card.priority))}</span>`;
    }
    if (cf.dueDate && card.dueDate) {
      const due = new Date(card.dueDate);
      const overdue = due < new Date();
      const dstyle = overdue ? '' : `style="background:${state.badges.due.color};color:${state.badges.due.textColor}"`;
      badges += `<span class="badge due ${overdue ? 'overdue' : ''}" ${dstyle}>📅 ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`;
    }
    if (card.archived) badges += `<span class="badge archived-badge" title="${card.autoArchived ? 'Auto-archived' : 'Archived'}${card.archivedAt ? ' ' + esc(new Date(card.archivedAt).toLocaleDateString()) : ''}">Archived</span>`;
    // Completed date only shows on cards in the done (last) lane.
    if (inDoneLane && card.completedAt) {
      const cd = new Date(card.completedAt);
      badges += `<span class="badge done-badge" title="Completed ${esc(cd.toLocaleString())}">✓ ${cd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`;
    }
    if (cf.alarm && card.alarm && !card.complete) badges += alarmBadge(card.alarm, 'badge');
    if (cf.email && card.email) badges += emailBadge(card.email, 'badge');
    if (cf.source && card.source) {
      const s = state.badges.source;
      badges += `<span class="tag-chip" style="background:${s.color};color:${s.textColor}">${esc(card.source)}</span>`;
    }
    if (cf.tags) (card.tags || []).forEach((t) => {
      badges += `<span class="tag-chip" style="background:${state.badges.tag.color};color:${state.badges.tag.textColor}">${esc(t)}</span>`;
    });

    li.innerHTML =
      `<div class="card-main">` +
      `<div class="card-title">${esc(card.subject)}</div>` +
      (badges ? `<div class="card-badges">${badges}</div>` : '') +
      `</div>` +
      `<button class="card-check" title="Mark complete"><span class="chk">✓</span></button>`;
    li.querySelector('.card-check').onclick = (e) => { e.stopPropagation(); toggleComplete(card, li); };
    li.onclick = () => openCardModal(card);
    return li;
  }

  // Complete = live in the board's complete lane. Clicking the circle moves the
  // card there (with a quick animation); clicking a completed card's check moves
  // it back out. Dragging in/out also flips complete (handled server-side).
  async function toggleComplete(card, li) {
    const completeCol = doneColId();
    if (!completeCol) return;
    if (state.board.columns.length < 2) { toast('Add another lane first — the last lane is the done lane'); return; }
    if (!card.complete) {
      li.classList.add('completing');
      setTimeout(async () => {
        try {
          await api(`/boards/${state.boardId}/cards/${card.id}/move`, { method: 'POST', body: { toColumnId: completeCol, index: 0 } });
        } finally { await refresh(); }
      }, 260);
    } else {
      // Un-complete: return the card to the column it came from (if it still
      // exists), else fall back to the first non-complete lane.
      const cols = state.board.columns;
      const origin = card.prevColumnId ? cols.find((c) => c.id === card.prevColumnId) : null;
      const dest = origin || cols.find((c) => c.id !== completeCol) || cols[0];
      if (dest) await api(`/boards/${state.boardId}/cards/${card.id}/move`, { method: 'POST', body: { toColumnId: dest.id, index: 0 } });
      await refresh();
    }
  }

  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0; return h; }

  function renderBoard() {
    const board = $('#board');
    board.innerHTML = '';
    state.board.columns.forEach((col) => {
      const wrap = document.createElement('section');
      wrap.className = 'column';
      wrap.dataset.id = col.id;
      // Lane color drives the header (cards stay white). Lanes are added,
      // deleted, recolored and reordered only in Board settings.
      if (col.color) {
        wrap.style.setProperty('--lane', col.color);
        wrap.style.setProperty('--lane-text', textOn(col.color));
      }
      const isComplete = col.id === doneColId();
      if (isComplete) wrap.classList.add('is-complete-lane');
      const visible = col.cards.filter((c) => !c.archived && cardMatchesSearch(c));
      // Done lane: archived cards (auto-archived after N days, or archived by
      // hand) stay in the lane but are hidden unless "Show archived" is on.
      const archivedHere = isComplete ? col.cards.filter((c) => c.archived && cardMatchesSearch(c)) : [];
      const showArchived = isComplete && showArchivedDone(state.boardId);
      const autoDays = parseInt(state.board.settings.autoArchiveDays, 10) || 0;
      const showToggle = isComplete && (archivedHere.length > 0 || autoDays > 0);
      wrap.innerHTML = `
        <div class="column-head">
          <span class="column-title">${esc(col.name)}</span>
          ${isComplete ? '<span class="lane-complete-badge" title="Done lane (always the last lane)">✓</span>' : ''}
          <span class="col-count">${visible.length}</span>
          ${showToggle ? (() => {
            const n = archivedHere.length;
            const help = (showArchived ? 'Hide' : 'Show') + ` archived tasks (${n})` +
              (autoDays > 0 ? ` — done tasks auto-archive ${autoDays} day${autoDays === 1 ? '' : 's'} after completion` : '');
            return `<button type="button" class="archive-toggle${showArchived ? ' on' : ''}" title="${esc(help)}" aria-label="${esc(help)}" aria-pressed="${showArchived}">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/></svg>
              ${n ? `<span class="at-count">${n}</span>` : ''}
            </button>`;
          })() : ''}
        </div>
        <ul class="cards" data-col="${col.id}"></ul>
        <button class="add-card">＋ Add a card</button>`;
      const ul = $('.cards', wrap);
      visible.forEach((c) => ul.appendChild(renderCard(c, isComplete)));
      // Archived cards render after the active ones, dimmed and not draggable
      // (open one and click Unarchive, or drag isn't needed).
      if (showArchived) archivedHere.forEach((c) => ul.appendChild(renderCard(c, true)));
      const atBtn = $('.archive-toggle', wrap);
      if (atBtn) atBtn.onclick = (e) => { e.stopPropagation(); setShowArchivedDone(state.boardId, !showArchived); renderBoard(); };

      $('.add-card', wrap).onclick = () => openNewCardModal(col.id);

      makeSortable(ul);
      board.appendChild(wrap);
    });
  }

  // ---- Drag & drop ----
  function makeSortable(ul) {
    if (typeof Sortable === 'undefined') return; // resilient if lib fails to load
    new Sortable(ul, {
      group: 'cards',
      animation: 150,
      draggingClass: 'dragging',
      ghostClass: 'dragging',
      filter: '.archived',      // archived cards can't be dragged…
      preventOnFilter: false,   // …but can still be clicked open
      onEnd: async (evt) => {
        const cardId = evt.item.dataset.id;
        const toColumnId = evt.to.dataset.col;
        const index = evt.newIndex;
        try {
          await api(`/boards/${state.boardId}/cards/${cardId}/move`, { method: 'POST', body: { toColumnId, index } });
          await refresh(); // re-render so complete status (check) updates
        } catch (e) { toast('Move failed'); refresh(); }
      },
    });
  }
  async function refresh() { state.board = await api('/boards/' + state.boardId); renderHeader(); renderBoard(); refreshBoardCounts(); }

  // ---- Card modal ----
  const cardModal = $('#cardModal');
  function toDateInput(iso) {
    if (!iso) return '';
    const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  // Alarm: stored as ISO (UTC); edited in a local datetime-local input.
  function toDateTimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function alarmFromInput() {
    const v = $('#cardAlarm').value;
    return v ? new Date(v).toISOString() : null; // datetime-local is local time
  }
  function alarmBadge(alarm, cls) {
    if (!alarm) return '';
    const d = new Date(alarm); if (Number.isNaN(d.getTime())) return '';
    const past = d < new Date();
    const when = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<span class="${cls} alarm-badge${past ? ' past' : ''}" title="Alarm: ${esc(d.toLocaleString())}${past ? ' (passed)' : ''}">⏰ ${esc(when)}</span>`;
  }
  $('#cardAlarmClear').onclick = () => { $('#cardAlarm').value = ''; };

  // Email field: an address (→ mail app) or a link (→ new tab). Only http(s) /
  // mailto become links, so nothing like javascript: can sneak in.
  function emailHref(v) {
    v = String(v || '').trim(); if (!v) return null;
    if (/^(https?:|mailto:)/i.test(v)) return v;
    if (/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(v)) return 'mailto:' + v;
    return null;
  }
  // Full address / URL (the field spans the window; long links end in …).
  function emailLabel(v) { return String(v).replace(/^mailto:/i, ''); }
  function setEmailUI(v, editing = false) {
    v = String(v || '').trim();
    $('#cardEmail').value = v;
    const href = emailHref(v);
    const a = $('#cardEmailLink');
    if (href) { a.href = href; a.textContent = (href.startsWith('mailto:') ? '✉️ ' : '🔗 ') + emailLabel(v); a.title = v; a.hidden = false; }
    else { a.removeAttribute('href'); a.textContent = ''; a.hidden = true; }
    $('#cardEmailNone').hidden = !!href;
    $('#cardEmailView').hidden = editing;
    $('#cardEmailEditor').hidden = !editing;
  }
  $('#cardEmailEdit').onclick = () => { setEmailUI($('#cardEmail').value, true); $('#cardEmail').focus(); $('#cardEmail').select(); };
  function finishEmailEdit() {
    const v = $('#cardEmail').value.trim();
    if (v && !emailHref(v)) { toast('Enter an email address or an http(s) link'); $('#cardEmail').focus(); return false; }
    setEmailUI(v, false); return true;
  }
  $('#cardEmailDone').onclick = finishEmailEdit;
  $('#cardEmail').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finishEmailEdit(); } else if (e.key === 'Escape') { e.stopPropagation(); finishEmailEdit(); } };
  function emailBadge(v, cls) {
    const href = emailHref(v); if (!href) return '';
    return `<a class="${cls} email-badge" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(v)}">✉️</a>`;
  }

  // Board picker in the card window (move a mis-filed card to another board).
  function fillCardBoardSelect(currentId) {
    const sel = $('#cardBoard'); sel.innerHTML = '';
    state.boards.forEach((b) => { const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
    sel.value = currentId;
  }
  function buildPriorityOptions() {
    const sel = $('#cardPriority'); sel.innerHTML = '';
    (state.priorities || []).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      sel.appendChild(o);
    });
  }

  function openCardModal(card) {
    state.editingCardId = card.id;
    state.newCardColumnId = null;
    state.editingInboxId = null;
    buildPriorityOptions();
    $('#cardSubject').value = card.subject;
    $('#cardDesc').value = card.description || '';
    $('#cardPriority').value = card.priority || 'none';
    $('#cardDue').value = toDateInput(card.dueDate);
    $('#cardAlarm').value = toDateTimeLocal(card.alarm);
    $('#cardTags').value = (card.tags || []).join(', ');
    setEmailUI(card.email);
    fillCardBoardSelect(state.boardId); $('#cardBoardField').hidden = state.boards.length < 2;
    // Completed date shows only while the card sits in the done (last) lane.
    const doneCol = (state.board.columns || []).find((c) => c.id === doneColId());
    const inDone = !!(doneCol && doneCol.cards.some((k) => k.id === card.id));
    $('#cardCreated').innerHTML = 'Created ' + esc(new Date(card.createdAt).toLocaleString()) +
      (inDone && card.completedAt
        ? `<br><span class="completed-at">✓ Completed ${esc(new Date(card.completedAt).toLocaleString())}</span>`
        : '');
    $('#cardDelete').style.display = '';
    $('#cardArchive').style.display = '';
    state.editingCardArchived = !!card.archived;
    $('#cardArchive').textContent = card.archived ? 'Unarchive' : 'Archive';
    cardModal.hidden = false;
  }

  // New card: same modal as editing, blank, defaults to Low priority.
  function openNewCardModal(columnId) {
    state.editingCardId = null;
    state.newCardColumnId = columnId;
    state.editingInboxId = null;
    buildPriorityOptions();
    $('#cardSubject').value = '';
    $('#cardDesc').value = '';
    $('#cardPriority').value = priObj('low') ? 'low' : (state.priorities[1]?.id || 'none');
    $('#cardDue').value = '';
    $('#cardAlarm').value = '';
    $('#cardTags').value = '';
    setEmailUI('');
    $('#cardBoardField').hidden = true; // new cards go on the current board
    $('#cardCreated').textContent = '';
    $('#cardDelete').style.display = 'none';
    $('#cardArchive').style.display = 'none';
    cardModal.hidden = false;
    setTimeout(() => $('#cardSubject').focus(), 30);
  }

  async function saveCard() {
    const subject = $('#cardSubject').value.trim();
    if (!subject) { toast('Card title is required'); $('#cardSubject').focus(); return; }
    const body = {
      subject,
      description: $('#cardDesc').value,
      priority: $('#cardPriority').value,
      dueDate: $('#cardDue').value ? new Date($('#cardDue').value + 'T00:00:00').toISOString() : null,
      alarm: alarmFromInput(),
      email: $('#cardEmail').value.trim() || null,
      tags: $('#cardTags').value.split(',').map((t) => t.trim()).filter(Boolean),
    };
    if (state.editingInboxId) {
      // A human touched it → mark the source as manual.
      await api(`/inbox/${state.editingInboxId}`, { method: 'PUT', body: { ...body, source: 'manual' } });
      cardModal.hidden = true; loadInbox(); return;
    }
    if (state.editingCardId) {
      await api(`/tasks/${state.editingCardId}`, { method: 'PUT', body });
      // Board changed → move it there (first lane).
      const toBoardId = $('#cardBoardField').hidden ? null : $('#cardBoard').value;
      if (toBoardId && toBoardId !== state.boardId) {
        await api(`/boards/${state.boardId}/cards/${state.editingCardId}/transfer`, { method: 'POST', body: { toBoardId } });
        const dest = state.boards.find((b) => b.id === toBoardId);
        toast(`Moved to ${dest ? dest.name : 'the other board'}`);
      }
    } else {
      await api(`/boards/${state.boardId}/cards`, { method: 'POST', body: { ...body, columnId: state.newCardColumnId, source: 'manual' } });
    }
    cardModal.hidden = true; refresh();
  }

  $('#cardSave').onclick = saveCard;
  $('#cardClose').onclick = () => (cardModal.hidden = true);
  $('#cardDelete').onclick = async () => {
    if (state.editingInboxId) {
      if (!confirm('Delete this inbox item?')) return;
      await api(`/inbox/${state.editingInboxId}`, { method: 'DELETE' });
      cardModal.hidden = true; loadInbox(); return;
    }
    if (!confirm('Delete this card?')) return;
    await api(`/boards/${state.boardId}/cards/${state.editingCardId}`, { method: 'DELETE' });
    cardModal.hidden = true; refresh();
  };
  $('#cardArchive').onclick = async () => {
    const archive = !state.editingCardArchived;
    await api(`/tasks/${state.editingCardId}`, { method: 'PUT', body: { archived: archive } });
    cardModal.hidden = true; refresh(); toast(archive ? 'Card archived' : 'Card unarchived');
  };

  // ---- Board settings modal ----
  const boardModal = $('#boardModal');
  function openBoardModal() {
    const b = state.board;
    $('#bmName').value = b.name;
    $('#bmDesc').value = b.description || '';
    $('#bmAutoArchive').value = b.settings.autoArchiveDays || 0;
    const cf = cardFields();
    $('#cfPriority').checked = cf.priority; $('#cfDue').checked = cf.dueDate;
    $('#cfTags').checked = cf.tags; $('#cfSource').checked = cf.source; $('#cfAlarm').checked = cf.alarm; $('#cfEmail').checked = cf.email;
    renderLaneEditor(b.columns);
    loadArchive();
    renderIcs(b.ics);
    openRouteTags(b);
    setBoardTab('general');
    boardModal.hidden = false;
  }

  // ---- Board settings tabs ----
  function setBoardTab(tab) {
    $$('#boardTabs .modal-tab').forEach((x) => x.classList.toggle('active', x.dataset.btab === tab));
    $$('#boardModal .tab-panel').forEach((x) => x.classList.toggle('active', x.dataset.btab === tab));
    const body = $('#boardModal .modal-body'); if (body) body.scrollTop = 0;
  }
  $$('#boardTabs .modal-tab').forEach((x) => (x.onclick = () => setBoardTab(x.dataset.btab)));

  // ---- Routing tags (board settings) ----
  // Saved immediately on Add / × (no need for the board's Save button).
  // Duplicates across boards are caught here (from /route-tags) and again by
  // the server, which is the source of truth.
  let routeTags = [];
  let otherBoardTags = new Map(); // normalized tag → { tag, boardName, archived }
  const normTag = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
  function tagError(msg) { const e = $('#bmTagErr'); e.textContent = msg || ''; e.hidden = !msg; }
  function renderRouteTags() {
    const ul = $('#bmTagList'); ul.innerHTML = '';
    routeTags.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'route-tag';
      li.innerHTML = `<span>${esc(t)}</span>`;
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'route-tag-x'; x.textContent = '×'; x.title = `Remove "${t}"`;
      x.onclick = async () => {
        const next = routeTags.filter((_, j) => j !== i);
        tagError('');
        if (await saveRouteTags(next)) toast(`Removed tag "${t}"`);
      };
      li.appendChild(x); ul.appendChild(li);
    });
  }
  async function openRouteTags(b) {
    routeTags = [...(b.routeTags || [])];
    $('#bmTagInput').value = ''; tagError('');
    $('#bmRank').value = b.routeRank ?? '';
    $('#bmRankStatus').textContent = ''; $('#bmRankStatus').className = 'ai-test-status';
    renderRouteTags();
    await loadRouteOrder(b.id);
  }
  // Fetch every board's tags (duplicate check) + the overall routing order.
  async function loadRouteOrder(boardId = state.boardId) {
    otherBoardTags = new Map();
    let order = [];
    try {
      const r = await api('/route-tags');
      r.tags.forEach((t) => { if (t.boardId !== boardId) otherBoardTags.set(normTag(t.tag), t); });
      order = r.order || [];
    } catch {}
    const ol = $('#bmRouteOrder'); ol.innerHTML = '';
    order.forEach((o, i) => {
      const li = document.createElement('li');
      if (o.boardId === boardId) li.className = 'current';
      li.innerHTML = `<span class="ro-step">${i + 1}</span><span class="ro-name">${esc(o.boardName)}</span>` +
        `<span class="ro-rank">${o.rank ? 'rank ' + o.rank : 'no rank'}</span>` +
        `<span class="ro-tags">${o.tags.map((t) => esc(t)).join(', ')}</span>`;
      ol.appendChild(li);
    });
    $('#bmRouteOrderEmpty').hidden = order.length > 0;
  }
  $('#bmRank').onchange = async () => {
    const st = $('#bmRankStatus');
    const v = $('#bmRank').value.trim();
    try {
      const b = await api('/boards/' + state.boardId, { method: 'PUT', body: { routeRank: v === '' ? null : v } });
      if (state.board) state.board.routeRank = b.routeRank ?? null;
      $('#bmRank').value = b.routeRank ?? '';
      st.textContent = b.routeRank ? `✓ Rank ${b.routeRank} saved` : '✓ Rank cleared'; st.className = 'ai-test-status ok';
      loadRouteOrder();
    } catch (e) { st.textContent = '✗ ' + (e.message || 'Could not save'); st.className = 'ai-test-status err'; }
  };
  /** Persist the board's routing tags right away. Returns true on success;
   *  on failure shows the server's message and leaves the list unchanged. */
  async function saveRouteTags(next) {
    try {
      const b = await api('/boards/' + state.boardId, { method: 'PUT', body: { routeTags: next } });
      routeTags = [...(b.routeTags || [])];
      if (state.board) state.board.routeTags = routeTags;
      renderRouteTags();
      loadRouteOrder();
      return true;
    } catch (e) {
      tagError(e.message || 'Could not save tags');
      return false;
    }
  }
  async function addRouteTags() {
    const parts = $('#bmTagInput').value.split(',').map((t) => t.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!parts.length) return true;
    const errs = [];
    const add = [];
    for (const t of parts) {
      if (t.length > 40) { errs.push(`"${t.slice(0, 20)}…" is too long (max 40 characters).`); continue; }
      const owner = otherBoardTags.get(normTag(t));
      if (owner) { errs.push(`"${t}" is already used by board "${owner.boardName}"${owner.archived ? ' (archived)' : ''}.`); continue; }
      if ([...routeTags, ...add].some((x) => normTag(x) === normTag(t))) { errs.push(`"${t}" is already on this board.`); continue; }
      add.push(t);
    }
    tagError(errs.join(' '));
    let ok = !errs.length;
    if (add.length) {
      if (await saveRouteTags([...routeTags, ...add])) {
        toast(`Saved tag${add.length === 1 ? '' : 's'}: ${add.join(', ')}`);
        if (errs.length) tagError(errs.join(' ')); // keep showing the rejected ones
      } else ok = false;
    }
    // Leave only the rejected text in the box so it can be fixed.
    $('#bmTagInput').value = parts.filter((t) => !routeTags.some((x) => normTag(x) === normTag(t))).join(', ');
    $('#bmTagInput').focus();
    return ok;
  }
  $('#bmTagAdd').onclick = addRouteTags;
  $('#bmTagInput').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addRouteTags(); } };

  // ---- Lane manager (board settings) ----
  function renderLaneEditor(columns) {
    const ul = $('#laneEditor'); ul.innerHTML = '';
    columns.forEach((c) => ul.appendChild(laneRow(c)));
    if (typeof Sortable !== 'undefined') {
      new Sortable(ul, { animation: 150, handle: '.lane-grip', ghostClass: 'dragging' });
    }
  }
  function laneRow(col) {
    const li = document.createElement('li');
    li.className = 'lane-row'; li.dataset.id = col.id || '';
    li.dataset.color = col.color || '';
    const grip = document.createElement('span'); grip.className = 'lane-grip'; grip.textContent = '⠿'; grip.title = 'Drag to reorder';
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'lane-name'; name.value = col.name || ''; name.placeholder = 'Lane name';
    const sw = document.createElement('div'); sw.className = 'lane-swatches';
    (state.laneColors || []).forEach((c) => {
      const d = document.createElement('div');
      d.className = 'lane-sw' + (col.color === c ? ' selected' : '');
      d.style.background = c; d.dataset.color = c;
      d.onclick = () => { $$('.lane-sw', sw).forEach((x) => x.classList.remove('selected')); d.classList.add('selected'); li.dataset.color = c; };
      sw.appendChild(d);
    });
    // The last row is labelled "Done" via CSS (.lane-row:last-child) so the
    // marker follows the lane while you drag rows around.
    const comp = document.createElement('span'); comp.className = 'lane-done-tag'; comp.textContent = '✓ Done';
    comp.title = 'The last lane is always the done lane';
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'lane-del'; del.textContent = '🗑'; del.title = 'Delete lane';
    del.onclick = () => li.remove();
    li.append(grip, name, sw, comp, del);
    return li;
  }
  $('#addLaneBtn').onclick = () => {
    const next = laneColorAt($('#laneEditor').children.length);
    $('#laneEditor').appendChild(laneRow({ id: '', name: '', color: next }));
  };

  // Reconcile the lane editor against the board: update, create, delete, reorder.
  async function saveLanes() {
    const rows = $$('#laneEditor .lane-row');
    const existingIds = state.board.columns.map((c) => c.id);
    const orderedIds = []; const keptIds = [];
    for (const r of rows) {
      const id = r.dataset.id;
      const name = r.querySelector('.lane-name').value.trim() || 'Lane';
      const color = r.dataset.color || null;
      if (id) {
        keptIds.push(id);
        orderedIds.push(id);
        await api(`/boards/${state.boardId}/columns/${id}`, { method: 'PUT', body: { name, color } });
      } else {
        const col = await api(`/boards/${state.boardId}/columns`, { method: 'POST', body: { name, color } });
        orderedIds.push(col.id);
      }
    }
    for (const id of existingIds)
      if (!keptIds.includes(id)) await api(`/boards/${state.boardId}/columns/${id}`, { method: 'DELETE' });
    await api(`/boards/${state.boardId}/columns/reorder`, { method: 'POST', body: { order: orderedIds } });
    // The done lane is simply the last one; the server re-derives card status.
  }

  // ---- Calendar feed (.ics) — managed live, like the API key ----
  function icsUrl(token) {
    const base = (state.settings && state.settings.appUrl) || location.origin;
    return `${base}/ics/${state.boardId}/${token}.ics`;
  }
  function renderIcs(ics) {
    ics = ics || {};
    const on = !!ics.token;
    $('#icsEnabled').checked = on;
    $('#icsPanel').hidden = !on;
    $('#icsStatus').textContent = ''; $('#icsStatus').className = 'ai-test-status';
    $('#icsDesc').checked = !!ics.includeDescriptions;
    $('#icsDone').checked = !!ics.includeCompleted;
    if (on) {
      const url = icsUrl(ics.token);
      $('#icsUrl').value = url;
      $('#icsSubscribe').href = url.replace(/^https?:/, 'webcal:');
    } else {
      $('#icsUrl').value = '';
      $('#icsSubscribe').href = '#';
    }
  }
  async function icsCall(method, body) {
    const ics = await api(`/boards/${state.boardId}/ics`, { method, body });
    if (state.board) state.board.ics = ics;
    return ics;
  }
  $('#icsEnabled').onchange = async () => {
    const on = $('#icsEnabled').checked;
    if (!on && !confirm('Turn off the calendar feed?\n\nCalendars subscribed to it will stop updating. Turning it back on creates a new link.')) {
      $('#icsEnabled').checked = true; return;
    }
    try { renderIcs(await icsCall(on ? 'POST' : 'DELETE')); }
    catch { $('#icsEnabled').checked = !on; toast('Could not update calendar feed'); }
  };
  $('#icsRotate').onclick = async () => {
    if (!confirm('Generate a new feed link?\n\nThe current link stops working immediately — re-subscribe your calendars with the new one.')) return;
    try {
      renderIcs(await icsCall('POST', { rotate: true }));
      $('#icsStatus').textContent = '✓ New link generated'; $('#icsStatus').className = 'ai-test-status ok';
    } catch { toast('Could not generate a new link'); }
  };
  $('#icsDesc').onchange = $('#icsDone').onchange = async () => {
    try { await icsCall('PUT', { includeDescriptions: $('#icsDesc').checked, includeCompleted: $('#icsDone').checked }); }
    catch { toast('Could not save feed options'); }
  };
  $('#icsCopy').onclick = async () => {
    const f = $('#icsUrl'); const st = $('#icsStatus');
    f.focus(); f.select();
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(f.value); ok = true; } } catch (_) {}
    if (!ok) { try { ok = document.execCommand('copy'); } catch (_) {} }
    st.textContent = ok ? '✓ Copied' : 'Selected — press ⌘/Ctrl-C'; st.className = ok ? 'ai-test-status ok' : 'ai-test-status';
  };

  // ---- Account tab (username / password / sessions) — live actions ----
  function acStatus(id, text, ok) { const s = $(id); s.textContent = text; s.className = 'ai-test-status' + (ok === true ? ' ok' : ok === false ? ' err' : ''); }
  async function loadAccount() {
    ['#acUserPw', '#acCurPw', '#acNewPw', '#acNewPw2'].forEach((id) => ($(id).value = ''));
    acStatus('#acUserStatus', ''); acStatus('#acPwStatus', '');
    try {
      const a = await api('/account');
      $('#acUsername').value = a.username || '';
      if (a.minPassword) $('#acMin').textContent = `(min ${a.minPassword})`;
    } catch {}
  }
  async function accountCall(path, method, body) {
    const res = await fetch('/api/account' + path, {
      method, credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }
  $('#acUserSave').onclick = async () => {
    try {
      const r = await accountCall('/username', 'PUT', { username: $('#acUsername').value.trim(), currentPassword: $('#acUserPw').value });
      $('#acUserPw').value = ''; $('#acUsername').value = r.username || '';
      acStatus('#acUserStatus', '✓ Username saved', true);
    } catch (e) { acStatus('#acUserStatus', '✗ ' + e.message, false); }
  };
  $('#acPwSave').onclick = async () => {
    if ($('#acNewPw').value !== $('#acNewPw2').value) return acStatus('#acPwStatus', '✗ New passwords do not match', false);
    try {
      await accountCall('/password', 'PUT', { currentPassword: $('#acCurPw').value, newPassword: $('#acNewPw').value });
      ['#acCurPw', '#acNewPw', '#acNewPw2'].forEach((id) => ($(id).value = ''));
      acStatus('#acPwStatus', '✓ Password changed — other sessions signed out', true);
    } catch (e) { acStatus('#acPwStatus', '✗ ' + e.message, false); }
  };
  $('#acLogoutAll').onclick = async () => {
    if (!confirm('Log out every browser, including this one?')) return;
    try { await accountCall('/logout-all', 'POST'); } catch {}
    window.location.href = '/login';
  };

  // ---- Danger zone: reset all cards (testing) ----
  $('#resetCards').onclick = async () => {
    if (!confirm('⚠️ Reset ALL cards?\n\nThis deletes every card on every board (active and archived, archived boards included) and empties the Inbox.\n\nBoards, lanes, tags, feeds and settings are kept. A backup is taken first.')) return;
    const typed = prompt('Type RESET to confirm:');
    if (typed !== 'RESET') { if (typed !== null) toast('Not reset — you must type RESET'); return; }
    try {
      const r = await api('/reset-cards', { method: 'POST', body: { confirm: 'RESET' } });
      toast(`Reset: ${r.cards} card${r.cards === 1 ? '' : 's'} and ${r.inboxItems} Inbox item${r.inboxItems === 1 ? '' : 's'} removed — backup saved`);
      loadBackups();
      await loadInbox();
      if (state.boardId) await refresh();
    } catch (e) { toast('Reset failed: ' + (e.message || 'error')); }
  };

  // ---- Inbox: re-run routing tags (↻ next to the count) ----
  $('#inboxReprocess').onclick = async () => {
    const btn = $('#inboxReprocess');
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('spinning');
    try {
      const r = await api('/inbox/reprocess', { method: 'POST' });
      const n = r.moved.length;
      if (!n) toast('No Inbox items matched a board’s routing tags');
      else {
        const boardsHit = [...new Set(r.moved.map((m) => m.boardName))];
        toast(`Moved ${n} item${n === 1 ? '' : 's'} to ${boardsHit.join(', ')}`);
      }
      await loadInbox();
      if (n && state.boardId && r.moved.some((m) => m.boardId === state.boardId)) await refresh();
    } catch (e) {
      toast('Re-check failed: ' + (e.message || 'error'));
    } finally {
      setTimeout(() => { btn.disabled = false; btn.classList.remove('spinning'); }, 400);
    }
  };

  // ---- App-wide calendar feed (App settings → Calendar) — live actions ----
  async function copyField(field, status) {
    field.focus(); field.select();
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(field.value); ok = true; } } catch (_) {}
    if (!ok) { try { ok = document.execCommand('copy'); } catch (_) {} }
    status.textContent = ok ? '✓ Copied' : 'Selected — press ⌘/Ctrl-C'; status.className = ok ? 'ai-test-status ok' : 'ai-test-status';
  }
  function renderGlobalIcs(g) {
    g = g || {};
    const on = !!g.token;
    $('#gIcsEnabled').checked = on;
    $('#gIcsPanel').hidden = !on;
    $('#gIcsStatus').textContent = ''; $('#gIcsStatus').className = 'ai-test-status';
    $('#gIcsInbox').checked = g.includeInbox !== false;
    $('#gIcsDesc').checked = !!g.includeDescriptions;
    $('#gIcsDone').checked = !!g.includeCompleted;
    const url = on ? `${(state.settings && state.settings.appUrl) || location.origin}/ics/all/${g.token}.ics` : '';
    $('#gIcsUrl').value = url;
    $('#gIcsSubscribe').href = on ? url.replace(/^https?:/, 'webcal:') : '#';
  }
  async function loadGlobalIcs() {
    try { renderGlobalIcs(await api('/ics')); } catch {}
  }
  $('#gIcsEnabled').onchange = async () => {
    const on = $('#gIcsEnabled').checked;
    if (!on && !confirm('Turn off the all-boards calendar feed?\n\nCalendars subscribed to it will stop updating. Turning it back on creates a new link.')) {
      $('#gIcsEnabled').checked = true; return;
    }
    try { renderGlobalIcs(await api('/ics', { method: on ? 'POST' : 'DELETE' })); }
    catch { $('#gIcsEnabled').checked = !on; toast('Could not update calendar feed'); }
  };
  $('#gIcsRotate').onclick = async () => {
    if (!confirm('Generate a new feed link?\n\nThe current link stops working immediately — re-subscribe your calendars with the new one.')) return;
    try {
      renderGlobalIcs(await api('/ics', { method: 'POST', body: { rotate: true } }));
      $('#gIcsStatus').textContent = '✓ New link generated'; $('#gIcsStatus').className = 'ai-test-status ok';
    } catch { toast('Could not generate a new link'); }
  };
  $('#gIcsInbox').onchange = $('#gIcsDesc').onchange = $('#gIcsDone').onchange = async () => {
    try {
      await api('/ics', { method: 'PUT', body: {
        includeInbox: $('#gIcsInbox').checked,
        includeDescriptions: $('#gIcsDesc').checked,
        includeCompleted: $('#gIcsDone').checked,
      } });
    } catch { toast('Could not save feed options'); }
  };
  $('#gIcsCopy').onclick = () => copyField($('#gIcsUrl'), $('#gIcsStatus'));

  // ---- Archived boards (App settings → Archives) — live actions ----
  async function loadArchivedBoards() {
    const ul = $('#archivedBoards'); ul.innerHTML = '';
    let list = [];
    try { list = (await api('/boards?archived=1')).boards || []; } catch {}
    $('#archivedEmpty').hidden = list.length > 0;
    list.forEach((b) => {
      const li = document.createElement('li');
      const when = b.archivedAt ? ' · archived ' + new Date(b.archivedAt).toLocaleDateString() : '';
      li.innerHTML = `<span class="b-name"><b style="color:var(--text)">${esc(b.name)}</b> <small>${b.cardCount || 0} cards${esc(when)}</small></span>`;
      const actions = document.createElement('span'); actions.className = 'ab-actions';
      const restore = document.createElement('button');
      restore.className = 'mini-btn'; restore.textContent = 'Restore';
      restore.onclick = async () => {
        await api(`/boards/${b.id}/unarchive`, { method: 'POST' });
        toast(`Restored “${b.name}”`); loadArchivedBoards(); await loadBoards(b.id);
      };
      const del = document.createElement('button');
      del.className = 'mini-btn danger'; del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm(`Permanently delete “${b.name}” and all its cards?\n\nThis cannot be undone (backups still contain it).`)) return;
        await api('/boards/' + b.id, { method: 'DELETE' });
        toast('Board deleted'); loadArchivedBoards(); await loadBoards();
      };
      actions.append(restore, del); li.appendChild(actions); ul.appendChild(li);
    });
  }

  async function loadBackups() {
    const ul = $('#backupList'); ul.innerHTML = '<li class="b-name">Loading…</li>';
    try {
      const { backups } = await api('/backups');
      ul.innerHTML = '';
      if (!backups.length) { ul.innerHTML = ''; return; }
      backups.forEach((b) => {
        const li = document.createElement('li');
        const typeLabel = b.automated ? 'Automated' : (b.reason === 'pre-restore' ? 'Pre-restore' : b.reason === 'pre-upgrade' ? 'Pre-upgrade' : b.reason === 'pre-reset' ? 'Pre-reset' : 'Manual');
        const typeClass = b.automated ? 'auto' : 'manual';
        li.innerHTML = `<span class="b-name">${new Date(b.createdAt).toLocaleString()} <span class="b-type ${typeClass}">${typeLabel}</span></span>`;
        const btn = document.createElement('button');
        btn.className = 'mini-btn'; btn.textContent = 'Restore';
        btn.onclick = async () => {
          if (!confirm('Restore this backup? Current boards will be replaced (a safety backup is taken first).')) return;
          await api('/backups/restore', { method: 'POST', body: { file: b.file } });
          boardModal.hidden = true; toast('Backup restored'); await loadBoards();
        };
        li.appendChild(btn); ul.appendChild(li);
      });
    } catch { ul.innerHTML = ''; }
  }

  async function loadArchive() {
    const ul = $('#archiveList'); ul.innerHTML = '';
    const showCount = (n) => {
      const c = $('#archivedCount'); c.textContent = n; c.hidden = !n;
      $('#archiveEmpty').hidden = !!n;
    };
    showCount(0);
    try {
      const { archived } = await api('/boards/' + state.boardId + '/archived');
      showCount(archived.length);
      if (!archived.length) return;
      archived.forEach((c) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${esc(c.subject)} <small style="color:var(--text-dim)">· ${esc(c.columnName)}</small></span>`;
        const btn = document.createElement('button');
        btn.className = 'mini-btn'; btn.textContent = 'Unarchive';
        btn.onclick = async () => { await api('/tasks/' + c.id, { method: 'PUT', body: { archived: false } }); loadArchive(); refresh(); };
        li.appendChild(btn); ul.appendChild(li);
      });
    } catch {}
  }

  document.addEventListener('click', (e) => {
    if (e.target.id === 'appBackupNow') api('/backups', { method: 'POST' }).then(() => { toast('Backup created'); loadBackups(); });
    if (e.target.id === 'appBackupRefresh') loadBackups();
  });
  $('#boardSettingsBtn').onclick = () => { if (state.board) { state.newBoardId = null; openBoardModal(); } };
  $('#boardModalClose').onclick = $('#bmCancel').onclick = closeBoardModal;
  $('#bmSave').onclick = async () => {
    const name = $('#bmName').value.trim();
    if (!name) { setBoardTab('general'); toast('Board title is required'); $('#bmName').focus(); return; }
    // A tag typed but not yet added gets added (and saved) too.
    if ($('#bmTagInput').value.trim() && !(await addRouteTags())) return;
    try {
      await api('/boards/' + state.boardId, {
        method: 'PUT',
        body: {
          name,
          description: $('#bmDesc').value,
          settings: {
            autoArchiveDays: Math.max(0, parseInt($('#bmAutoArchive').value, 10) || 0),
            cardFields: {
              priority: $('#cfPriority').checked, dueDate: $('#cfDue').checked,
              tags: $('#cfTags').checked, source: $('#cfSource').checked, alarm: $('#cfAlarm').checked, email: $('#cfEmail').checked,
            },
          },
        },
      });
    } catch (e) {
      toast('Board not saved: ' + (e.message || 'error'));
      return;
    }
    await saveLanes();
    state.newBoardId = null; // committed — no rollback
    boardModal.hidden = true;
    await loadBoards(state.boardId);
    toast('Board saved');
  };
  $('#bmArchive').onclick = async () => {
    if (state.newBoardId) { closeBoardModal(); return; } // unsaved new board: just discard it
    if (!confirm(`Archive “${state.board.name}”?\n\nIt will be hidden from the board menu. Restore it — or delete it for good — from App settings → Archives.`)) return;
    await api(`/boards/${state.boardId}/archive`, { method: 'POST' });
    boardModal.hidden = true;
    state.boardId = null;
    await loadBoards();
    toast('Board archived');
  };

  // ---- New board ----
  // Create with defaults, switch to it, then open the full board configuration
  // window so the whole board (name, lanes, complete lane, window) can be set.
  $('#addBoardBtn').onclick = async () => {
    const b = await api('/boards', { method: 'POST', body: { name: 'New Board' } });
    state.newBoardId = b.id; // rolled back if the config is closed without saving
    await loadBoards(b.id);
    openBoardModal();
    setTimeout(() => { $('#bmName').focus(); $('#bmName').select(); }, 30);
  };

  // ---- App settings modal (theme + categories + lane colors) ----
  const appModal = $('#appModal');
  let pendingTheme = state.themeId;
  let appDirty = false;
  const DIRTY_MSG = '⚠️ You have unsaved changes — click Save to keep them.';
  function markAppDirty() {
    appDirty = true;
    const b = $('#appDirty');
    b.classList.remove('error'); b.textContent = DIRTY_MSG; b.hidden = false;
  }
  function clearAppDirty() {
    appDirty = false;
    const b = $('#appDirty');
    b.classList.remove('error'); b.hidden = true;
  }
  // Inline validation error shown in the same banner (red), switching to the tab.
  function showAppError(msg, tab) {
    if (tab) setAppTab(tab);
    const b = $('#appDirty');
    b.textContent = '⚠️ ' + msg; b.classList.add('error'); b.hidden = false;
  }
  // Any input/change inside the modal flags unsaved changes — except the API
  // tab, whose key actions commit to the server immediately. Everything else
  // (theme, categories, lanes, notifications, auto-backup) is persisted
  // by the main Save button, so it DOES flag unsaved changes.
  const SELF_SAVE = '[data-tab="api"], [data-tab="archives"], [data-tab="calendar"], [data-tab="account"]';
  const dirtyIfTracked = (e) => { if (e.target.closest && e.target.closest(SELF_SAVE)) return; markAppDirty(); };
  appModal.addEventListener('input', dirtyIfTracked);
  appModal.addEventListener('change', dirtyIfTracked);
  function openAppModal() {
    pendingTheme = state.themeId;
    clearAppDirty();
    setAppTab('theme');
    renderThemeGrid();
    renderPriorityEditor();
    renderBadgeEditor();
    renderLaneColorsEditor();
    loadApiKey();
    loadAccount();
    loadGlobalIcs();
    loadNotifications();
    loadBackupConfig();
    loadBackups();
    loadArchivedBoards();
    appModal.hidden = false;
    // Move focus into the dialog for keyboard users.
    requestAnimationFrame(() => { const t = $('#appTabs .modal-tab.active'); if (t) t.focus(); });
  }
  // ---- API key tab (managed live, independent of the Save button) ----
  async function loadApiKey() {
    try {
      const { apiKey } = await api('/apikey');
      $('#apiKeyField').value = apiKey || '';
      $('#apiKeyStatus').textContent = apiKey ? '' : '';
      $('#apiKeyStatus').className = 'ai-test-status';
    } catch {}
  }
  $('#apiKeyGen').onclick = async () => {
    if ($('#apiKeyField').value && !confirm('Generate a new API key?\n\nThis replaces the current key — any app using the old one will stop working until updated.')) return;
    const st = $('#apiKeyStatus');
    try {
      const { apiKey } = await api('/apikey', { method: 'POST' });
      $('#apiKeyField').value = apiKey;
      st.textContent = '✓ New key generated'; st.className = 'ai-test-status ok';
    } catch { st.textContent = '✗ Could not generate key'; st.className = 'ai-test-status err'; }
  };
  $('#apiKeyClear').onclick = async () => {
    if (!$('#apiKeyField').value) return;
    if (!confirm('Remove the API key?\n\nExternal apps using it will lose access.')) return;
    const st = $('#apiKeyStatus');
    try {
      await api('/apikey', { method: 'DELETE' });
      $('#apiKeyField').value = '';
      st.textContent = 'Key removed'; st.className = 'ai-test-status';
    } catch { st.textContent = '✗ Could not remove key'; st.className = 'ai-test-status err'; }
  };
  $('#apiKeyCopy').onclick = async () => {
    const field = $('#apiKeyField');
    const v = field.value;
    const st = $('#apiKeyStatus');
    if (!v) { st.textContent = 'Nothing to copy'; st.className = 'ai-test-status'; return; }
    // Select first (so the user sees it and execCommand has a range to copy).
    field.focus(); field.select();
    try { field.setSelectionRange(0, v.length); } catch (_) {}
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(v);
        ok = true;
      }
    } catch (_) {}
    // Fallback for insecure contexts / older browsers where the async API is
    // blocked — the classic execCommand copies the current selection.
    if (!ok) { try { ok = document.execCommand('copy'); } catch (_) { ok = false; } }
    st.textContent = ok ? '✓ Copied to clipboard' : 'Selected — press ⌘/Ctrl-C to copy';
    st.className = ok ? 'ai-test-status ok' : 'ai-test-status';
  };

  // ---- Notifications tab (Email + Discord, each managed live) ----
  $$('#notifySubtabs .notify-subtab').forEach((b) => (b.onclick = () => {
    $$('#notifySubtabs .notify-subtab').forEach((x) => x.classList.toggle('active', x === b));
    $$('#appModal .notify-sub').forEach((p) => p.classList.toggle('active', p.dataset.sub === b.dataset.sub));
  }));

  const WD_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // 0=Sun … 6=Sat
  const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function renderWeekdays(containerId, selected) {
    const wrap = $('#' + containerId); wrap.innerHTML = '';
    WD_LABELS.forEach((lbl, i) => {
      const b = document.createElement('button');
      const on = selected.includes(i);
      b.type = 'button'; b.className = 'wd' + (on ? ' on' : '');
      b.textContent = lbl; b.dataset.day = i; b.title = WD_FULL[i];
      b.setAttribute('aria-label', WD_FULL[i]);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.onclick = () => { const now = b.classList.toggle('on'); b.setAttribute('aria-pressed', now ? 'true' : 'false'); };
      wrap.appendChild(b);
    });
  }
  const getWeekdays = (id) => $$('#' + id + ' .wd.on').map((b) => parseInt(b.dataset.day, 10));

  async function loadNotifications() {
    try {
      const n = await api('/notifications');
      const e = n.email;
      $('#emEnabled').checked = e.enabled;
      $('#emHost').value = e.host; $('#emPort').value = e.port; $('#emEnc').value = e.encryption;
      $('#emUser').value = e.user; $('#emPass').value = '';
      $('#emPass').placeholder = e.passwordSet ? '•••••• (leave blank to keep)' : 'SMTP password';
      $('#emFrom').value = e.from; $('#emTo').value = e.to; $('#emSubject').value = e.subject;
      $('#emUpcoming').checked = e.content.upcoming.enabled; $('#emUpcomingDays').value = e.content.upcoming.days;
      $('#emDueToday').checked = e.content.dueToday.enabled; $('#emPastDue').checked = e.content.pastDue.enabled;
      $('#emTime').value = e.schedule.time; renderWeekdays('emDays', e.schedule.days);
      $('#emStatus').textContent = ''; $('#emStatus').className = 'ai-test-status';
      const d = n.discord;
      $('#dcEnabled').checked = d.enabled; $('#dcWebhook').value = d.webhookUrl;
      $('#dcUpcoming').checked = d.content.upcoming.enabled; $('#dcUpcomingDays').value = d.content.upcoming.days;
      $('#dcDueToday').checked = d.content.dueToday.enabled; $('#dcPastDue').checked = d.content.pastDue.enabled;
      $('#dcTime').value = d.schedule.time; renderWeekdays('dcDays', d.schedule.days);
      $('#dcStatus').textContent = ''; $('#dcStatus').className = 'ai-test-status';
      const t = n.imessage;
      $('#tmEnabled').checked = t.enabled; $('#tmUrl').value = t.url; $('#tmKey').value = '';
      $('#tmKey').placeholder = t.apiKeySet ? '•••••• (leave blank to keep)' : 'Gateway API key';
      $('#tmTo').value = t.to; $('#tmService').value = t.service;
      $('#tmAlarms').checked = t.alarms; $('#tmSummary').checked = t.summaryEnabled;
      $('#tmUpcoming').checked = t.content.upcoming.enabled; $('#tmUpcomingDays').value = t.content.upcoming.days;
      $('#tmDueToday').checked = t.content.dueToday.enabled; $('#tmPastDue').checked = t.content.pastDue.enabled;
      $('#tmTime').value = t.schedule.time; renderWeekdays('tmDays', t.schedule.days);
      $('#tmStatus').textContent = ''; $('#tmStatus').className = 'ai-test-status';
      // Lock/unlock each sub-panel to match its enable toggle.
      setNotifyFieldsEnabled('email');
      setNotifyFieldsEnabled('discord');
      setNotifyFieldsEnabled('imessage');
    } catch {}
  }

  function collectEmail() {
    return {
      enabled: $('#emEnabled').checked,
      host: $('#emHost').value.trim(), port: parseInt($('#emPort').value, 10) || 587,
      encryption: $('#emEnc').value, user: $('#emUser').value.trim(), pass: $('#emPass').value,
      from: $('#emFrom').value.trim(), to: $('#emTo').value.trim(),
      subject: $('#emSubject').value.trim() || 'Daily Task Summary',
      content: {
        upcoming: { enabled: $('#emUpcoming').checked, days: parseInt($('#emUpcomingDays').value, 10) || 7 },
        dueToday: { enabled: $('#emDueToday').checked }, pastDue: { enabled: $('#emPastDue').checked },
      },
      schedule: { time: $('#emTime').value || '08:00', days: getWeekdays('emDays') },
    };
  }
  function collectDiscord() {
    return {
      enabled: $('#dcEnabled').checked, webhookUrl: $('#dcWebhook').value.trim(),
      content: {
        upcoming: { enabled: $('#dcUpcoming').checked, days: parseInt($('#dcUpcomingDays').value, 10) || 7 },
        dueToday: { enabled: $('#dcDueToday').checked }, pastDue: { enabled: $('#dcPastDue').checked },
      },
      schedule: { time: $('#dcTime').value || '08:00', days: getWeekdays('dcDays') },
    };
  }

  function collectImessage() {
    return {
      enabled: $('#tmEnabled').checked, url: $('#tmUrl').value.trim(), apiKey: $('#tmKey').value.trim(),
      to: $('#tmTo').value.trim(), service: $('#tmService').value,
      alarms: $('#tmAlarms').checked, summaryEnabled: $('#tmSummary').checked,
      content: {
        upcoming: { enabled: $('#tmUpcoming').checked, days: parseInt($('#tmUpcomingDays').value, 10) || 7 },
        dueToday: { enabled: $('#tmDueToday').checked }, pastDue: { enabled: $('#tmPastDue').checked },
      },
      schedule: { time: $('#tmTime').value || '08:00', days: getWeekdays('tmDays') },
    };
  }
  // Per-channel element ids / collectors / "where to look" text.
  const NOTIFY = {
    email: { prefix: 'em', collect: () => collectEmail(), where: 'your inbox' },
    discord: { prefix: 'dc', collect: () => collectDiscord(), where: 'Discord' },
    imessage: { prefix: 'tm', collect: () => collectImessage(), where: 'your phone' },
  };
  async function testNotify(channel) {
    const n = NOTIFY[channel];
    const st = $('#' + n.prefix + 'Status');
    const btn = $('#' + n.prefix + 'Test');
    const body = n.collect();
    st.textContent = 'Sending test…'; st.className = 'ai-test-status'; btn.disabled = true;
    try {
      const r = await api('/notifications/' + channel + '/test', { method: 'POST', body });
      if (r && r.ok) { st.textContent = '✓ Test sent — check ' + n.where + (r.messagesRunning === false ? ' (note: the gateway says Messages isn\u2019t running)' : ''); st.className = 'ai-test-status ok'; }
      else { st.textContent = '✗ ' + ((r && r.error) || 'Test failed'); st.className = 'ai-test-status err'; }
    } catch (err) {
      st.textContent = '✗ ' + (err.message || 'Test failed'); st.className = 'ai-test-status err';
    } finally { btn.disabled = false; }
  }
  $('#emTest').onclick = () => testNotify('email');
  $('#dcTest').onclick = () => testNotify('discord');
  $('#tmTest').onclick = () => testNotify('imessage');

  // A channel's fields are editable only while its enable toggle is on. Turning
  // it off locks (disables) every field in that sub-panel; turning it on unlocks
  // them. The toggle itself is never disabled.
  function setNotifyFieldsEnabled(channel) {
    const sub = document.querySelector(`#appModal .notify-sub[data-sub="${channel}"]`);
    if (!sub) return;
    const toggleId = NOTIFY[channel].prefix + 'Enabled';
    const on = $('#' + toggleId).checked;
    sub.querySelectorAll('input, select, button').forEach((el) => {
      if (el.id === toggleId) return;
      el.disabled = !on;
    });
    sub.classList.toggle('notify-off', !on);
    if (channel === 'imessage') syncTextSummary();
  }
  // Text channel: the summary content/schedule only matter when "Daily summary" is ticked.
  function syncTextSummary() {
    const on = $('#tmEnabled').checked && $('#tmSummary').checked;
    $('#tmSummaryCols').classList.toggle('notify-off', !on);
    $$('#tmSummaryCols input, #tmSummaryCols button').forEach((el) => (el.disabled = !on));
  }
  $('#tmSummary').addEventListener('change', syncTextSummary);
  $('#tmEnabled').addEventListener('change', () => setNotifyFieldsEnabled('imessage'));
  $('#emEnabled').addEventListener('change', () => setNotifyFieldsEnabled('email'));
  $('#dcEnabled').addEventListener('change', () => setNotifyFieldsEnabled('discord'));

  // ---- Auto-backup config ----
  async function loadBackupConfig() {
    try {
      const c = (state.settings && state.settings.backup) || (await api('/backups/config'));
      $('#autoBackupEnabled').checked = !!c.autoEnabled;
      $('#autoBackupFreq').value = c.frequency || 'weekly';
      $('#autoBackupRetention').value = c.retention || 12;
    } catch {}
  }
  function setAppTab(tab) {
    $$('#appTabs .modal-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('#appModal .tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.tab === tab));
  }
  $$('#appTabs .modal-tab').forEach((b) => (b.onclick = () => setAppTab(b.dataset.tab)));
  function themeCard(t) {
    const card = document.createElement('div');
    card.className = 'theme-card' + (t.id === pendingTheme ? ' selected' : '');
    card.dataset.id = t.id;
    const barBg = t.dark ? mix(t.accent, '#12151a', 0.30) : t.accent;
    const bodyTop = t.dark ? mix(t.accent, '#1d2125', 0.34) : mix(t.accent, '#ffffff', 0.62);
    const bodyBot = t.dark ? mix(t.accent, '#1d2125', 0.06) : mix(t.accent, '#ffffff', 0.16);
    const bodyBg = `linear-gradient(180deg, ${bodyTop}, ${bodyBot})`;
    card.innerHTML =
      `<div class="tc-preview"><div class="tc-bar" style="background:${barBg}"></div>` +
      `<div class="tc-body" style="background:${bodyBg}"><div class="tc-chip" style="background:${t.accent}"></div></div></div>` +
      `<div class="tc-name">${esc(t.name)}</div>`;
    card.onclick = () => { pendingTheme = t.id; applyTheme(t.id); $$('.theme-card').forEach((x) => x.classList.toggle('selected', x.dataset.id === t.id)); markAppDirty(); };
    return card;
  }
  function renderThemeGrid() {
    const light = $('#themeGridLight'); const dark = $('#themeGridDark');
    light.innerHTML = ''; dark.innerHTML = '';
    THEMES.forEach((t) => (t.dark ? dark : light).appendChild(themeCard(t)));
  }
  function renderLaneColorsEditor() {
    const wrap = $('#laneColorsEditor'); wrap.innerHTML = '';
    (state.laneColors || []).forEach((c) => wrap.appendChild(laneColorChip(c)));
  }
  function laneColorChip(c) {
    const d = document.createElement('div'); d.className = 'lane-color-chip';
    const input = document.createElement('input'); input.type = 'color'; input.value = c || '#4dabf7';
    const del = document.createElement('button'); del.type = 'button'; del.className = 'lc-del'; del.textContent = '✕'; del.title = 'Remove';
    del.onclick = () => { d.remove(); markAppDirty(); };
    d.append(input, del);
    return d;
  }
  $('#addLaneColorBtn').onclick = () => { $('#laneColorsEditor').appendChild(laneColorChip('#4dabf7')); markAppDirty(); };
  function renderPriorityEditor() {
    const ul = $('#priorityEditor'); ul.innerHTML = '';
    state.priorities.forEach((p) => ul.appendChild(priorityRow(p)));
  }
  function badgeRow(label, key, val, previewText) {
    const li = document.createElement('li');
    li.className = 'priority-row'; li.dataset.badge = key;
    const name = document.createElement('span'); name.className = 'pr-name badge-name'; name.textContent = label;
    const bg = colorField('Bg', 'bd-color', val.color);
    const tx = colorField('Text', 'bd-text', val.textColor);
    const preview = document.createElement('span'); preview.className = 'pr-preview';
    const refresh = () => {
      preview.textContent = previewText;
      preview.style.background = bg.querySelector('input').value;
      preview.style.color = tx.querySelector('input').value;
    };
    [bg.querySelector('input'), tx.querySelector('input')].forEach((i) => i.addEventListener('input', refresh));
    const spacer = document.createElement('span'); // empty 5th cell to keep the grid aligned
    li.append(name, bg, tx, preview, spacer);
    refresh();
    return li;
  }
  function renderBadgeEditor() {
    const ul = $('#badgeEditor'); ul.innerHTML = '';
    ul.appendChild(badgeRow('Due date', 'due', state.badges.due, '📅 Aug 1'));
    ul.appendChild(badgeRow('Tags / labels', 'tag', state.badges.tag, 'label'));
    ul.appendChild(badgeRow('Source (inbox)', 'source', state.badges.source, 'MANUAL'));
  }
  function colorField(label, cls, val) {
    const w = document.createElement('label'); w.className = 'pr-colorfield';
    const span = document.createElement('span'); span.textContent = label;
    const i = document.createElement('input'); i.type = 'color'; i.className = cls; i.value = val;
    w.append(span, i);
    return w;
  }
  function priorityRow(p) {
    const li = document.createElement('li');
    li.className = 'priority-row'; li.dataset.id = p.id || '';
    if (p.id === 'none') {
      li.innerHTML = '<span class="pr-none">None — no category (always available)</span>';
      return li;
    }
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'pr-name'; name.value = p.name || ''; name.placeholder = 'Category name';
    const bg = colorField('Bg', 'pr-color', p.color || '#a5d8ff');
    const tx = colorField('Text', 'pr-text', p.textColor || '#111827');
    const preview = document.createElement('span'); preview.className = 'pr-preview';
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'pr-del'; del.textContent = '🗑'; del.title = 'Remove';
    del.onclick = () => { li.remove(); markAppDirty(); };
    const refresh = () => {
      preview.textContent = name.value.trim() || 'Preview';
      preview.style.background = bg.querySelector('input').value;
      preview.style.color = tx.querySelector('input').value;
    };
    [name, bg.querySelector('input'), tx.querySelector('input')].forEach((i) => i.addEventListener('input', refresh));
    li.append(name, bg, tx, preview, del);
    refresh();
    return li;
  }
  $('#addPriorityBtn').onclick = () => {
    $('#priorityEditor').appendChild(priorityRow({ id: '', name: '', color: '#a5d8ff', textColor: '#111827' }));
    markAppDirty();
  };
  function dismissAppModal() {
    applyTheme(state.themeId); clearAppDirty(); appModal.hidden = true;
    const b = $('#appSettingsBtn'); if (b) b.focus(); // restore focus to the trigger
  }
  function guardedCloseAppModal() {
    if (!appDirty) { dismissAppModal(); return; }
    if (confirm('You have unsaved changes.\n\nOK to save them, or Cancel to discard.')) $('#appSave').click();
    else dismissAppModal();
  }
  $('#appSettingsBtn').onclick = openAppModal;
  // Both the ✕ and Cancel behave the same: prompt if there are unsaved changes.
  $('#appCancel').onclick = guardedCloseAppModal;
  $('#appSave').onclick = async () => {
    const priorities = $$('#priorityEditor .priority-row').map((r) => {
      if (r.querySelector('.pr-none')) return { id: 'none', name: 'None', color: null, textColor: null };
      return {
        id: r.dataset.id || undefined,
        name: r.querySelector('.pr-name').value.trim(),
        color: r.querySelector('.pr-color').value,
        textColor: r.querySelector('.pr-text').value,
      };
    }).filter((p) => p.name);
    const laneColors = $$('#laneColorsEditor input[type=color]').map((i) => i.value);

    // Guardrails: never let the app be saved with no categories or no lane
    // colors — the board relies on at least one of each.
    if (priorities.filter((p) => p.id !== 'none').length === 0) {
      showAppError('Add at least one category before saving.', 'categories'); return;
    }
    if (laneColors.length === 0) {
      showAppError('Add at least one lane color before saving.', 'lanes'); return;
    }

    const bd = (key) => ({
      color: $(`#badgeEditor [data-badge="${key}"] .bd-color`).value,
      textColor: $(`#badgeEditor [data-badge="${key}"] .bd-text`).value,
    });
    const badges = { due: bd('due'), tag: bd('tag'), source: bd('source') };
    const saveBtn = $('#appSave');
    saveBtn.disabled = true;
    try {
      const s = await api('/settings', { method: 'PUT', body: { theme: pendingTheme, priorities, laneColors, badges } });
      state.settings = s;
      // Auto-backup config (main Save, no separate button).
      try {
        const bc = await api('/backups/config', { method: 'PUT', body: { autoEnabled: $('#autoBackupEnabled').checked, frequency: $('#autoBackupFreq').value, retention: parseInt($('#autoBackupRetention').value, 10) || undefined } });
        state.settings.backup = bc;
      } catch (e) { toast('Auto-backup not saved: ' + (e.message || 'error')); }
      // Notifications (main Save too). Validation errors keep the modal open on
      // the offending sub-tab so nothing is silently dropped.
      const failed = [];
      for (const ch of ['email', 'discord', 'imessage']) {
        const on = $('#' + NOTIFY[ch].prefix + 'Enabled').checked;
        const st = $('#' + NOTIFY[ch].prefix + 'Status');
        // Enabled channels are connection-tested server-side before they save.
        if (on) { st.textContent = 'Checking connection…'; st.className = 'ai-test-status'; }
        try {
          await api('/notifications/' + ch, { method: 'PUT', body: NOTIFY[ch].collect() });
          if (on) { st.textContent = ''; st.className = 'ai-test-status'; }
        } catch (e) { failed.push([ch, e.message || 'Save failed']); }
      }
      if (failed.length) {
        const [ch, msg] = failed[0];
        setAppTab('notify');
        const sub = document.querySelector(`#notifySubtabs .notify-subtab[data-sub="${ch}"]`);
        if (sub) sub.click();
        const st = $('#' + NOTIFY[ch].prefix + 'Status');
        st.textContent = '✗ ' + msg; st.className = 'ai-test-status err';
        toast('Fix the notification error to finish saving.');
        return; // keep modal open + dirty
      }
      state.priorities = s.priorities; state.laneColors = s.laneColors; state.themeId = s.theme;
      if (s.badges) state.badges = s.badges;
      applyTheme(state.themeId);
      clearAppDirty();
      appModal.hidden = true; toast('Settings saved');
      if (state.board) renderBoard();
      renderInbox();
    } catch (e) {
      toast('Save failed: ' + (e.message || 'error'));
    } finally {
      saveBtn.disabled = false;
    }
  };

  // ---- Inbox ----
  async function loadInbox() {
    try { const { items } = await api('/inbox'); state.inbox = items; renderInbox(); } catch {}
  }
  function renderInbox() {
    $('#inboxCount').textContent = state.inbox.length;
    updateInboxTabLabel();
    const ul = $('#inboxList'); ul.innerHTML = '';
    state.inbox.forEach((it) => ul.appendChild(renderInboxCard(it)));
    makeInboxSortable(ul);
  }
  function renderInboxCard(it) {
    const li = document.createElement('li');
    li.className = 'inbox-card'; li.dataset.inboxId = it.id;
    let badges = '';
    if (it.priority && it.priority !== 'none') {
      const pc = priColor(it.priority) || '#868e96';
      const tc = priText(it.priority) || textOn(pc);
      badges += `<span class="tag-chip" style="background:${pc};color:${tc}">${esc(priName(it.priority))}</span>`;
    }
    (it.tags || []).forEach((t) => { badges += `<span class="tag-chip" style="background:${state.badges.tag.color};color:${state.badges.tag.textColor}">${esc(t)}</span>`; });
    badges += alarmBadge(it.alarm, 'tag-chip');
    badges += emailBadge(it.email, 'tag-chip');
    const src = state.badges.source;
    li.innerHTML =
      `<button class="ic-del" title="Dismiss" aria-label="Dismiss inbox item">✕</button>` +
      `<div class="ic-title">${esc(it.subject)}</div>` +
      `<div class="ic-row">${badges}<span class="ic-src" style="background:${src.color};color:${src.textColor}">${esc(it.source || 'api')}</span></div>` +
      `<button class="ic-menu" title="Send to a board" aria-label="Send to a board">⋮</button>`;
    li.querySelector('.ic-del').onclick = async (e) => {
      e.stopPropagation();
      await api('/inbox/' + it.id, { method: 'DELETE' });
      loadInbox();
    };
    li.querySelector('.ic-menu').onclick = (e) => { e.stopPropagation(); openSendToBoardMenu(it, e.currentTarget); };
    li.onclick = () => openInboxCardModal(it);
    return li;
  }

  // Popup anchored to an inbox card's ⋮ button: pick a board to file the item
  // into (lands in that board's first column). One shared menu element.
  let sendMenuEl = null;
  function closeSendMenu() {
    if (sendMenuEl) { sendMenuEl.remove(); sendMenuEl = null; }
    document.removeEventListener('click', closeSendMenu, true);
    document.removeEventListener('keydown', onSendMenuKey, true);
    window.removeEventListener('resize', closeSendMenu);
  }
  function onSendMenuKey(e) { if (e.key === 'Escape') closeSendMenu(); }
  function openSendToBoardMenu(item, anchor) {
    closeSendMenu();
    const menu = document.createElement('div');
    menu.className = 'send-menu';
    const boards = state.boards || [];
    menu.innerHTML =
      `<div class="sm-head">Send to board</div>` +
      (boards.length
        ? boards.map((b) => `<button class="sm-item" data-id="${b.id}">${esc(b.name)}</button>`).join('')
        : `<div class="sm-empty">No boards yet</div>`);
    document.body.appendChild(menu);
    sendMenuEl = menu;

    // Position: right-align to the button, opening upward (menu sits above the
    // ⋮ in the card's bottom-right), clamped to the viewport.
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    let top = r.top - mh - 6;
    if (left < 8) left = 8;
    if (top < 8) top = r.bottom + 6; // not enough room above → drop below
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    menu.querySelectorAll('.sm-item').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const boardId = btn.dataset.id;
        closeSendMenu();
        try {
          await api(`/inbox/${item.id}/move`, { method: 'POST', body: { boardId, index: 0 } });
          const target = (state.boards.find((b) => b.id === boardId) || {}).name || 'board';
          await Promise.all([loadInbox(), (state.boardId === boardId ? refresh() : Promise.resolve())]);
          toast('Sent to ' + target);
        } catch (err) { toast('Send failed'); }
      };
    });

    // Defer the outside-click listener so this same click doesn't close it.
    setTimeout(() => {
      document.addEventListener('click', closeSendMenu, true);
      document.addEventListener('keydown', onSendMenuKey, true);
      window.addEventListener('resize', closeSendMenu);
    }, 0);
  }

  // Edit an inbox item in the same card modal (before it's dragged to a board).
  function openInboxCardModal(item) {
    state.editingCardId = null;
    state.newCardColumnId = null;
    state.editingInboxId = item.id;
    buildPriorityOptions();
    $('#cardSubject').value = item.subject;
    $('#cardDesc').value = item.description || '';
    $('#cardPriority').value = item.priority || 'none';
    $('#cardDue').value = toDateInput(item.dueDate);
    $('#cardAlarm').value = toDateTimeLocal(item.alarm);
    $('#cardTags').value = (item.tags || []).join(', ');
    setEmailUI(item.email);
    $('#cardBoardField').hidden = true; // use ⋮ "send to board" for Inbox items
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Api');
    $('#cardCreated').textContent = 'Inbox item · Source: ' + cap(item.source || 'api');
    $('#cardDelete').style.display = '';
    $('#cardArchive').style.display = 'none';
    cardModal.hidden = false;
    setTimeout(() => $('#cardSubject').focus(), 30);
  }
  function makeInboxSortable(ul) {
    if (typeof Sortable === 'undefined') return;
    new Sortable(ul, {
      group: { name: 'cards', pull: true, put: false },
      animation: 150, ghostClass: 'dragging',
      onEnd: async (evt) => {
        const toCol = evt.to.dataset.col;
        if (!toCol || evt.to === evt.from) return; // dropped back in inbox
        const inboxId = evt.item.dataset.inboxId;
        try {
          await api(`/inbox/${inboxId}/move`, {
            method: 'POST',
            body: { boardId: state.boardId, columnId: toCol, index: evt.newIndex },
          });
          await Promise.all([loadInbox(), refresh()]);
          toast('Filed to board');
        } catch (e) { toast('Move failed'); loadInbox(); refresh(); }
      },
    });
  }
  // ---- Inbox / Board bottom toggle ----
  // Inbox open/closed via the edge tab (remembered per browser).
  function setView(v, remember = true) {
    const boardOnly = v === 'board';
    document.body.classList.toggle('inbox-collapsed', boardOnly);
    const tab = $('#inboxTab');
    tab.setAttribute('aria-expanded', boardOnly ? 'false' : 'true');
    $('#inboxTabChev').textContent = boardOnly ? '›' : '‹';
    updateInboxTabLabel();
    if (remember) { try { localStorage.setItem('kandeck.inboxOpen', boardOnly ? '0' : '1'); } catch (_) {} }
  }
  function updateInboxTabLabel() {
    const n = (state.inbox || []).length;
    const open = !document.body.classList.contains('inbox-collapsed');
    const label = `${open ? 'Close' : 'Open'} the Inbox (${n} item${n === 1 ? '' : 's'})`;
    const tab = $('#inboxTab'); tab.title = label; tab.setAttribute('aria-label', label);
    const c = $('#inboxTabCount'); c.textContent = n > 99 ? '99+' : n; c.classList.toggle('zero', !n);
  }
  $('#inboxTab').onclick = () => setView(document.body.classList.contains('inbox-collapsed') ? 'inbox' : 'board');

  // ---- Top bar controls ----
  $('#autoSort').onchange = async (e) => {
    state.board.settings.autoSort = e.target.checked;
    await api('/boards/' + state.boardId, { method: 'PUT', body: { settings: { autoSort: e.target.checked } } });
    // apply to all columns
    for (const col of state.board.columns)
      await api(`/boards/${state.boardId}/columns/${col.id}`, { method: 'PUT', body: { autoSort: e.target.checked } });
    refresh();
  };
  $('#autoSortKey').onchange = async (e) => {
    await api('/boards/' + state.boardId, { method: 'PUT', body: { settings: { autoSortKey: e.target.value } } });
    if (state.board.settings.autoSort) { for (const col of state.board.columns) await api(`/boards/${state.boardId}/columns/${col.id}`, { method: 'PUT', body: { autoSort: true } }); }
    refresh();
  };
  $('#logoutBtn').onclick = async () => { await api('/auth/logout', { method: 'POST' }); window.location.href = '/login'; };

  // ---- Search-as-you-type finder (all boards; current board first) ----
  const searchBox = $('#searchResults');
  let searchTimer;
  function hideSearch() { searchBox.hidden = true; searchBox.innerHTML = ''; }
  function findCardInBoard(id) {
    for (const c of state.board.columns) { const k = c.cards.find((x) => x.id === id); if (k) return k; }
    return null;
  }
  async function openSearchResult(r) {
    hideSearch();
    if (r.boardId !== state.boardId) await openBoard(r.boardId);
    const card = state.board && findCardInBoard(r.cardId);
    if (card) openCardModal(card);
  }
  function renderSearchResults(results, q) {
    searchBox.innerHTML = '';
    if (!results.length) { searchBox.innerHTML = '<div class="sr-empty">No matching cards</div>'; searchBox.hidden = false; return; }
    const cur = results.filter((r) => r.boardId === state.boardId);
    const others = results.filter((r) => r.boardId !== state.boardId);
    const addGroup = (label, items) => {
      if (!items.length) return;
      const h = document.createElement('div'); h.className = 'sr-group'; h.textContent = label; searchBox.appendChild(h);
      items.slice(0, 25).forEach((r) => {
        const it = document.createElement('div'); it.className = 'sr-item';
        it.innerHTML =
          `<span class="sr-title">${r.complete ? '<span class="sr-check">✓ </span>' : ''}${esc(r.subject)}</span>` +
          `<span class="sr-meta">${esc(r.boardName)} · ${esc(r.columnName)}</span>`;
        it.onclick = () => openSearchResult(r);
        searchBox.appendChild(it);
      });
    };
    addGroup('This board', cur);
    addGroup('Other boards', others);
    searchBox.hidden = false;
  }
  async function runSearch(q) {
    try {
      const { results } = await api('/search?q=' + encodeURIComponent(q));
      renderSearchResults(results, q);
    } catch { hideSearch(); }
  }
  $('#search').oninput = (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!q) { hideSearch(); return; }
    searchTimer = setTimeout(() => runSearch(q), 140);
  };
  $('#search').onkeydown = (e) => {
    if (e.key === 'Escape') { hideSearch(); e.target.blur(); }
    if (e.key === 'Enter') { const first = searchBox.querySelector('.sr-item'); if (first) first.click(); }
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) hideSearch();
  });

  // ---- What's new (changelog) ----
  // Shown automatically once per new version; dismissing marks that version as
  // seen (server-side, so it follows you across browsers). Clicking the version
  // number reopens it any time.
  const whatsNewModal = $('#whatsNewModal');
  let whatsNewUnseen = false;
  const mdInline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const fmtRelDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  function renderWhatsNew(data) {
    const [cur, ...prev] = data.entries || [];
    const updated = data.unseen && data.lastSeenVersion && data.lastSeenVersion !== data.current;
    let html = `<div class="wn-banner">${updated
      ? `Updated <span class="wn-ver old">v${esc(data.lastSeenVersion)}</span> → <span class="wn-ver">v${esc(data.current)}</span>`
      : `You're on <span class="wn-ver">v${esc(data.current)}</span>`}</div>`;
    const section = (e, isCurrent) => `
      <section class="wn-entry${isCurrent ? ' current' : ''}">
        <div class="wn-head">
          <span class="wn-ver">v${esc(e.version)}</span>
          ${isCurrent ? '<span class="wn-tag">Current</span>' : ''}
          <span class="wn-date">${esc(fmtRelDate(e.date))}</span>
        </div>
        <ul>${(e.changes || []).map((c) => `<li>${mdInline(c)}</li>`).join('')}</ul>
      </section>`;
    if (!cur) html += '<p class="hint">No release notes found.</p>';
    else {
      html += section(cur, cur.version === data.current);
      if (prev.length) html += `<div class="wn-sub">Previous updates</div>` + prev.map((e) => section(e, false)).join('');
    }
    $('#wnBody').innerHTML = html;
    $('#wnBody').scrollTop = 0;
  }
  async function openWhatsNew(data) {
    try { data = data || await api('/changelog'); } catch { toast('Could not load release notes'); return; }
    whatsNewUnseen = !!data.unseen;
    renderWhatsNew(data);
    whatsNewModal.hidden = false;
    requestAnimationFrame(() => $('#wnOk').focus());
  }
  function closeWhatsNew() {
    whatsNewModal.hidden = true;
    if (whatsNewUnseen) {
      whatsNewUnseen = false;
      api('/changelog/seen', { method: 'PUT' }).catch(() => {});
    }
  }
  async function checkWhatsNew() {
    try {
      const data = await api('/changelog');
      if (data.unseen && (data.entries || []).length) openWhatsNew(data);
    } catch {}
  }
  $('#wnClose').onclick = $('#wnOk').onclick = closeWhatsNew;
  $('#versionFoot').onclick = () => openWhatsNew();

  // close modals on backdrop click / Esc (board modal rolls back an unsaved new board)
  const dismiss = (m) => {
    if (m === whatsNewModal) closeWhatsNew();
    else if (m === boardModal) closeBoardModal();
    else if (m === appModal) guardedCloseAppModal();
    else m.hidden = true;
  };
  $$('.modal-backdrop').forEach((m) => (m.onclick = (e) => { if (e.target === m) dismiss(m); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal-backdrop').forEach((m) => { if (!m.hidden) dismiss(m); }); });

  // ---- Live updates (SSE): refresh inbox/board the moment events arrive ----
  // Live updates. Three layers so counts/boards never go stale behind a proxy:
  //  1. Server-Sent Events (instant) with a 25 s server heartbeat;
  //  2. a watchdog that reconnects if nothing (not even a heartbeat) arrives
  //     for 70 s — proxies sometimes drop the stream without closing it;
  //  3. a 30 s poll of board counts + Inbox while the tab is visible, plus an
  //     immediate refresh when you come back to the tab.
  let es = null, lastEventAt = 0;
  function connectEvents() {
    if (typeof EventSource === 'undefined') return;
    try { if (es) es.close(); } catch {}
    try { es = new EventSource('/api/events'); } catch { return; }
    lastEventAt = Date.now();
    const alive = () => { lastEventAt = Date.now(); };
    es.addEventListener('open', alive);
    es.addEventListener('ping', alive);
    es.addEventListener('inbox', () => { alive(); loadInbox(); });
    // Any board changed anywhere → refresh tab counts (debounced), and the
    // current board itself if it's the one that changed and no window is open.
    let boardsTimer = null; const touched = new Set();
    es.addEventListener('boards', (e) => {
      alive();
      try { const p = JSON.parse(e.data || '{}'); if (p.boardId) touched.add(p.boardId); } catch {}
      clearTimeout(boardsTimer);
      boardsTimer = setTimeout(() => {
        const mine = touched.has(state.boardId); touched.clear();
        refreshBoardCounts();
        if (mine && state.boardId && $('#cardModal').hidden && $('#boardModal').hidden) refresh();
      }, 300);
    });
    es.addEventListener('card', (e) => {
      alive();
      try {
        const p = JSON.parse(e.data || '{}');
        // Refresh the current board when a card there changes, but don't yank
        // the board out from under an open modal.
        if (p.boardId && p.boardId === state.boardId && $('#cardModal').hidden && $('#boardModal').hidden) refresh();
      } catch {}
    });
    // EventSource auto-reconnects on a clean error; the watchdog covers the rest.
  }
  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - lastEventAt > 70000) connectEvents(); // stalled stream → reconnect
  }, 15000);

  // Fallback poll: keeps tab counts, the Inbox and the open board current even
  // if live events can't get through at all.
  let lastBoardStamp = null;
  async function pollUpdates() {
    if (document.hidden || !$('#cardModal').hidden || !$('#boardModal').hidden) return;
    try {
      const { boards } = await api('/boards');
      state.boards = boards; renderBoardSwitcher();
      const cur = boards.find((b) => b.id === state.boardId);
      const stamp = cur ? cur.updatedAt : null;
      if (lastBoardStamp !== null && stamp && stamp !== lastBoardStamp) await refresh();
      lastBoardStamp = stamp;
    } catch {}
    loadInbox();
  }
  setInterval(pollUpdates, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollUpdates(); if (Date.now() - lastEventAt > 70000) connectEvents(); } });
  window.addEventListener('focus', () => pollUpdates());

  // ---- Go ----
  (async () => {
    await loadSettings();
    await loadBoards();
    await loadInbox();
    let saved = null; try { saved = localStorage.getItem('kandeck.inboxOpen'); } catch (_) {}
    setView(saved === '1' ? 'inbox' : saved === '0' ? 'board' : (window.innerWidth <= 640 ? 'board' : 'inbox'), false);
    connectEvents();
    checkWhatsNew();
  })().catch((e) => console.error(e));
})();
