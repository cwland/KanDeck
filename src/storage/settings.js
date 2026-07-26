/**
 * App-level settings (distinct from per-board settings). data/settings.json.
 * Holds:
 *   - theme:      app-wide theme preset id (see public/themes.js)
 *   - priorities: the category list — each has a background `color` and a
 *     `textColor`, so badges stay high-contrast and readable
 *   - laneColors: the palette of colors a lane/column can use
 */
import config from '../config.js';
import { readJson, updateJson, writeJsonAtomic, ensureDir } from './store.js';
import { slugify } from '../util.js';
import { encrypt, decrypt } from '../services/secrets.js';

// Pastel backgrounds + explicit dark ink → readable, high-contrast by default.
const DEFAULT_PRIORITIES = [
  { id: 'none', name: 'None', color: null, textColor: null, order: 0 },
  { id: 'low', name: 'Low', color: '#a5d8ff', textColor: '#0b3d66', order: 1 },
  { id: 'medium', name: 'Medium', color: '#ffec99', textColor: '#664d03', order: 2 },
  { id: 'high', name: 'High', color: '#ffd8a8', textColor: '#8a4b08', order: 3 },
  { id: 'urgent', name: 'Urgent', color: '#ffc9c9', textColor: '#9a1c1c', order: 4 },
];

const DEFAULT_LANE_COLORS = [
  '#a5d8ff', '#b2f2bb', '#ffec99', '#ffd8a8',
  '#ffc9c9', '#eebefa', '#c3fae8', '#fcc2d7',
  '#bac8ff', '#e9ecef',
];

// Pastel, readable defaults for the non-category badges shown on cards.
const DEFAULT_BADGES = {
  due: { color: '#d0ebff', textColor: '#1864ab' }, // pastel blue / dark blue
  tag: { color: '#e5dbff', textColor: '#5f3dc4' }, // pastel lavender / deep purple
  source: { color: '#c3fae8', textColor: '#0b7285' }, // pastel teal / dark teal
};

// Shared notification shapes (same content + schedule model across channels,
// so new providers reuse them without touching the scheduler).
const DEFAULT_CONTENT = {
  upcoming: { enabled: true, days: 7 }, // tasks due within N days (open)
  dueToday: { enabled: true },
  pastDue: { enabled: true },
};
const DEFAULT_SCHEDULE = {
  time: '08:00',        // HH:MM, server-local
  days: [1, 2, 3, 4, 5], // 0=Sun … 6=Sat
};
const DEFAULT_NOTIFICATIONS = {
  email: {
    enabled: false,
    host: '', port: 587, user: '', pass: '', // pass stored encrypted at rest
    encryption: 'tls', // tls | ssl | none
    from: '', to: '',
    subject: 'Daily Task Summary',
    content: DEFAULT_CONTENT,
    schedule: DEFAULT_SCHEDULE,
    lastOccurrence: null, // dedup key (YYYY-MM-DD) of last successful send
  },
  discord: {
    enabled: false,
    webhookUrl: '',
    content: DEFAULT_CONTENT,
    schedule: DEFAULT_SCHEDULE,
    lastOccurrence: null,
  },
};
const DEFAULT_BACKUP = {
  autoEnabled: false,
  frequency: 'weekly', // daily | weekly | monthly
  retention: 12,       // how many backups to keep
};

const DEFAULTS = {
  theme: 'light-blue',
  priorities: DEFAULT_PRIORITIES,
  laneColors: DEFAULT_LANE_COLORS,
  badges: DEFAULT_BADGES,
  // AI chat (webhook-based, same shape as Auto Dashboard AI).
  aiChatEnabled: false,
  aiChatWebhookUrl: '',
  aiChatToken: '',
  aiChatHistoryLength: 10,
  aiChatTimeout: 60,
  aiChatTitle: 'AI Assistant',
  notifications: DEFAULT_NOTIFICATIONS,
  backup: DEFAULT_BACKUP,
};

// Deep-fill notification config so partial/absent settings still render.
function fillContent(c) {
  c = c || {};
  return {
    upcoming: { enabled: (c.upcoming || {}).enabled !== false, days: Math.max(1, Math.min(30, parseInt((c.upcoming || {}).days, 10) || 7)) },
    dueToday: { enabled: (c.dueToday || {}).enabled !== false },
    pastDue: { enabled: (c.pastDue || {}).enabled !== false },
  };
}
function fillSchedule(s) {
  s = s || {};
  const days = Array.isArray(s.days) ? s.days.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6) : DEFAULT_SCHEDULE.days;
  return { time: /^\d{1,2}:\d{2}$/.test(s.time || '') ? s.time : DEFAULT_SCHEDULE.time, days };
}
function fillNotifications(n) {
  n = n || {};
  const e = n.email || {}, d = n.discord || {};
  return {
    email: {
      enabled: !!e.enabled,
      host: e.host || '', port: parseInt(e.port, 10) || 587,
      user: e.user || '', pass: e.pass || '',
      encryption: ['tls', 'ssl', 'none'].includes(e.encryption) ? e.encryption : 'tls',
      from: e.from || '', to: e.to || '',
      subject: e.subject || 'Daily Task Summary',
      content: fillContent(e.content), schedule: fillSchedule(e.schedule),
      lastOccurrence: e.lastOccurrence || null,
    },
    discord: {
      enabled: !!d.enabled,
      webhookUrl: d.webhookUrl || '',
      content: fillContent(d.content), schedule: fillSchedule(d.schedule),
      lastOccurrence: d.lastOccurrence || null,
    },
  };
}
function fillBackup(b) {
  b = b || {};
  return {
    autoEnabled: !!b.autoEnabled,
    frequency: ['daily', 'weekly', 'monthly'].includes(b.frequency) ? b.frequency : 'weekly',
    retention: Math.max(1, Math.min(500, parseInt(b.retention, 10) || 12)),
  };
}

// Accept only well-formed hex colors before persisting them (they get dropped
// into style="..." and email HTML, so reject anything that could break out).
const hexOk = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c);
const cleanHex = (c) => (hexOk(c) ? c : null);

// Pick readable ink (dark on light bg, white on dark bg) for a custom color.
function readableText(hex) {
  if (!hex) return null;
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16) / 255;
  const g = parseInt(c.substr(2, 2), 16) / 255;
  const b = parseInt(c.substr(4, 2), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? '#111827' : '#ffffff';
}

// Legacy vibrant category defaults → new pastels (for existing installs).
const OLD_CATEGORY_COLORS = { low: '#4dabf7', medium: '#f59f00', high: '#f76707', urgent: '#e03131' };
const NEW_CATEGORY = {
  low: { color: '#a5d8ff', textColor: '#0b3d66' },
  medium: { color: '#ffec99', textColor: '#664d03' },
  high: { color: '#ffd8a8', textColor: '#8a4b08' },
  urgent: { color: '#ffc9c9', textColor: '#9a1c1c' },
};

async function migrateCategories() {
  const s = await readJson(config.settingsFile, null);
  if (!s || !Array.isArray(s.priorities)) return;
  let changed = false;
  for (const p of s.priorities) {
    if (p.textColor === undefined) {
      if (p.id === 'none') p.textColor = null;
      else if (OLD_CATEGORY_COLORS[p.id] && (p.color || '').toLowerCase() === OLD_CATEGORY_COLORS[p.id]) {
        p.color = NEW_CATEGORY[p.id].color;
        p.textColor = NEW_CATEGORY[p.id].textColor;
      } else {
        p.textColor = readableText(p.color);
      }
      changed = true;
    }
  }
  if (changed) await writeJsonAtomic(config.settingsFile, s);
}

export async function init() {
  await ensureDir(config.dataDir);
  const cur = await readJson(config.settingsFile, null);
  if (!cur) { await updateJson(config.settingsFile, () => DEFAULTS, DEFAULTS); return; }
  await migrateCategories();
}

export async function getSettings() {
  const s = { ...DEFAULTS, ...(await readJson(config.settingsFile, DEFAULTS)) };
  if (!s.priorities || !s.priorities.length) s.priorities = DEFAULT_PRIORITIES;
  if (!s.laneColors || !s.laneColors.length) s.laneColors = DEFAULT_LANE_COLORS;
  if (!s.theme) s.theme = 'light-blue';
  // Deep-fill badge colors so partial/absent config still renders readable.
  s.badges = {
    due: { ...DEFAULT_BADGES.due, ...((s.badges || {}).due || {}) },
    tag: { ...DEFAULT_BADGES.tag, ...((s.badges || {}).tag || {}) },
    source: { ...DEFAULT_BADGES.source, ...((s.badges || {}).source || {}) },
  };
  // Notifications + backup, with the SMTP password masked (never leave the
  // server via the general settings endpoint — internal senders use
  // getNotificationConfig()).
  s.notifications = fillNotifications(s.notifications);
  s.notifications.email = { ...s.notifications.email, pass: '', passwordSet: !!s.notifications.email.pass };
  s.backup = fillBackup(s.backup);
  // AI chat token is stored encrypted; the widget needs the real value client-side.
  if (s.aiChatToken) s.aiChatToken = decrypt(s.aiChatToken);
  return s;
}

/** Full notification config for internal use (SMTP password DECRYPTED). */
export async function getNotificationConfig() {
  const raw = await readJson(config.settingsFile, DEFAULTS);
  const n = fillNotifications(raw.notifications);
  n.email.pass = decrypt(n.email.pass);
  return n;
}

/** UI-facing notification config: SMTP password masked, `passwordSet` flag added. */
export async function getNotificationConfigMasked() {
  const n = fillNotifications((await readJson(config.settingsFile, DEFAULTS)).notifications);
  n.email = { ...n.email, pass: '', passwordSet: !!n.email.pass };
  return n;
}

function mergeEmail(cur, patch = {}) {
  const next = { ...cur };
  for (const k of ['host', 'user', 'from', 'to', 'subject', 'encryption']) if (patch[k] !== undefined) next[k] = String(patch[k]);
  if (patch.port !== undefined) next.port = parseInt(patch.port, 10) || 587;
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.content !== undefined) next.content = fillContent(patch.content);
  if (patch.schedule !== undefined) next.schedule = fillSchedule(patch.schedule);
  if (patch.lastOccurrence !== undefined) next.lastOccurrence = patch.lastOccurrence;
  // Password: only replace when a new non-empty value is supplied; blank = keep.
  if (typeof patch.pass === 'string' && patch.pass !== '') next.pass = encrypt(patch.pass);
  return next;
}

function mergeDiscord(cur, patch = {}) {
  const next = { ...cur };
  if (patch.webhookUrl !== undefined) next.webhookUrl = String(patch.webhookUrl);
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.content !== undefined) next.content = fillContent(patch.content);
  if (patch.schedule !== undefined) next.schedule = fillSchedule(patch.schedule);
  if (patch.lastOccurrence !== undefined) next.lastOccurrence = patch.lastOccurrence;
  return next;
}

export async function updateEmailConfig(patch = {}) {
  const saved = await updateJson(config.settingsFile, (s) => {
    s = { ...DEFAULTS, ...(s || {}) };
    const n = fillNotifications(s.notifications);
    n.email = mergeEmail(n.email, patch);
    s.notifications = n;
    return s;
  }, DEFAULTS);
  return fillNotifications(saved.notifications).email;
}

export async function updateDiscordConfig(patch = {}) {
  const saved = await updateJson(config.settingsFile, (s) => {
    s = { ...DEFAULTS, ...(s || {}) };
    const n = fillNotifications(s.notifications);
    n.discord = mergeDiscord(n.discord, patch);
    s.notifications = n;
    return s;
  }, DEFAULTS);
  return fillNotifications(saved.notifications).discord;
}

/** Record the last successful send occurrence key (dedup) for a channel. */
export async function setLastOccurrence(channel, key) {
  await updateJson(config.settingsFile, (s) => {
    s = { ...DEFAULTS, ...(s || {}) };
    const n = fillNotifications(s.notifications);
    if (n[channel]) n[channel].lastOccurrence = key;
    s.notifications = n;
    return s;
  }, DEFAULTS);
}

export async function getBackupConfig() {
  return fillBackup((await readJson(config.settingsFile, DEFAULTS)).backup);
}

export async function updateBackupConfig(patch = {}) {
  const saved = await updateJson(config.settingsFile, (s) => {
    s = { ...DEFAULTS, ...(s || {}) };
    const b = fillBackup(s.backup);
    if (patch.autoEnabled !== undefined) b.autoEnabled = !!patch.autoEnabled;
    if (patch.frequency !== undefined && ['daily', 'weekly', 'monthly'].includes(patch.frequency)) b.frequency = patch.frequency;
    if (patch.retention !== undefined) b.retention = Math.max(1, Math.min(500, parseInt(patch.retention, 10) || 12));
    s.backup = b;
    return s;
  }, DEFAULTS);
  return fillBackup(saved.backup);
}

export async function getPriorities() {
  return (await getSettings()).priorities;
}

export async function getLaneColors() {
  return (await getSettings()).laneColors;
}

function normalisePriorities(list) {
  const seen = new Set();
  let priorities = (Array.isArray(list) ? list : [])
    .map((p, i) => {
      let id = p.id || slugify(p.name || 'category');
      while (seen.has(id)) id = id + '_';
      seen.add(id);
      return {
        id,
        name: p.name || id,
        color: cleanHex(p.color),
        textColor: cleanHex(p.textColor),
        order: i,
      };
    })
    .filter((p) => p.name);
  if (!priorities.some((p) => p.id === 'none'))
    priorities.unshift({ id: 'none', name: 'None', color: null, textColor: null, order: -1 });
  priorities.forEach((p, i) => (p.order = i));
  return priorities;
}

/** Merge a partial settings patch (theme, priorities, laneColors). */
export async function updateSettings(patch = {}) {
  const next = {};
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.priorities !== undefined) next.priorities = normalisePriorities(patch.priorities);
  if (patch.laneColors !== undefined)
    next.laneColors = (Array.isArray(patch.laneColors) ? patch.laneColors : []).filter(hexOk);
  if (patch.badges !== undefined) {
    const b = patch.badges || {};
    const badge = (k) => ({
      color: cleanHex((b[k] || {}).color) || DEFAULT_BADGES[k].color,
      textColor: cleanHex((b[k] || {}).textColor) || DEFAULT_BADGES[k].textColor,
    });
    next.badges = { due: badge('due'), tag: badge('tag'), source: badge('source') };
  }
  // AI chat (webhook-based, mirrors Auto Dashboard AI settings).
  for (const k of ['aiChatWebhookUrl', 'aiChatTitle'])
    if (patch[k] !== undefined) next[k] = String(patch[k]);
  // The AI chat bearer token is encrypted at rest (decrypted in getSettings for
  // the client, which needs it to call the webhook directly).
  if (patch.aiChatToken !== undefined) next.aiChatToken = encrypt(String(patch.aiChatToken));
  if (patch.aiChatEnabled !== undefined) next.aiChatEnabled = !!patch.aiChatEnabled;
  if (patch.aiChatHistoryLength !== undefined)
    next.aiChatHistoryLength = Math.max(1, Math.min(100, parseInt(patch.aiChatHistoryLength, 10) || 10));
  if (patch.aiChatTimeout !== undefined)
    next.aiChatTimeout = Math.max(5, Math.min(300, parseInt(patch.aiChatTimeout, 10) || 60));
  return updateJson(
    config.settingsFile,
    (s) => ({ ...DEFAULTS, ...(s || {}), ...next }),
    DEFAULTS
  );
}

export async function updatePriorities(list) {
  return (await updateSettings({ priorities: list })).priorities;
}

export { DEFAULT_PRIORITIES, DEFAULT_LANE_COLORS };
