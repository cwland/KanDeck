// KanDeck — Floating AI Chat widget.
// ---------------------------------------------------------------------------
// Ported from Auto Dashboard AI's chat widget. A persistent, draggable chat
// bubble/window that talks to an n8n Chat Webhook. Client-side only, so:
//   • the webhook URL + optional bearer token come from App Settings → AI Chat,
//   • conversation history is persisted in localStorage (per device/browser),
//   • a stable sessionId is sent on every request so n8n memory nodes keep
//     per-user context.
//
// Response model is a simple POST -> wait -> JSON (no streaming). The widget
// accepts a range of common n8n reply field names (reply/output/text/…).
//
// Rendered only when App Settings → AI Chat is enabled. Exposed as
// window.AIChatWidget (class) and window.initAIChat(settings) (bootstrap).
'use strict';

(function (global) {
  // localStorage keys (namespaced so they don't collide with other app state)
  const K_HISTORY = 'kandeck.aiChatHistory';
  const K_SESSION = 'kandeck.aiChatSessionId';
  const K_UI = 'kandeck.aiChatUi';

  const MOBILE_BP = 640;       // <= this width → full-screen sheet, drag off
  const DRAG_THRESHOLD = 5;    // px of movement before a press counts as a drag
  const DEFAULT_TIMEOUT = 60000;   // ms; overridable per-install via settings.aiChatTimeout
  const EDGE = 12;             // min gap kept from the viewport edge when clamping

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // Very small, safe markdown-ish renderer: escape first, then linkify + **bold**
  // + `code` + newlines. Never injects raw HTML from the model.
  function fmt(s) {
    let h = esc(s);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return h.replace(/\n/g, '<br>');
  }

  // localStorage helpers (JSON-encoded values, resilient to quota/parse errors).
  function lsGet(key, fallback) {
    try {
      const raw = global.localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function lsSet(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  const isMobile = () => (global.innerWidth || 1024) <= MOBILE_BP;

  class AIChatWidget {
    constructor(cfg) {
      this.cfg = Object.assign(
        { webhookUrl: '', token: '', historyLength: 10, timeoutMs: DEFAULT_TIMEOUT, title: 'AI Assistant' },
        cfg || {}
      );
      this.messages = [];      // { role:'user'|'assistant', text, ts }
      this.sessionId = '';
      this.opened = false;
      this.sending = false;
      this.abort = null;
      this.pos = { bubble: null, window: null };   // {x,y} from top-left, or null
      this.destroyed = false;
      this._onResize = () => this._handleResize();
      this._build();
      global.addEventListener('resize', this._onResize);
      this._init();
    }

    _newSession() {
      try { return crypto.randomUUID(); }
      catch (_) { return 'sess-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36); }
    }

    _init() {
      this.messages = lsGet(K_HISTORY, []);
      if (!Array.isArray(this.messages)) this.messages = [];
      this.sessionId = lsGet(K_SESSION, '') || this._newSession();
      lsSet(K_SESSION, this.sessionId);
      const ui = lsGet(K_UI, null);
      this.pos = (ui && typeof ui === 'object') ? ui : { bubble: null, window: null };
      if (this.destroyed) return;
      this._applyPositions();
      this._renderMessages();
    }

    // ── DOM ──────────────────────────────────────────────────────────────────
    _build() {
      const root = document.createElement('div');
      root.id = 'ai-chat-root';
      root.className = 'ai-chat-root';
      root.innerHTML =
        '<button type="button" class="aic-bubble" aria-label="Open AI chat" title="AI Assistant">' +
          '<svg class="aic-bubble-icon" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
          '</svg></button>' +
        '<section class="aic-window" role="dialog" aria-label="AI chat" aria-modal="false" hidden>' +
          '<header class="aic-header">' +
            '<span class="aic-drag-dots" aria-hidden="true">⋮⋮</span>' +
            '<span class="aic-title"></span>' +
            '<button type="button" class="aic-btn aic-clear" title="Clear conversation" aria-label="Clear conversation">' +
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
            '</button>' +
            '<button type="button" class="aic-btn aic-close" title="Close" aria-label="Close">' +
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
          '</header>' +
          '<div class="aic-messages" aria-live="polite"></div>' +
          '<div class="aic-error" role="alert" hidden></div>' +
          '<form class="aic-input-row">' +
            '<textarea class="aic-input" rows="1" placeholder="Ask something…" autocomplete="off"></textarea>' +
            '<button type="submit" class="aic-send" title="Send" aria-label="Send">' +
              '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
            '</button>' +
          '</form>' +
        '</section>';
      (document.body || document.documentElement).appendChild(root);

      this.root = root;
      this.bubble = root.querySelector('.aic-bubble');
      this.win = root.querySelector('.aic-window');
      this.header = root.querySelector('.aic-header');
      this.msgsEl = root.querySelector('.aic-messages');
      this.errorEl = root.querySelector('.aic-error');
      this.form = root.querySelector('.aic-input-row');
      this.input = root.querySelector('.aic-input');
      this.sendBtn = root.querySelector('.aic-send');
      root.querySelector('.aic-title').textContent = this.cfg.title;

      // toggle open/close
      this._makeDraggable(this.bubble, this.bubble, 'bubble', () => this.toggle());
      this._makeDraggable(this.win, this.header, 'window', null);
      root.querySelector('.aic-close').addEventListener('click', () => this.close());
      root.querySelector('.aic-clear').addEventListener('click', () => this.clearConversation());

      this.form.addEventListener('submit', (e) => { e.preventDefault(); this._submit(); });
      // Enter sends, Shift+Enter newline
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit(); }
      });
      this.input.addEventListener('input', () => this._autoGrow());
    }

    _autoGrow() {
      const el = this.input;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    // ── Open / close ───────────────────────────────────────────────────────────
    toggle() { this.opened ? this.close() : this.open(); }

    open() {
      this.opened = true;
      this.win.hidden = false;
      this.root.classList.add('aic-open');
      this._applyPositions();
      this._scrollToBottom();
      // focus after the show transition so mobile keyboards behave
      setTimeout(() => { try { this.input.focus(); } catch (_) {} }, 60);
    }

    close() {
      this.opened = false;
      this.win.hidden = true;
      this.root.classList.remove('aic-open');
    }

    // ── Dragging (with click-vs-drag threshold + viewport clamping) ─────────────
    _makeDraggable(el, handle, key, onClick) {
      let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false, pointerId = null;

      const onDown = (e) => {
        if (e.button != null && e.button !== 0) return;           // left button / touch only
        // don't start a drag from the interactive controls in the header
        if (e.target.closest && e.target.closest('.aic-btn')) return;
        const rect = el.getBoundingClientRect();
        originX = rect.left; originY = rect.top;
        startX = e.clientX; startY = e.clientY;
        dragging = false;
        pointerId = e.pointerId;
        try { handle.setPointerCapture(pointerId); } catch (_) {}
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      };

      const onMove = (e) => {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (isMobile()) return;                                   // clamp: no drag on mobile
        dragging = true;
        this.root.classList.add('aic-dragging');
        const w = el.offsetWidth, h = el.offsetHeight;
        let nx = originX + dx, ny = originY + dy;
        nx = Math.max(EDGE, Math.min(nx, (global.innerWidth || 0) - w - EDGE));
        ny = Math.max(EDGE, Math.min(ny, (global.innerHeight || 0) - h - EDGE));
        this._setPos(el, key, nx, ny);
      };

      const onUp = (e) => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        try { handle.releasePointerCapture(pointerId); } catch (_) {}
        this.root.classList.remove('aic-dragging');
        const wasDrag = dragging;
        dragging = false;
        if (wasDrag) { this._persistUi(); return; }               // a real drag: no click
        if (onClick) onClick(e);                                   // otherwise treat as click
      };

      handle.addEventListener('pointerdown', onDown);
    }

    _setPos(el, key, x, y) {
      this.pos[key] = { x, y };
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }

    // Apply saved positions (or fall back to the CSS default bottom-right anchor).
    _applyPositions() {
      if (isMobile()) { this._clearInlinePos(this.bubble); this._clearInlinePos(this.win); return; }
      const place = (el, key) => {
        const p = this.pos[key];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          const w = el.offsetWidth || 0, h = el.offsetHeight || 0;
          const x = Math.max(EDGE, Math.min(p.x, (global.innerWidth || 0) - w - EDGE));
          const y = Math.max(EDGE, Math.min(p.y, (global.innerHeight || 0) - h - EDGE));
          el.style.left = x + 'px'; el.style.top = y + 'px';
          el.style.right = 'auto'; el.style.bottom = 'auto';
        } else {
          this._clearInlinePos(el);
        }
      };
      place(this.bubble, 'bubble');
      if (!this.win.hidden) place(this.win, 'window');
    }

    _clearInlinePos(el) {
      el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
    }

    _handleResize() {
      if (isMobile()) { this._clearInlinePos(this.bubble); this._clearInlinePos(this.win); }
      else this._applyPositions();
    }

    _persistUi() { lsSet(K_UI, this.pos); }

    // ── Messages ───────────────────────────────────────────────────────────────
    _renderMessages() {
      this.msgsEl.innerHTML = '';
      if (!this.messages.length) {
        const empty = document.createElement('div');
        empty.className = 'aic-empty';
        empty.textContent = 'Ask me anything about your boards, cards, or tasks.';
        this.msgsEl.appendChild(empty);
      } else {
        for (const m of this.messages) this.msgsEl.appendChild(this._msgEl(m.role, m.text));
      }
      this._scrollToBottom();
    }

    _msgEl(role, text) {
      const wrap = document.createElement('div');
      wrap.className = 'aic-msg aic-' + (role === 'user' ? 'user' : 'assistant');
      const bub = document.createElement('div');
      bub.className = 'aic-msg-bubble';
      bub.innerHTML = fmt(text);
      wrap.appendChild(bub);
      return wrap;
    }

    _scrollToBottom() {
      requestAnimationFrame(() => { this.msgsEl.scrollTop = this.msgsEl.scrollHeight; });
    }

    _pushMessage(role, text) {
      this.messages.push({ role, text, ts: Date.now() });
      this._trim();
      // remove empty-state placeholder if present
      const empty = this.msgsEl.querySelector('.aic-empty');
      if (empty) empty.remove();
      this.msgsEl.appendChild(this._msgEl(role, text));
      this._scrollToBottom();
      this._persistHistory();
    }

    _trim() {
      const n = Math.max(1, this.cfg.historyLength | 0 || 10);
      if (this.messages.length > n) this.messages = this.messages.slice(-n);
    }

    _persistHistory() { lsSet(K_HISTORY, this.messages); }

    _showTyping() {
      this._hideTyping();
      const t = document.createElement('div');
      t.className = 'aic-msg aic-assistant aic-typing-row';
      t.innerHTML = '<div class="aic-msg-bubble aic-typing"><span></span><span></span><span></span></div>';
      this.typingEl = t;
      this.msgsEl.appendChild(t);
      this._scrollToBottom();
    }

    _hideTyping() { if (this.typingEl) { this.typingEl.remove(); this.typingEl = null; } }

    _showError(msg) {
      this.errorEl.textContent = msg;
      this.errorEl.hidden = false;
      clearTimeout(this._errTimer);
      this._errTimer = setTimeout(() => { this.errorEl.hidden = true; }, 6000);
    }

    // ── Send ─────────────────────────────────────────────────────────────────
    async _submit() {
      const text = (this.input.value || '').trim();
      if (!text || this.sending) return;
      if (!this.cfg.webhookUrl) { this._showError('No webhook URL configured. Set it in App Settings → AI Chat.'); return; }

      this.input.value = ''; this._autoGrow();
      this._pushMessage('user', text);
      this.sending = true; this.sendBtn.disabled = true; this.errorEl.hidden = true;
      this._showTyping();

      try {
        const reply = await this._callWebhook(text);
        this._hideTyping();
        this._pushMessage('assistant', reply);
      } catch (err) {
        this._hideTyping();
        const msg = (err && err.name === 'AbortError')
          ? 'The assistant took too long to respond. Please try again.'
          : 'Couldn’t reach the assistant. Check the webhook URL and that your n8n workflow is active.';
        this._showError(msg);
      } finally {
        this.sending = false; this.sendBtn.disabled = false;
        try { this.input.focus(); } catch (_) {}
      }
    }

    async _callWebhook(text) {
      if (this.abort) this.abort.abort();
      this.abort = ('AbortController' in global) ? new AbortController() : null;
      const timer = this.abort ? setTimeout(() => this.abort.abort(), this.cfg.timeoutMs || DEFAULT_TIMEOUT) : null;

      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (this.cfg.token) headers.Authorization = 'Bearer ' + this.cfg.token;

      const body = {
        source: 'kandeck',
        sessionId: this.sessionId,
        message: text,
        timestamp: new Date().toISOString(),
      };

      let res;
      try {
        res = await fetch(this.cfg.webhookUrl, {
          method: 'POST', headers, body: JSON.stringify(body),
          cache: 'no-store', signal: this.abort && this.abort.signal,
        });
      } finally { if (timer) clearTimeout(timer); }

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        return this._extractReply(data);
      }
      const txt = await res.text();
      return txt || '(empty response)';
    }

    // Accept the common n8n reply shapes without forcing the workflow author
    // into one exact field name.
    _extractReply(data) {
      if (data == null) return '(empty response)';
      if (typeof data === 'string') return data;
      if (Array.isArray(data)) return this._extractReply(data[0]);
      const keys = ['reply', 'output', 'text', 'message', 'response', 'answer', 'content'];
      for (const k of keys) {
        if (data[k] != null && typeof data[k] !== 'object') return String(data[k]);
      }
      // n8n AI Agent sometimes nests under json / data
      if (data.json) return this._extractReply(data.json);
      if (data.data) return this._extractReply(data.data);
      return '(unrecognized response)';
    }

    // ── Clear ──────────────────────────────────────────────────────────────────
    clearConversation() {
      if (this.abort) { try { this.abort.abort(); } catch (_) {} }
      this.sending = false; this.sendBtn.disabled = false;
      this.messages = [];
      this.sessionId = this._newSession();
      this._hideTyping();
      lsSet(K_HISTORY, []);
      lsSet(K_SESSION, this.sessionId);
      this._renderMessages();
      this._showError('Conversation cleared — starting a fresh session.');
    }

    destroy() {
      this.destroyed = true;
      if (this.abort) { try { this.abort.abort(); } catch (_) {} }
      global.removeEventListener('resize', this._onResize);
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
  }

  // Bootstrap: only mount when the feature is enabled in Settings. Re-runs on
  // every settings save, so it tears down and rebuilds to pick up config changes.
  function initAIChat(settings) {
    if (global.__aiChatWidget) { try { global.__aiChatWidget.destroy(); } catch (_) {} global.__aiChatWidget = null; }
    if (!settings || settings.aiChatEnabled !== true) return null;
    const w = new AIChatWidget({
      webhookUrl: settings.aiChatWebhookUrl || '',
      token: settings.aiChatToken || '',
      historyLength: parseInt(settings.aiChatHistoryLength, 10) || 10,
      timeoutMs: (parseInt(settings.aiChatTimeout, 10) || 60) * 1000,
      title: settings.aiChatTitle || 'AI Assistant',
    });
    global.__aiChatWidget = w;
    return w;
  }

  global.AIChatWidget = AIChatWidget;
  global.initAIChat = initAIChat;
})(typeof window !== 'undefined' ? window : this);
