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
      if (!keepSessions) next.sessionVersion = (c.sessionVersion || 1) + 1;
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

// Clear the account so the app returns to first-run setup. Other config fields
// (e.g. the API key) are preserved. Bumps sessionVersion.
export async function clearCredentials() {
  await updateJson(
    config.configFile,
    (c) => ({ ...(c || {}), username: null, passwordHash: null, createdAt: null, sessionVersion: ((c && c.sessionVersion) || 1) + 1 }),
    {}
  );
  return true;
}

/** Invalidate every existing session (all browsers). */
export async function bumpSessionVersion() {
  let v;
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    v = c.sessionVersion = (c.sessionVersion || 1) + 1;
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

export async function issueToken() {
  return jwt.sign({ sub: 'app-user', sv: await currentSessionVersion() }, config.jwtSecret, {
    expiresIn: config.sessionTtl,
  });
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
  const token = req.cookies?.[COOKIE];
  if (!token) return false;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.sv === (await currentSessionVersion());
  } catch {
    return false;
  }
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
