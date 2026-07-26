/**
 * Discord notification provider (incoming webhook).
 *
 * Renders the shared sections into a single message with one embed per enabled
 * category, and validates that a webhook URL is real before saving/enabling.
 */
import { dueLabel } from './content.js';

const PRIORITY_EMOJI = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🔵', none: '⚪' };
const SECTION_COLOR = { pastDue: 0xe03131, dueToday: 0x1971c2, upcoming: 0x2f9e44 };

function embedFor(section) {
  const lines = section.tasks.length
    ? section.tasks.slice(0, 20).map((t) => {
        const pe = PRIORITY_EMOJI[t.priority] || PRIORITY_EMOJI.none;
        const prio = t.priority && t.priority !== 'none' ? ` ${pe} ${t.priority}` : '';
        return `• **${t.subject}** — _${dueLabel(t)}_ · ${t.boardName}${prio}`;
      }).join('\n')
    : '_Nothing here — nice._ 🎉';
  return {
    title: `${section.emoji} ${section.title} (${section.tasks.length})`,
    description: lines.slice(0, 4000),
    color: SECTION_COLOR[section.key] || 0x4c6ef5,
  };
}

/** Build the consolidated Discord message payload. */
export function render(sections) {
  return {
    content: '🗂️ **KanDeck Task Summary**',
    embeds: sections.map(embedFor).slice(0, 10),
  };
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
