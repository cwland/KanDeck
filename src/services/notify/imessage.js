/**
 * Text-message provider — sends through the iMessage Gateway Mac app
 * (https://github.com/cwland/imessage-gateway): POST {url}/v1/send with
 * `Authorization: Bearer <key>` and { to, message, service }.
 *
 * Used for alarm reminders (a text when a card's alarm time arrives) and,
 * optionally, the scheduled task summary rendered as plain text.
 */
import { dueLabel } from './content.js';

const TIMEOUT_MS = 20000;
const MAX_LEN = 1500; // keep summaries to one readable message

/** "a, b; c" → ['a', 'b', 'c'] */
export function recipients(to) {
  return String(to || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

/** Pull a readable error out of a gateway response body. */
function gatewayError(status, body) {
  const d = body && body.detail;
  if (typeof d === 'string') return `${d} (HTTP ${status})`;
  if (d && typeof d === 'object') return `${d.error || 'Send failed'}${d.hint ? ` — ${d.hint}` : ''} (HTTP ${status})`;
  if (status === 401) return 'Invalid or missing API key (HTTP 401)';
  return `Gateway returned HTTP ${status}`;
}

async function call(cfg, path, { method = 'GET', body, auth = true } = {}) {
  const headers = { accept: 'application/json' };
  if (auth) headers.authorization = `Bearer ${cfg.apiKey}`;
  if (body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const why = e && e.name === 'TimeoutError' ? 'timed out' : (e && e.cause && e.cause.code) || e.message || 'unreachable';
    throw new Error(`Couldn't reach the gateway at ${cfg.url} (${why}). Is the Mac awake, and is the gateway set to accept connections from the local network?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(gatewayError(res.status, data));
  return data;
}

/** Send one text to every recipient. Throws if any send fails. */
export async function send(cfg, message) {
  const list = recipients(cfg.to);
  if (!list.length) throw new Error('No recipient set.');
  const errors = [];
  for (const to of list) {
    try { await call(cfg, '/v1/send', { method: 'POST', body: { to, message, service: cfg.service || 'iMessage' } }); }
    catch (e) { errors.push(`${to}: ${e.message}`); }
  }
  if (errors.length) throw new Error(errors.join('; '));
  return true;
}

/** Check URL + key without sending anything. Returns { ok, version?, messagesRunning?, error? }. */
export async function verify(cfg) {
  if (!/^https?:\/\/[^/\s]+/i.test(cfg.url || '')) return { ok: false, error: 'Enter the gateway URL, e.g. http://192.168.50.20:8787' };
  if (!cfg.apiKey) return { ok: false, error: 'Enter the gateway API key.' };
  if (!recipients(cfg.to).length) return { ok: false, error: 'Enter at least one phone number or Apple ID to text.' };
  try {
    const health = await call(cfg, '/health', { auth: false });
    const status = await call(cfg, '/v1/status'); // 401 here = bad key
    return { ok: true, version: health.version || null, messagesRunning: status.messages_running ?? status.messagesRunning ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---- Message text ------------------------------------------------------------

/** Alarm reminder text. ctx: { boardName?, columnName?, inbox? } */
export function renderAlarm(card, ctx = {}) {
  const lines = [`⏰ Reminder: ${card.subject}`];
  if (ctx.inbox) lines.push('KanDeck Inbox');
  else if (ctx.boardName) lines.push(`${ctx.boardName}${ctx.columnName ? ` · ${ctx.columnName}` : ''}`);
  if (card.dueDate) {
    const m = String(card.dueDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) lines.push(`Due ${new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
  }
  return lines.join('\n');
}

/** Scheduled summary as plain text (same sections as email / Discord). */
export function renderSummary(sections) {
  const total = sections.reduce((n, s) => n + s.tasks.length, 0);
  if (!total) return "🗂️ KanDeck: nothing due — you're all caught up! ✅";
  const out = [`🗂️ KanDeck summary (${total})`];
  let shown = 0;
  for (const s of sections) {
    if (!s.tasks.length) continue;
    out.push('', `${s.emoji} ${s.title} (${s.tasks.length})`);
    for (const t of s.tasks) {
      const line = `• ${t.subject} — ${t.boardName}, ${dueLabel(t)}`;
      if (out.join('\n').length + line.length > MAX_LEN) {
        out.push(`…and ${total - shown} more`);
        return out.join('\n');
      }
      out.push(line);
      shown++;
    }
  }
  return out.join('\n');
}
