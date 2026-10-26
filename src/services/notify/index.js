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
import * as imessage from './imessage.js';
import { dueAlarmCards, markAlarmSent as markCardAlarm } from '../../storage/boards.js';
import { dueAlarmItems, markAlarmSent as markInboxAlarm } from '../../storage/inbox.js';

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
  // Text summary only when the channel's "daily summary" option is on (the
  // channel's main job is alarm reminders — see evaluateAlarms).
  imessage: {
    enabled: (c) => c.enabled && c.summaryEnabled && c.url && c.apiKey && c.to,
    deliver: (c, sections) => imessage.send(c, imessage.renderSummary(sections)),
  },
};

// ---- Alarm reminders (text channel) ------------------------------------------
// Every minute: text any card / Inbox item whose alarm time has arrived. Each
// alarm is sent once (alarmSentFor). Alarms more than ALARM_GRACE_MS overdue —
// e.g. after the server was down — are marked handled instead of texted late.
const ALARM_GRACE_MS = 6 * 60 * 60 * 1000;
const alarmsInFlight = new Set();

export async function evaluateAlarms(now = new Date()) {
  const c = (await settings.getNotificationConfig()).imessage;
  if (!(c.enabled && c.alarms && c.url && c.apiKey && c.to)) return [];
  const jobs = [
    ...(await dueAlarmCards(now)).map(({ board, col, card }) => ({
      key: `c:${card.id}:${card.alarm}`, alarm: card.alarm,
      text: imessage.renderAlarm(card, { boardName: board.name, columnName: col.name }),
      mark: () => markCardAlarm(board.id, card.id, card.alarm),
    })),
    ...(await dueAlarmItems(now)).map((item) => ({
      key: `i:${item.id}:${item.alarm}`, alarm: item.alarm,
      text: imessage.renderAlarm(item, { inbox: true }),
      mark: () => markInboxAlarm(item.id, item.alarm),
    })),
  ];
  const results = [];
  for (const job of jobs) {
    if (alarmsInFlight.has(job.key)) continue;
    alarmsInFlight.add(job.key);
    try {
      if (now.getTime() - Date.parse(job.alarm) > ALARM_GRACE_MS) {
        await job.mark(); // too late to be useful — don't text it
        results.push({ key: job.key, skipped: 'stale' });
        continue;
      }
      await imessage.send(c, job.text);
      await job.mark();
      results.push({ key: job.key, sent: true });
      console.log(`[notify] alarm text sent (${job.key})`);
    } catch (e) {
      // Not marked → retried next minute (until it goes stale).
      console.error(`[notify] alarm text failed (${job.key}):`, e.message);
      results.push({ key: job.key, sent: false, error: e.message });
    } finally {
      alarmsInFlight.delete(job.key);
    }
  }
  return results;
}

// A schedule is "due" when today is an enabled weekday and the clock has reached
// the configured time. Dedup (lastOccurrence) makes it fire once per day.
function scheduleDue(schedule, now) {
  if (!Array.isArray(schedule.days) || !schedule.days.includes(now.getDay())) return false;
  const [h, m] = String(schedule.time || '08:00').split(':').map((x) => parseInt(x, 10));
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0, 0, 0);
  return now >= scheduled;
}

// Channels currently mid-delivery — a belt-and-suspenders guard (alongside the
// optimistic lastOccurrence write) so overlapping ticks never double-send.
const inFlight = new Set();

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
    if (inFlight.has(channel)) continue;    // a prior tick is still delivering
    inFlight.add(channel);
    const prev = c.lastOccurrence;
    try {
      // Claim the occurrence BEFORE the (possibly slow) send, so a second tick
      // firing during delivery sees it as already-sent and skips.
      await settings.setLastOccurrence(channel, key);
      const { sections } = await buildSections(c.content, now);
      await provider.deliver(c, sections);
      results.push({ channel, sent: true });
      console.log(`[notify] sent ${channel} summary (${key})`);
    } catch (e) {
      // Delivery failed — release the claim so the next tick retries today.
      await settings.setLastOccurrence(channel, prev).catch(() => {});
      console.error(`[notify] ${channel} summary failed:`, e.message);
      results.push({ channel, sent: false, error: e.message });
    } finally {
      inFlight.delete(channel);
    }
  }
  return results;
}

let task = null;
export function startScheduler() {
  if (task) return task;
  // Every minute: the per-day dedup key guarantees at most one send per day,
  // and minute granularity means the summary fires at the exact configured
  // time (a 5-min cadence skipped times in the last window before midnight).
  task = cron.schedule('* * * * *', () => {
    evaluateSchedules().catch((e) => console.error('[notify] scheduler', e));
    evaluateAlarms().catch((e) => console.error('[notify] alarms', e));
  });
  console.log('[notify] summary + alarm scheduler started (per-minute)');
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

/** Text channel test: verify the gateway + key, then send a short test text.
 *  A blank API key in the form means "use the saved one". */
export async function testImessage(formCfg = {}) {
  const saved = (await settings.getNotificationConfig()).imessage;
  const cfg = { ...saved, ...formCfg, apiKey: formCfg.apiKey || saved.apiKey };
  cfg.url = String(cfg.url || '').trim().replace(/\/+$/, '');
  const v = await imessage.verify(cfg);
  if (!v.ok) return { ok: false, error: v.error };
  try {
    await imessage.send(cfg, '✅ KanDeck test — text messages are working. You\'ll get alarm reminders here.');
    return { ok: true, version: v.version, messagesRunning: v.messagesRunning };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

export { email as emailProvider, discord as discordProvider, imessage as imessageProvider };
