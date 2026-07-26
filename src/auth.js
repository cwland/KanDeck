/**
 * Authentication & session management (spec 2.2).
 *   - Single global config.json stores the hashed application password.
 *   - Browser sessions use a signed JWT in an httpOnly cookie.
 *   - External API calls use a Bearer token / API key (spec 2.7).
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from './config.js';
import { readJson, updateJson } from './storage/store.js';

const COOKIE = 'kandeck_session';

export async function getAppConfig() {
  return readJson(config.configFile, { passwordHash: null, createdAt: null });
}

export async function isPasswordSet() {
  const c = await getAppConfig();
  return !!(c && c.passwordHash);
}

export async function setPassword(plain) {
  if (!plain || plain.length < 6)
    throw new Error('Password must be at least 6 characters');
  const passwordHash = await bcrypt.hash(plain, 10);
  await updateJson(
    config.configFile,
    (c) => ({ ...(c || {}), passwordHash, createdAt: new Date().toISOString() }),
    {}
  );
  return true;
}

export async function verifyPassword(plain) {
  const c = await getAppConfig();
  if (!c || !c.passwordHash) return false;
  return bcrypt.compare(plain || '', c.passwordHash);
}

export function issueToken() {
  return jwt.sign({ sub: 'app-user' }, config.jwtSecret, {
    expiresIn: config.sessionTtl,
  });
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

function validCookie(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return false;
  try {
    jwt.verify(token, config.jwtSecret);
    return true;
  } catch {
    return false;
  }
}

/** Guard for browser/UI routes — requires a valid session cookie. */
export function requireSession(req, res, next) {
  if (validCookie(req)) return next();
  res.redirect('/login');
}

/** Guard for JSON API routes — accepts session cookie OR Bearer API key. */
export function requireApiAuth(req, res, next) {
  if (validCookie(req)) return next();
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const key = m ? m[1].trim() : req.get('x-api-key');
  if (config.apiKey && key && key === config.apiKey) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

export { COOKIE };
