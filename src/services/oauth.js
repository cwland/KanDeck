/**
 * OAuth 2.0 / OpenID Connect sign-in (authorization-code flow + PKCE).
 *
 * - Endpoints come from the issuer's discovery document
 *   (<issuer>/.well-known/openid-configuration); any endpoint can be
 *   overridden by hand for plain-OAuth2 providers.
 * - Each request carries a random `state` (bound to the browser by a
 *   short-lived cookie), a `nonce` and a PKCE verifier. They are single-use
 *   and expire after 10 minutes.
 * - ID tokens are verified (signature via the provider's JWKS — or the client
 *   secret for HS256 — issuer, audience, expiry, nonce). Without an ID token
 *   the userinfo endpoint identifies the user.
 */
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getAuthSettings, issuerKey } from './auth-settings.js';
import { decrypt } from './secrets.js';

const PENDING_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const pending = new Map(); // state -> { purpose, nonce, verifier, redirectUri, key, expires }
const discoCache = new Map(); // url -> { meta, at }
const jwksCache = new Map(); // url -> RemoteJWKSet
const b64u = (b) => Buffer.from(b).toString('base64url');

/** This browser's callback URL (register it with the provider). */
export function callbackUrl(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim();
  return `${proto}://${host}/api/auth/oauth/callback`;
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000), headers: { accept: 'application/json', ...(opts.headers || {}) } });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, data };
}

/** Provider endpoints (discovered, then manual overrides). */
export async function discover(o, { fresh = false } = {}) {
  let meta = {};
  if (o.issuer) {
    const base = o.issuer.replace(/\/+$/, '');
    const url = base.includes('/.well-known/') ? base : base + '/.well-known/openid-configuration';
    const hit = discoCache.get(url);
    if (!fresh && hit && Date.now() - hit.at < DISCOVERY_TTL_MS) meta = hit.meta;
    else {
      let r;
      try { r = await fetchJson(url); } catch (e) { r = { ok: false, status: e.name === 'TimeoutError' ? 'timeout' : e.message }; }
      if (r.ok && r.data && typeof r.data === 'object') { meta = r.data; discoCache.set(url, { meta, at: Date.now() }); }
      else if (!(o.authorizationEndpoint && o.tokenEndpoint))
        throw new Error(`Couldn't read the provider's discovery document (${r.status}) at ${url}`);
    }
  }
  const m = {
    issuer: meta.issuer || '',
    authorization_endpoint: o.authorizationEndpoint || meta.authorization_endpoint || '',
    token_endpoint: o.tokenEndpoint || meta.token_endpoint || '',
    userinfo_endpoint: o.userinfoEndpoint || meta.userinfo_endpoint || '',
    jwks_uri: o.jwksUri || meta.jwks_uri || '',
  };
  if (!m.authorization_endpoint || !m.token_endpoint)
    throw new Error('No authorization or token endpoint found. Check the Issuer URL, or fill in the endpoints under Advanced.');
  return m;
}

function gc() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  if (pending.size > 500) pending.clear();
}

/** Build the provider's authorization URL. purpose = 'login' | 'link'. */
export async function startUrl(req, purpose) {
  const o = (await getAuthSettings()).oauth;
  const m = await discover(o);
  const state = b64u(crypto.randomBytes(24));
  const nonce = b64u(crypto.randomBytes(16));
  const verifier = b64u(crypto.randomBytes(32));
  const redirectUri = callbackUrl(req);
  gc();
  pending.set(state, { purpose, nonce, verifier, redirectUri, key: issuerKey(o), expires: Date.now() + PENDING_TTL_MS });
  const u = new URL(m.authorization_endpoint);
  const params = {
    response_type: 'code',
    client_id: o.clientId,
    redirect_uri: redirectUri,
    scope: o.scopes || 'openid email profile',
    state,
    nonce,
    code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return { url: u.toString(), state };
}

/** Single-use lookup of a pending request. */
export function takePending(state) {
  const p = pending.get(state);
  pending.delete(state);
  return p && p.expires >= Date.now() ? p : null;
}

function jwksFor(url) {
  if (!jwksCache.has(url)) jwksCache.set(url, createRemoteJWKSet(new URL(url)));
  return jwksCache.get(url);
}

/** Exchange the code and return the verified identity { sub, email, emailVerified, name }. */
export async function finish(p, code) {
  const o = (await getAuthSettings()).oauth;
  if (issuerKey(o) !== p.key) throw new Error('The OAuth settings changed during sign-in. Try again.');
  if (!code) throw new Error('The provider sent no authorization code.');
  const m = await discover(o);
  const secret = decrypt(o.clientSecret);
  const form = { grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: o.clientId };
  const exchange = (body, basic) => fetchJson(m.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(basic ? { authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(o.clientId)}:${encodeURIComponent(secret)}`).toString('base64') } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });
  // client_secret_basic first; fall back to client_secret_post.
  let r = await exchange(form, !!secret);
  if (secret && !r.ok && (r.status === 401 || (r.data && r.data.error === 'invalid_client')))
    r = await exchange({ ...form, client_secret: secret }, false);
  const tok = r.data || {};
  if (!r.ok || (!tok.access_token && !tok.id_token))
    throw new Error('Token exchange failed: ' + (tok.error_description || tok.error || 'HTTP ' + r.status));

  let claims = {};
  if (tok.id_token) {
    const jwks = m.jwks_uri ? jwksFor(m.jwks_uri) : null;
    const key = async (header, token) => {
      if (/^HS/.test(header.alg || '')) {
        if (!secret) throw new Error('ID token is HMAC-signed but no client secret is set.');
        return new TextEncoder().encode(secret);
      }
      if (!jwks) throw new Error('The provider has no JWKS (signing keys) URL.');
      return jwks(header, token);
    };
    const { payload } = await jwtVerify(tok.id_token, key, {
      issuer: m.issuer || undefined,
      audience: o.clientId,
      clockTolerance: 60,
    });
    if (payload.nonce !== p.nonce) throw new Error('The sign-in response didn’t match this request.');
    claims = payload;
  }
  if ((!claims.sub || !claims.email) && m.userinfo_endpoint && tok.access_token) {
    const u = await fetchJson(m.userinfo_endpoint, { headers: { authorization: 'Bearer ' + tok.access_token } });
    if (u.ok && u.data && typeof u.data === 'object') {
      const sub = String(u.data.sub ?? u.data.id ?? '');
      if (claims.sub && sub && sub !== String(claims.sub)) throw new Error('The provider returned two different users.');
      claims = { ...u.data, ...claims, sub: claims.sub || sub };
    }
  }
  if (!claims.sub) throw new Error('The provider didn’t identify the user.');
  return {
    sub: String(claims.sub),
    email: claims.email ? String(claims.email).trim().toLowerCase() : '',
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: String(claims.name || claims.preferred_username || claims.login || ''),
  };
}
