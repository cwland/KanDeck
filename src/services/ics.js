/**
 * Per-board iCalendar (.ics) feed.
 *
 * Calendar apps (Google, Apple, Outlook) subscribe to a URL and poll it; they
 * can't log in, so the feed is authorised by an unguessable per-board token in
 * the URL (a "capability URL"). The feed is read-only, off by default, and can
 * be rotated or revoked from Board settings.
 *
 * Cards with a due date become all-day VEVENTs on that date; cards without one
 * become VTODOs (note: Google Calendar ignores VTODO; Apple/Thunderbird/Outlook
 * clients vary in whether they show to-dos from a subscribed feed).
 */
import { getPriorities } from '../storage/settings.js';
import { getBoardForIcs } from '../storage/boards.js';

// ---- iCalendar text helpers (RFC 5545) -------------------------------------

function escText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets (UTF-8 aware), continuation = CRLF + space. */
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n) => String(n).padStart(2, '0');

function utcStamp(d) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Calendar date of a due date. Uses the leading YYYY-MM-DD, matching how the
 *  rest of KanDeck (notifications, task query) reads due dates. */
function dueYmd(dueDate) {
  const m = String(dueDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
function ymdStr({ y, m, d }) {
  return `${y}${pad(m)}${pad(d)}`;
}
function nextDay({ y, m, d }) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// ---- Feed builder ----------------------------------------------------------

export async function buildBoardIcs(board) {
  const opts = board.ics || {};
  const prios = await getPriorities().catch(() => []);
  const prioName = (id) => (prios.find((p) => p.id === id) || {}).name || id;
  const now = utcStamp(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KanDeck//Board Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText('KanDeck · ' + board.name)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  for (const col of board.columns || []) {
    for (const card of col.cards || []) {
      if (card.archived) continue;
      if (card.complete && !opts.includeCompleted) continue;
      const due = dueYmd(card.dueDate);

      const info = [`Lane: ${col.name}`];
      if (card.priority && card.priority !== 'none') info.push(`Category: ${prioName(card.priority)}`);
      if (card.tags && card.tags.length) info.push(`Tags: ${card.tags.join(', ')}`);
      if (card.complete && card.completedAt) info.push(`Completed: ${card.completedAt.slice(0, 10)}`);
      let desc = info.join('\n');
      if (opts.includeDescriptions && card.description) desc += '\n\n' + card.description;

      const created = card.createdAt && !Number.isNaN(Date.parse(card.createdAt)) ? utcStamp(new Date(card.createdAt)) : null;
      const completed = card.completedAt && !Number.isNaN(Date.parse(card.completedAt)) ? utcStamp(new Date(card.completedAt)) : null;
      const common = [
        `UID:${escText(card.id)}@kandeck`,
        `DTSTAMP:${completed || created || now}`,
        ...(created ? [`CREATED:${created}`] : []),
        `SUMMARY:${escText((card.complete ? '✓ ' : '') + card.subject)}`,
        `DESCRIPTION:${escText(desc)}`,
        ...(card.priority && card.priority !== 'none' ? [`CATEGORIES:${escText(prioName(card.priority))}`] : []),
      ];

      if (due) {
        // Dated card → all-day event on its due date.
        lines.push(
          'BEGIN:VEVENT',
          ...common,
          `DTSTART;VALUE=DATE:${ymdStr(due)}`,
          `DTEND;VALUE=DATE:${ymdStr(nextDay(due))}`,
          'TRANSP:TRANSPARENT', // all-day reminders shouldn't block free/busy
          'END:VEVENT'
        );
      } else {
        // Undated card → to-do (no date to place it on a calendar).
        lines.push(
          'BEGIN:VTODO',
          ...common,
          `STATUS:${card.complete ? 'COMPLETED' : 'NEEDS-ACTION'}`,
          ...(card.complete && completed ? [`COMPLETED:${completed}`, 'PERCENT-COMPLETE:100'] : []),
          'END:VTODO'
        );
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- Express handler (mounted publicly in server.js) -----------------------

export async function icsHandler(req, res) {
  res.set({
    'Cache-Control': 'private, max-age=300',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  });
  try {
    const m = String(req.params.file || '').match(/^([A-Za-z0-9_-]{20,128})\.ics$/);
    const board = m ? await getBoardForIcs(req.params.boardId, m[1]) : null;
    // One uniform 404 for every failure (bad id, bad token, disabled, archived)
    // so the endpoint never reveals which boards exist.
    if (!board) return res.status(404).type('text/plain').send('Not found');
    res.type('text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="kandeck.ics"');
    res.send(await buildBoardIcs(board));
  } catch (err) {
    console.error('[ics]', err && err.message);
    res.status(404).type('text/plain').send('Not found');
  }
}
