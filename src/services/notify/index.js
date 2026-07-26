/**
 * Shared notification scheduler + provider registry.
 *
 * The scheduling engine is provider-agnostic: each channel supplies an
 * `enabled(cfg)` predicate and a `deliver(cfg, sections)` function, and the
 * engine handles day/time evaluation and once-per-occurrence dedup. Adding a
 * channel (Slack, Telegram, SMS, …) means registering one more provider here —
 * no scheduler changes.
 */
import cron from 'node-cron';
import config from '../../config.js';
import * as settings from '../../storage/settings.js';
import { buildSections } from './content.js';
import * as email from './email.js';
import * as discord from './discord.js';

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Provider registry — the only channel-specific surface the engine knows about.
const PROVIDERS = {
  email: {
    enabled: (c) => c.enabled && c.host && c.to,
    deliver: (c, sections) => email.send(c, email.render(c, sections, { appUrl: config.appUrl })),
  },
  discord: {
    enabled: (c) => c.enabled && c.webhookUrl,
    deliver: (c, sections) => discord.send(c.webhookUrl, discord.render(sections)),
  },
};

// A schedule is "due" when today is an enabled weekday and the clock has reached
// the configured time. Dedup (lastOccurrence) makes it fire once per day.
function scheduleDue(schedule, now) {
  if (!Array.isArray(schedule.days) || !schedule.days.includes(now.getDay())) return false;
  const [h, m] = String(schedule.time || '08:00').split(':').map((x) => parseInt(x, 10));
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0, 0, 0);
  return now >= scheduled;
}

/**
 * Evaluate every enabled integration and send any that are due and not yet sent
 * for today's occurrence. Safe to call repeatedly (idempotent per day).
 */
export async function evaluateSchedules(now = new Date()) {
  const cfg = await settings.getNotificationConfig();
  const key = dateKey(now);
  const results = [];
  for (const [channel, provider] of Object.entries(PROVIDERS)) {
    const c = cfg[channel];
    if (!c || !provider.enabled(c)) continue;
    if (!scheduleDue(c.schedule, now)) continue;
    if (c.lastOccurrence === key) continue; // already sent this occurrence
    try {
      const { sections } = await buildSections(c.content, now);
      await provider.deliver(c, sections);
      await settings.setLastOccurrence(channel, key);
      results.push({ channel, sent: true });
      console.log(`[notify] sent ${channel} summary (${key})`);
    } catch (e) {
      // Leave lastOccurrence unset so the next tick retries.
      console.error(`[notify] ${channel} summary failed:`, e.message);
      results.push({ channel, sent: false, error: e.message });
    }
  }
  return results;
}

let task = null;
export function startScheduler() {
  if (task) return task;
  // Every 5 minutes — the dedup key guarantees at most one send per day.
  task = cron.schedule('*/5 * * * *', () => evaluateSchedules().catch((e) => console.error('[notify] scheduler', e)));
  console.log('[notify] summary scheduler started (every 5m)');
  return task;
}

// ---- Test / preview helpers (used by the Settings UI) ----------------------

/** Merge a form config with the saved (decrypted) password when the form left it blank. */
async function withSavedPassword(cfg) {
  if (cfg.pass) return cfg;
  const saved = await settings.getNotificationConfig();
  return { ...cfg, pass: saved.email.pass };
}

export async function testEmail(formCfg) {
  const cfg = await withSavedPassword(formCfg || {});
  const v = await email.verify(cfg);
  if (!v.ok) return { ok: false, error: `SMTP validation failed: ${v.error}` };
  try {
    const { sections } = await buildSections(cfg.content || { upcoming: { enabled: true, days: 7 }, dueToday: { enabled: true }, pastDue: { enabled: true } });
    const msg = email.render({ ...cfg, subject: (cfg.subject || 'Daily Task Summary') + ' (test)' }, sections, { appUrl: config.appUrl });
    await email.send(cfg, msg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

export async function testDiscord(formCfg) {
  const url = (formCfg || {}).webhookUrl || '';
  const v = await discord.validate(url);
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const { sections } = await buildSections((formCfg || {}).content || { upcoming: { enabled: true, days: 7 }, dueToday: { enabled: true }, pastDue: { enabled: true } });
    const payload = discord.render(sections);
    payload.content = '🗂️ **KanDeck Task Summary** _(test)_';
    await discord.send(url, payload);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

export { email as emailProvider, discord as discordProvider };
