/**
 * App-level settings (distinct from per-board settings). data/settings.json.
 * Holds:
 *   - theme:      app-wide light/dark/system (moved here from board settings)
 *   - priorities: the category list (id, name, color) shown as card badges
 *   - laneColors: the palette of colors a lane/column can use
 */
import config from '../config.js';
import { readJson, updateJson, ensureDir } from './store.js';
import { slugify } from '../util.js';

const DEFAULT_PRIORITIES = [
  { id: 'none', name: 'None', color: null, order: 0 },
  { id: 'low', name: 'Low', color: '#4dabf7', order: 1 },
  { id: 'medium', name: 'Medium', color: '#f59f00', order: 2 },
  { id: 'high', name: 'High', color: '#f76707', order: 3 },
  { id: 'urgent', name: 'Urgent', color: '#e03131', order: 4 },
];

// Soft pastels — the whole lane takes this as its background, so light tints
// keep white cards and dark text readable. Ordered blue/green/yellow first so a
// new board's To Do / In Progress / Done get a pleasant default trio.
const DEFAULT_LANE_COLORS = [
  '#a5d8ff', '#b2f2bb', '#ffec99', '#ffd8a8',
  '#ffc9c9', '#eebefa', '#c3fae8', '#fcc2d7',
  '#bac8ff', '#e9ecef',
];

const DEFAULTS = {
  theme: 'light-blue', // app-level theme preset id (see public/themes.js)
  priorities: DEFAULT_PRIORITIES,
  laneColors: DEFAULT_LANE_COLORS,
};

export async function init() {
  await ensureDir(config.dataDir);
  const cur = await readJson(config.settingsFile, null);
  if (!cur) await updateJson(config.settingsFile, () => DEFAULTS, DEFAULTS);
}

export async function getSettings() {
  const s = { ...DEFAULTS, ...(await readJson(config.settingsFile, DEFAULTS)) };
  if (!s.priorities || !s.priorities.length) s.priorities = DEFAULT_PRIORITIES;
  if (!s.laneColors || !s.laneColors.length) s.laneColors = DEFAULT_LANE_COLORS;
  if (!s.theme) s.theme = 'light-blue';
  return s;
}

export async function getPriorities() {
  return (await getSettings()).priorities;
}

export async function getLaneColors() {
  return (await getSettings()).laneColors;
}

/** Default color for a given category/priority id (null if none / unknown). */
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
      return { id, name: p.name || id, color: p.color || null, order: i };
    })
    .filter((p) => p.name);
  if (!priorities.some((p) => p.id === 'none'))
    priorities.unshift({ id: 'none', name: 'None', color: null, order: -1 });
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
