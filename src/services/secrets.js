/**
 * Secrets-at-rest encryption for sensitive settings (e.g. SMTP password).
 *
 * AES-256-GCM with a key derived from JWT_SECRET via scrypt. Ciphertext is
 * stored as a self-describing string: `enc:v1:<iv>:<tag>:<ciphertext>` (all
 * base64). Anything not carrying the `enc:` prefix is treated as plaintext, so
 * values written before encryption existed still decrypt cleanly.
 *
 * This protects secrets on disk (data/settings.json); it is not a substitute
 * for OS-level file permissions. The key lives with the app, so an attacker
 * with both the data dir and JWT_SECRET can still decrypt — the goal is to
 * avoid storing passwords in the clear.
 */
import crypto from 'node:crypto';
import config from '../config.js';

const PREFIX = 'enc:v1:';
let keyCache = null;

function key() {
  if (!keyCache) {
    // Derive a stable 32-byte key from the app secret. Fixed salt is fine here:
    // the secret is the entropy, and we need determinism across restarts.
    keyCache = crypto.scryptSync(String(config.jwtSecret || 'kandeck'), 'kandeck-secrets-v1', 32);
  }
  return keyCache;
}

/** Encrypt a string. Empty/nullish input returns '' (nothing to protect). */
export function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString('base64')).join(':');
}

/** Decrypt a value produced by encrypt(). Plaintext (no prefix) passes through. */
export function decrypt(value) {
  if (value == null || value === '') return '';
  const s = String(value);
  if (!s.startsWith(PREFIX)) return s; // legacy plaintext
  try {
    const [iv, tag, ct] = s.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return ''; // wrong key / corrupt — fail closed rather than throw
  }
}

/** True if a value is already an encrypted blob. */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
