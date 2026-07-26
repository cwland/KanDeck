/**
 * Email notification provider (SMTP via nodemailer).
 *
 * Settings-driven (host/port/user/pass/encryption/from/to) so it's independent
 * of the env-based alarm mailer. Renders a branded, responsive HTML summary and
 * exposes verify() so the UI can validate SMTP before enabling/saving.
 */
import nodemailer from 'nodemailer';
import config from '../../config.js';
import { dueLabel } from './content.js';

// Map the UI's encryption choice onto nodemailer transport options.
//   ssl  → implicit TLS (secure:true, typically port 465)
//   tls  → STARTTLS upgrade (secure:false + requireTLS, typically 587)
//   none → plain (secure:false, ignoreTLS)
function transportFor(cfg) {
  const opts = {
    host: cfg.host,
    port: parseInt(cfg.port, 10) || 587,
    secure: cfg.encryption === 'ssl',
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  };
  if (cfg.encryption === 'tls') opts.requireTLS = true;
  if (cfg.encryption === 'none') opts.ignoreTLS = true;
  return nodemailer.createTransport(opts);
}

/** Validate SMTP connectivity/auth. Returns { ok, error? }. */
export async function verify(cfg) {
  if (!cfg.host) return { ok: false, error: 'SMTP host is required' };
  try {
    await transportFor(cfg).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const PRIORITY_COLOR = { urgent: '#e03131', high: '#f76707', medium: '#f59f00', low: '#4dabf7', none: '#868e96' };
const SECTION_ACCENT = { pastDue: '#e03131', dueToday: '#1971c2', upcoming: '#2f9e44' };

function taskRow(task) {
  const pc = PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.none;
  const prio = task.priority && task.priority !== 'none'
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${pc};color:#fff;font-size:11px;font-weight:600;text-transform:capitalize">${esc(task.priority)}</span>`
    : '';
  return (
    `<tr>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #eceff3;font-size:14px;color:#172b4d">` +
      `<strong>${esc(task.subject)}</strong>` +
      `<div style="color:#8a94a6;font-size:12px;margin-top:2px">${esc(task.boardName)} · ${esc(task.columnName)}</div>` +
    `</td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #eceff3;font-size:13px;color:#5e6c84;white-space:nowrap">${esc(dueLabel(task))}</td>` +
    `<td style="padding:8px 10px;border-bottom:1px solid #eceff3;text-align:right">${prio}</td>` +
    `</tr>`
  );
}

function sectionBlock(section) {
  const accent = SECTION_ACCENT[section.key] || '#4c6ef5';
  const body = section.tasks.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px">${section.tasks.map(taskRow).join('')}</table>`
    : `<div style="padding:10px 2px;color:#8a94a6;font-size:13px">Nothing here — nice. 🎉</div>`;
  return (
    `<div style="margin:22px 0 6px">` +
      `<div style="font-size:15px;font-weight:700;color:${accent}">${section.emoji} ${esc(section.title)} <span style="color:#adb5bd;font-weight:600">(${section.tasks.length})</span></div>` +
      body +
    `</div>`
  );
}

/** Build the consolidated email. Returns { subject, html }. */
export function render(cfg, sections, opts = {}) {
  const appUrl = opts.appUrl || config.appUrl || '';
  const accent = '#4c6ef5';
  const link = appUrl
    ? `<a href="${esc(appUrl)}" style="display:inline-block;margin-top:6px;padding:9px 16px;background:${accent};color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">Open KanDeck →</a>`
    : '';
  const blocks = sections.map(sectionBlock).join('');
  const html =
    `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:0">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
      `<div style="background:linear-gradient(180deg,${accent},#5c7cfa);border-radius:14px 14px 0 0;padding:18px 22px;color:#fff">` +
        `<div style="font-size:20px;font-weight:800;letter-spacing:.3px">🗂️ KanDeck</div>` +
        `<div style="opacity:.9;font-size:13px;margin-top:2px">${esc(cfg.subject || 'Daily Task Summary')}</div>` +
      `</div>` +
      `<div style="background:#fff;border-radius:0 0 14px 14px;padding:6px 22px 22px;box-shadow:0 1px 3px rgba(9,30,66,.12)">` +
        blocks +
        (link ? `<div style="margin-top:20px">${link}</div>` : '') +
      `</div>` +
      `<div style="text-align:center;color:#adb5bd;font-size:11px;margin-top:14px">Sent by KanDeck · you can adjust or turn off these summaries in App Settings → Notifications</div>` +
    `</div></body></html>`;
  return { subject: cfg.subject || 'Daily Task Summary', html };
}

export async function send(cfg, { subject, html }) {
  await transportFor(cfg).sendMail({ from: cfg.from || cfg.user, to: cfg.to, subject, html });
  return true;
}
