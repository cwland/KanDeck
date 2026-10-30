/**
 * Authentication & session management.
 *   - Single account: a username + bcrypt password hash in data/config.json.
 *     (Installs from before 2.0 have only a password; they sign in with it once
 *     and are then asked to choose a username — see auth-routes.js.)
 *   - Browser sessions use a signed JWT in an httpOnly cookie. Each token
 *     carries the account's `sessionVersion`; bumping it (logout-everywhere,
 *     password change, reset) invalidates every existing session.
 *   - External API calls use a Bearer token / API key.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from './config.js';
import { readJson, updateJson } from './storage/store.js';

const COOKIE = 'kandeck_session';
export const MIN_PASSWORD = 12;
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,32}$/;

export async function getAppConfig() {
  return readJson(config.configFile, { passwordHash: null, createdAt: null });
}

export async function isPasswordSet() {
  const c = await getAppConfig();
  return !!(c && c.passwordHash);
}

export async function getUsername() {
  const c = await getAppConfig();
  return (c && c.username) || null;
}

export function validateUsername(u) {
  const v = String(u || '').trim();
  if (!USERNAME_RE.test(v)) throw new Error('Username must be 3–32 characters: letters, numbers, . _ - @');
  return v;
}

export function validateNewPassword(p) {
  if (!p || String(p).length < MIN_PASSWORD)
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  return String(p);
}

/** Set credentials. Pass `username` and/or `password`; omitted ones are kept.
 *  Any change bumps sessionVersion (logs out other sessions) unless keepSessions. */
export async function setCredentials({ username, password } = {}, { keepSessions = false } = {}) {
  const patch = {};
  if (username !== undefined) patch.username = validateUsername(username);
  if (password !== undefined) {
    patch.passwordHash = await bcrypt.hash(validateNewPassword(password), 10);
    patch.passwordChangedAt = new Date().toISOString();
  }
  await updateJson(
    config.configFile,
    (c) => {
      c = { ...(c || {}) };
      const next = { ...c, ...patch };
      if (!c.createdAt && next.passwordHash) next.createdAt = new Date().toISOString();
      if (!keepSessions) { next.sessionVersion = (c.sessionVersion || 1) + 1; next.sessions = []; }
      return next;
    },
    {}
  );
  return true;
}

export async function verifyPassword(plain) {
  const c = await getAppConfig();
  if (!c || !c.passwordHash) return false;
  return bcrypt.compare(plain || '', c.passwordHash);
}

/** Check username + password. Usernames compare case-insensitively. A legacy
 *  install (no username yet) accepts any username so the owner can get in and
 *  pick one. Always runs bcrypt so timing doesn't reveal valid usernames. */
export async function verifyLogin(username, password) {
  const c = await getAppConfig();
  if (!c || !c.passwordHash) return { ok: false };
  const pwOk = await bcrypt.compare(password || '', c.passwordHash);
  if (!c.username) return { ok: pwOk, needsUsername: pwOk };
  const userOk = String(username || '').trim().toLowerCase() === String(c.username).toLowerCase();
  return { ok: pwOk && userOk };
}

// Clear the account so the app returns to first-run setup (passkeys too).
// Other config fields (e.g. the API key) are preserved. Bumps sessionVersion.
export async function clearCredentials() {
  await updateJson(
    config.configFile,
    (c) => ({ ...(c || {}), username: null, passwordHash: null, createdAt: null, passkeys: [], sessions: [], sessionVersion: ((c && c.sessionVersion) || 1) + 1 }),
    {}
  );
  return true;
}

// ---- Passkeys (WebAuthn) — stored in config.json --------------------------------
// Each: { id, publicKey (base64url COSE key), counter, transports, rpID,
//         name, createdAt, lastUsedAt, backedUp }

export async function getPasskeys() {
  const c = await getAppConfig();
  return Array.isArray(c && c.passkeys) ? c.passkeys : [];
}

/** Atomically edit the passkey list: fn(list) returns the new list. */
export async function updatePasskeys(fn) {
  let out;
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    out = fn(Array.isArray(c.passkeys) ? [...c.passkeys] : []);
    c.passkeys = out;
    return c;
  }, {});
  return out;
}

/** Stable, random WebAuthn user handle for the single account (created once). */
export async function getWebauthnUserId() {
  let id = (await getAppConfig()).webauthnUserId;
  if (id) return id;
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    if (!c.webauthnUserId) c.webauthnUserId = crypto.randomBytes(16).toString('base64url');
    id = c.webauthnUserId;
    return c;
  }, {});
  return id;
}

/** Invalidate every existing session (all browsers). */
export async function bumpSessionVersion() {
  let v;
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    v = c.sessionVersion = (c.sessionVersion || 1) + 1;
    c.sessions = [];
    return c;
  }, {});
  return v;
}

async function currentSessionVersion() {
  const c = await getAppConfig();
  return (c && c.sessionVersion) || 1;
}

// ---- API key (for external apps: n8n, scripts, integrations) ---------------
// Stored in config.json alongside the account so it's managed from the app
// (App Settings → API). The legacy env var API_KEY still works too.

export async function getApiKey() {
  const c = await getAppConfig();
  return (c && c.apiKey) || '';
}

export async function setApiKey(key) {
  await updateJson(config.configFile, (c) => ({ ...(c || {}), apiKey: key || null }), {});
  return key || '';
}

/** Generate a fresh random API key (prefixed so it's recognizable in logs). */
export function generateApiKeyValue() {
  return 'kd_' + crypto.randomBytes(24).toString('hex');
}

// ---- Sessions ---------------------------------------------------------------

// ---- Session list -------------------------------------------------------------
// Every sign-in gets an id (`sid` in the cookie) and a record in config.json:
// { id, createdAt, lastSeenAt, expiresAt, ip, ua, method }. A cookie whose sid
// is no longer listed is rejected, so one browser can be signed out on its own.
const MAX_SESSIONS = 50;

function clientInfo(req) {
  return {
    ip: String((req && req.ip) || (req && req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '').slice(0, 64),
    ua: String((req && req.get && req.get('user-agent')) || '').slice(0, 300),
  };
}

/** Sign in this browser: new session record + signed token. method = how they signed in. */
export async function issueToken(req, method = 'password') {
  const sv = await currentSessionVersion();
  const sid = crypto.randomBytes(12).toString('base64url');
  const token = jwt.sign({ sub: 'app-user', sv, sid }, config.jwtSecret, { expiresIn: config.sessionTtl });
  const exp = (jwt.decode(token) || {}).exp;
  const now = new Date().toISOString();
  const rec = { id: sid, createdAt: now, lastSeenAt: now, expiresAt: exp ? new Date(exp * 1000).toISOString() : null, method, ...clientInfo(req) };
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    const live = (Array.isArray(c.sessions) ? c.sessions : []).filter((x) => !x.expiresAt || new Date(x.expiresAt) > new Date());
    c.sessions = [...live, rec].slice(-MAX_SESSIONS);
    return c;
  }, {});
  return token;
}

export async function listSessions() {
  const c = await getAppConfig();
  return (Array.isArray(c.sessions) ? c.sessions : []).filter((x) => !x.expiresAt || new Date(x.expiresAt) > new Date());
}

/** Remove sessions: by id, or every one except `keepId`. Returns how many were removed. */
export async function revokeSessions({ id, exceptId } = {}) {
  let removed = 0;
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    const list = Array.isArray(c.sessions) ? c.sessions : [];
    const next = list.filter((x) => (id ? x.id !== id : x.id === exceptId));
    removed = list.length - next.length;
    c.sessions = next;
    return c;
  }, {});
  return removed;
}

/** The decoded session cookie (or null). */
export function sessionPayload(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try { return jwt.verify(token, config.jwtSecret); } catch { return null; }
}

// "Last active" is written at most every 5 minutes per session.
const lastTouch = new Map();
async function touchSession(sid, req) {
  const now = Date.now();
  if (now - (lastTouch.get(sid) || 0) < 5 * 60 * 1000) return;
  lastTouch.set(sid, now);
  if (lastTouch.size > 500) lastTouch.clear();
  const info = clientInfo(req);
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    c.sessions = (Array.isArray(c.sessions) ? c.sessions : []).map((x) => (x.id === sid ? { ...x, lastSeenAt: new Date(now).toISOString(), ip: info.ip || x.ip } : x));
    return c;
  }, {}).catch(() => {});
}

/** Cookies from before the session list existed (no sid): swap them for a
 *  listed session the first time they're used, so nobody is signed out. */
export async function upgradeLegacySession(req, res, next) {
  try {
    const p = sessionPayload(req);
    if (p && !p.sid && p.sv === (await currentSessionVersion())) setSessionCookie(res, await issueToken(req, 'password'));
  } catch (_) {}
  next();
}

export function setSessionCookie(res, token) {
  // Cookie lifetime matches the token's own expiry.
  const exp = (jwt.decode(token) || {}).exp;
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/',
    maxAge: exp ? Math.max(0, exp * 1000 - Date.now()) : undefined,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** True if the request carries a valid, current (not revoked) session. */
export async function validCookie(req) {
  const payload = sessionPayload(req);
  if (!payload) return false;
  const c = await getAppConfig();
  if (payload.sv !== ((c && c.sessionVersion) || 1)) return false;
  if (!payload.sid) return true; // pre-3.1 cookie; upgraded by upgradeLegacySession
  const sess = (Array.isArray(c.sessions) ? c.sessions : []).find((x) => x.id === payload.sid);
  if (!sess) return false; // signed out from the Sessions list
  touchSession(payload.sid, req);
  return true;
}

/** Guard for browser/UI routes — requires a valid session cookie. A logged-in
 *  owner of a pre-2.0 install without a username is sent to choose one. */
export async function requireSession(req, res, next) {
  try {
    if (await validCookie(req)) {
      if (!(await getUsername())) return res.redirect('/login?step=username');
      return next();
    }
  } catch {}
  res.redirect('/login');
}

/** Guard for account-management API routes: session cookie only (an API key
 *  can't change the login). */
export async function requireSessionApi(req, res, next) {
  try { if (await validCookie(req)) return next(); } catch {}
  res.status(401).json({ error: 'Unauthorized' });
}

// Constant-time string compare (SHA-256 both sides so lengths always match and
// timing doesn't leak the key or its length).
function safeEqual(a, b) {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Guard for JSON API routes — accepts session cookie OR API key.
 *  Key may arrive as `Authorization: Bearer <key>` or `X-API-Key: <key>`, and
 *  is matched against the env API_KEY and/or the key stored in config.json. */
export async function requireApiAuth(req, res, next) {
  try {
    if (await validCookie(req)) return next();
    const header = req.get('authorization') || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    const key = m ? m[1].trim() : req.get('x-api-key');
    if (key) {
      if (config.apiKey && safeEqual(key, config.apiKey)) return next();
      const stored = await getApiKey();
      if (stored && safeEqual(key, stored)) return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export { COOKIE };
