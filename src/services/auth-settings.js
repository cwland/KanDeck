/**
 * Sign-in methods ("auth mode"), OAuth / OIDC provider settings and passkey
 * relying-party options — stored as `auth` in data/config.json next to the
 * account. Field ↔ spec mapping:
 *   mode            ← auth_mode  (PASSWORDS_AND_OAUTH | PASSKEYS_AND_OAUTH |
 *                                 OAUTH_ONLY | PASSKEYS_ONLY | ALL_ENABLED)
 *   oauth.enabled   ← oauth_enabled
 *   oauth.providerName ← oauth_provider_name ("Sign in with <name>")
 *   passkeysEnabled ← passkeys_enabled
 *   (rp_id is always the address in use — localhost or the current hostname —
 *    and rp_name is "KanDeck"; see services/passkeys.js.)
 * The OAuth client secret is encrypted at rest (services/secrets.js).
 */
import config from '../config.js';
import { readJson, updateJson } from '../storage/store.js';

export const AUTH_MODES = ['ALL_ENABLED', 'PASSWORDS_AND_OAUTH', 'PASSKEYS_AND_OAUTH', 'PASSKEYS_ONLY', 'OAUTH_ONLY'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);

export function normalize(a) {
  a = a && typeof a === 'object' ? a : {};
  const o = a.oauth && typeof a.oauth === 'object' ? a.oauth : {};
  return {
    mode: AUTH_MODES.includes(a.mode) ? a.mode : 'ALL_ENABLED',
    passkeysEnabled: a.passkeysEnabled !== false,
    oauth: {
      enabled: !!o.enabled,
      providerName: str(o.providerName, 40) || 'OAuth',
      issuer: str(o.issuer, 500),
      clientId: str(o.clientId, 300),
      clientSecret: typeof o.clientSecret === 'string' ? o.clientSecret : '',
      scopes: str(o.scopes, 300) || 'openid email profile',
      authorizationEndpoint: str(o.authorizationEndpoint, 500),
      tokenEndpoint: str(o.tokenEndpoint, 500),
      userinfoEndpoint: str(o.userinfoEndpoint, 500),
      jwksUri: str(o.jwksUri, 500),
      allowedEmails: (Array.isArray(o.allowedEmails) ? o.allowedEmails : [])
        .map((e) => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 20),
      linkedSub: str(o.linkedSub, 300),
      linkedIssuer: str(o.linkedIssuer, 500),
      linkedEmail: str(o.linkedEmail, 300),
      linkedName: str(o.linkedName, 200),
      linkedAt: o.linkedAt || null,
      lastLoginAt: o.lastLoginAt || null,
    },
  };
}

export async function getAuthSettings() {
  const c = await readJson(config.configFile, {});
  return normalize(c && c.auth);
}

/** Atomically edit: fn(current) returns the new settings. */
export async function saveAuthSettings(fn) {
  let out;
  await updateJson(config.configFile, (c) => {
    c = { ...(c || {}) };
    out = normalize(fn(normalize(c.auth)));
    c.auth = out;
    return c;
  }, {});
  return out;
}

/** What the mode itself permits. */
export function modeAllows(mode) {
  return {
    password: mode === 'ALL_ENABLED' || mode === 'PASSWORDS_AND_OAUTH',
    passkey: mode === 'ALL_ENABLED' || mode === 'PASSKEYS_AND_OAUTH' || mode === 'PASSKEYS_ONLY',
    oauth: mode !== 'PASSKEYS_ONLY',
  };
}

/** The provider identity a link belongs to. */
export const issuerKey = (o) => String(o.issuer || o.authorizationEndpoint || '').replace(/\/+$/, '');
export const oauthConfigured = (o) => !!(o.clientId && (o.issuer || (o.authorizationEndpoint && o.tokenEndpoint)));
export const oauthLinked = (o) => !!(o.linkedSub && o.linkedIssuer && o.linkedIssuer === issuerKey(o));

/** Methods actually offered on the sign-in page. */
export function effective(a) {
  const m = modeAllows(a.mode);
  return {
    password: m.password,
    passkey: m.passkey && a.passkeysEnabled,
    oauth: m.oauth && a.oauth.enabled && oauthConfigured(a.oauth),
  };
}

/** Does this OAuth identity belong to the KanDeck account? */
export function oauthMatches(o, id) {
  if (oauthLinked(o) && id.sub === o.linkedSub) return true;
  return !!(id.email && id.emailVerified && o.allowedEmails.includes(id.email));
}

/** null if `a` leaves at least one proven way in; otherwise why it would lock you out. */
export function lockoutProblem(a, passkeyCount) {
  const e = effective(a);
  if (e.password) return null;
  if (e.passkey && passkeyCount > 0) return null;
  if (e.oauth && oauthLinked(a.oauth)) return null;
  return 'That would lock you out: with password sign-in off you need a working alternative. '
    + 'Add a passkey or link your OAuth account (Link my account), and make sure the chosen mode includes it.';
}

/** Browser-safe view (no secret). */
export function publicView(a) {
  const { clientSecret, ...oauth } = a.oauth;
  return { ...a, oauth: { ...oauth, hasSecret: !!clientSecret, linked: oauthLinked(a.oauth) }, effective: effective(a) };
}

/**
 * Emergency override (CLI `npm run auth:reset` or the startup flag): put
 * password sign-in back. `strict` also turns OAuth and passkeys off.
 */
export async function emergencyReset({ strict = false } = {}) {
  const before = await getAuthSettings();
  const after = await saveAuthSettings((a) => (strict
    ? { ...a, mode: 'PASSWORDS_AND_OAUTH', passkeysEnabled: false, oauth: { ...a.oauth, enabled: false } }
    : { ...a, mode: 'ALL_ENABLED' }));
  const c = await readJson(config.configFile, {});
  return { before, after, passwordSet: !!(c && c.passwordHash), username: (c && c.username) || null };
}
