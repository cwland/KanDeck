/**
 * Release watcher: is a newer KanDeck available?
 *
 * Reads `package.json` (version) and `CHANGELOG.md` (release notes) from the
 * project's main branch on GitHub — the same code the Docker `:latest` image is
 * built from. Checked when someone signs in / opens the app (if the last check
 * is older than 10 minutes) and in the background every 3 hours.
 *
 * Settings (App settings → Updates, stored in config.json under `updates`):
 *   enabled  automatic checks on/off
 *   repo     GitHub owner/repo to watch (default cwland/KanDeck)
 *   branch   branch whose package.json version counts (default main)
 *   token    optional GitHub token — needed only for a private repo/fork.
 *            With a token the GitHub API is used; without one, raw.githubusercontent.com.
 *
 * Env:
 *   UPDATE_CHECK=off            force-disable (no outbound requests at all)
 *   UPDATE_CHECK_URL=<raw base> read package.json + CHANGELOG.md from here instead
 *
 * Only plain GET requests are made; nothing about you or your boards is sent.
 */
import config from '../config.js';
import { readJson, updateJson } from '../storage/store.js';
import { compareVersions, parseChangelog } from './changelog.js';

export const UPDATE_INTERVAL_MS = 3 * 60 * 60 * 1000;
const ON_OPEN_MIN_AGE_MS = 10 * 60 * 1000;
const envDisabled = () => /^(0|false|no|off)$/i.test(String(process.env.UPDATE_CHECK || '').trim());
const DEFAULTS = { enabled: true, repo: 'cwland/KanDeck', branch: 'main', token: '' };
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_RE = /^[\w./-]{1,100}$/;

let opts = { ...DEFAULTS };
let optsLoaded = false;
async function loadOpts() {
  if (optsLoaded) return opts;
  const c = await readJson(config.configFile, {});
  opts = { ...DEFAULTS, ...((c && c.updates) || {}) };
  optsLoaded = true;
  return opts;
}
const enabled = () => !envDisabled() && opts.enabled !== false;

let cache = { at: 0, latest: null, entries: [], error: null };
let inflight = null;

/** Fetch one file from the watched branch. */
async function fetchFile(path) {
  const headers = { 'user-agent': `KanDeck/${config.version} (update check)` };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let url;
  if (process.env.UPDATE_CHECK_URL) {
    url = String(process.env.UPDATE_CHECK_URL).replace(/\/+$/, '') + '/' + path;
  } else if (opts.token) {
    url = `https://api.github.com/repos/${opts.repo}/contents/${path}?ref=${encodeURIComponent(opts.branch)}`;
    headers.accept = 'application/vnd.github.raw';
    headers['x-github-api-version'] = '2022-11-28';
  } else {
    url = `https://raw.githubusercontent.com/${opts.repo}/${opts.branch}/${path}`;
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers });
  if (!r.ok) {
    if ((r.status === 404 || r.status === 403) && !opts.token) throw new Error(`Not found (HTTP ${r.status}) — check the repo/branch, or add a GitHub token if the repo is private`);
    if (r.status === 401) throw new Error('GitHub rejected the token (HTTP 401)');
    if (r.status === 404) throw new Error('Not found (HTTP 404) — check the repo/branch and that the token can read it');
    throw new Error(`HTTP ${r.status}`);
  }
  return r.text();
}

async function runCheck() {
  try {
    const pkg = JSON.parse(await fetchFile('package.json'));
    const latest = String(pkg.version || '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('No version found');
    let entries = [];
    if (compareVersions(latest, config.version) > 0) {
      try {
        entries = parseChangelog(await fetchFile('CHANGELOG.md'))
          .filter((e) => compareVersions(e.version, config.version) > 0 && compareVersions(e.version, latest) <= 0);
      } catch (_) { /* notes are optional */ }
    }
    cache = { at: Date.now(), latest, entries, error: null };
  } catch (err) {
    cache = { ...cache, at: Date.now(), error: err.message || String(err) };
  }
  return cache;
}

/** Check if the cached result is older than `maxAgeMs` (or always with force). */
export async function checkForUpdate({ maxAgeMs = UPDATE_INTERVAL_MS, force = false } = {}) {
  await loadOpts();
  if (!enabled()) return cache;
  if (!force && cache.at && Date.now() - cache.at < maxAgeMs) return cache;
  if (!inflight) inflight = runCheck().finally(() => { inflight = null; });
  return inflight;
}

/** What the browser needs: current vs latest, notes, and whether you dismissed it. */
export async function updateStatus({ onOpen = false, force = false } = {}) {
  const c = await checkForUpdate({ maxAgeMs: onOpen ? ON_OPEN_MIN_AGE_MS : UPDATE_INTERVAL_MS, force });
  const cfg = await readJson(config.configFile, {});
  const available = enabled() && !!(c.latest && compareVersions(c.latest, config.version) > 0);
  return {
    enabled: enabled(),
    current: config.version,
    latest: c.latest,
    available,
    dismissed: available && (cfg && cfg.updateDismissed) === c.latest,
    checkedAt: c.at ? new Date(c.at).toISOString() : null,
    error: c.error,
    entries: available ? c.entries : [],
  };
}

/** Hide the bar until a version newer than `version` comes out. */
export async function dismissUpdate(version) {
  await updateJson(config.configFile, (c) => ({ ...(c || {}), updateDismissed: String(version || '') }), {});
}

/** Settings for App settings → Updates (the token itself is never sent back). */
export async function getUpdateSettings() {
  await loadOpts();
  return {
    enabled: opts.enabled !== false, envDisabled: envDisabled(),
    repo: opts.repo, branch: opts.branch, hasToken: !!opts.token,
    defaults: { repo: DEFAULTS.repo, branch: DEFAULTS.branch },
  };
}

/** Save settings. `token`: non-empty replaces it; `clearToken: true` removes it; omitted keeps it. */
export async function saveUpdateSettings(body = {}) {
  await loadOpts();
  const next = { ...opts };
  if ('enabled' in body) next.enabled = !!body.enabled;
  if ('repo' in body) {
    const repo = String(body.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '') || DEFAULTS.repo;
    if (!REPO_RE.test(repo)) { const e = new Error('Enter the repo as owner, a slash, then the repo name (like cwland and KanDeck)'); e.status = 400; throw e; }
    next.repo = repo;
  }
  if ('branch' in body) {
    const branch = String(body.branch || '').trim() || DEFAULTS.branch;
    if (!BRANCH_RE.test(branch)) { const e = new Error('Invalid branch name'); e.status = 400; throw e; }
    next.branch = branch;
  }
  if (body.clearToken) next.token = '';
  else if (typeof body.token === 'string' && body.token.trim()) next.token = body.token.trim();
  await updateJson(config.configFile, (c) => ({ ...(c || {}), updates: next }), {});
  const changedSource = next.repo !== opts.repo || next.branch !== opts.branch || next.token !== opts.token;
  opts = next;
  if (changedSource) cache = { at: 0, latest: null, entries: [], error: null };
  return getUpdateSettings();
}

/** Background check every 3 hours (first one shortly after start). Respects the on/off setting each time. */
export function startUpdateWatcher() {
  if (envDisabled()) return;
  setTimeout(() => checkForUpdate({ force: true }).catch(() => {}), 15 * 1000).unref?.();
  setInterval(() => checkForUpdate({ force: true }).catch(() => {}), UPDATE_INTERVAL_MS).unref?.();
}
