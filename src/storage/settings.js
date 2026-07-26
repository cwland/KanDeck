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
};

const DEFAULTS = {
  theme: 'light-blue',
  priorities: DEFAULT_PRIORITIES,
  laneColors: DEFAULT_LANE_COLORS,
  badges: DEFAULT_BADGES,
};

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
  };
  return s;
}

export async function getPriorities() {
  return (await getSettings()).priorities;
}

export async function getLaneColors() {
  return (await getSettings()).laneColors;
}

/** Default background color for a given category/priority id. */
export async function priorityColor(id) {
  if (!id || id === 'none') return null;
  const p = (await getPriorities()).find((x) => x.id === id);
  return p ? p.color : null;
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
        color: p.color || null,
        textColor: p.textColor || null,
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
    next.laneColors = (Array.isArray(patch.laneColors) ? patch.laneColors : [])
      .filter((c) => typeof c === 'string' && c);
  if (patch.badges !== undefined) {
    const b = patch.badges || {};
    next.badges = {
      due: { color: (b.due || {}).color || DEFAULT_BADGES.due.color, textColor: (b.due || {}).textColor || DEFAULT_BADGES.due.textColor },
      tag: { color: (b.tag || {}).color || DEFAULT_BADGES.tag.color, textColor: (b.tag || {}).textColor || DEFAULT_BADGES.tag.textColor },
    };
  }
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
