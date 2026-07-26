/**
 * Discord notification provider (incoming webhook).
 *
 * Renders the shared sections into a single message with one embed per enabled
 * category, and validates that a webhook URL is real before saving/enabling.
 */
import { dueLabel } from './content.js';

// Fallback colors when a category has no configured color (matches the app's
// default category palette).
const FALLBACK_COLOR = { urgent: '#ffc9c9', high: '#ffd8a8', medium: '#ffec99', low: '#a5d8ff', none: '#868e96' };

function hexToInt(hex) {
  if (!hex || typeof hex !== 'string') return 0x868e96;
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const n = parseInt(c, 16);
  return Number.isNaN(n) ? 0x868e96 : n;
}

/**
 * Build the consolidated Discord message. One embed per task, with the embed's
 * accent bar set to that task's category color (the same color the app uses on
 * the card), so priorities read consistently — no scattered circle emojis. The
 * section (past due / due today / upcoming) shows via the title emoji.
 */
export function render(sections) {
  const summary = sections.map((s) => `${s.emoji} ${s.tasks.length}`).join('  ');
  const flat = [];
  for (const s of sections) for (const t of s.tasks) flat.push({ t, s });

  if (!flat.length) {
    return { content: '🗂️ **KanDeck Task Summary**', embeds: [{ description: "✅ Nothing due — you're all caught up!", color: 0x2f9e44 }] };
  }

  const embeds = flat.slice(0, 10).map(({ t, s }) => {
    const prio = t.priority && t.priority !== 'none' ? ` · **${t.priorityName || t.priority}**` : '';
    return {
      title: `${s.emoji} ${t.subject}`,
      description: `${t.boardName} · _${dueLabel(t)}_${prio}`,
      color: hexToInt(t.priorityColor || FALLBACK_COLOR[t.priority] || FALLBACK_COLOR.none),
    };
  });

  let content = `🗂️ **KanDeck Task Summary** — ${summary}`;
  if (flat.length > 10) content += `\n_…and ${flat.length - 10} more._`;
  return { content, embeds };
}

export async function send(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord webhook returned HTTP ${res.status}`);
  return true;
}

/** Confirm a webhook URL points at a real Discord webhook. Returns { ok, error? }. */
export async function validate(webhookUrl) {
  if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//i.test(webhookUrl || '')) {
    return { ok: false, error: 'That does not look like a Discord webhook URL.' };
  }
  try {
    const res = await fetch(webhookUrl, { method: 'GET' });
    if (!res.ok) return { ok: false, error: `Webhook check returned HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    if (!data || !data.id) return { ok: false, error: 'Webhook responded but looks invalid.' };
    return { ok: true, name: data.name || null };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
