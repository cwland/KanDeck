/**
 * Passkeys (WebAuthn) for the single KanDeck account, via @simplewebauthn/server.
 *
 * - A passkey is bound to the exact hostname it was created on (its "RP ID"),
 *   so the internal and external addresses each need their own. We store the
 *   RP ID with each passkey and only accept it on that hostname.
 * - Passkeys are discoverable ("resident") credentials, so sign-in needs no
 *   username: the browser / password manager (e.g. 1Password) offers it.
 * - Challenges are random, single-use and expire after 5 minutes.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { getAppConfig, getPasskeys, updatePasskeys, getWebauthnUserId } from '../auth.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 20;
const challenges = new Map(); // challenge -> { type, rpID, expires }

function remember(challenge, type, rpID) {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
  if (challenges.size > 1000) challenges.clear(); // bound memory
  challenges.set(challenge, { type, rpID, expires: now + CHALLENGE_TTL_MS });
}
/** Single-use check handed to the verifier as `expectedChallenge`. */
function consumer(type, rpID) {
  return (challenge) => {
    const c = challenges.get(challenge);
    if (!c) return false;
    challenges.delete(challenge);
    return c.type === type && c.rpID === rpID && c.expires >= Date.now();
  };
}

/** Where the browser is: the RP ID (hostname) and origin, from the request's
 *  Origin header (falling back to Host). The authenticator signs over these, so
 *  a request can't claim another site's identity. */
function browserOrigin(req) {
  const origin = req.get('origin');
  if (origin) {
    try { const u = new URL(origin); return { host: u.hostname, origin: u.origin }; } catch {}
  }
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const u = new URL(`${proto}://${host}`);
  return { host: u.hostname, origin: u.origin };
}

/** The relying party is always the address in use (localhost or the current
 *  hostname), so each address has its own passkeys. */
export async function relyingParty(req) {
  const { host, origin } = browserOrigin(req);
  return { rpID: String(host).toLowerCase(), origin, rpName: 'KanDeck' };
}

const toB64 = (buf) => Buffer.from(buf).toString('base64url');
const fromB64 = (s) => new Uint8Array(Buffer.from(String(s), 'base64url'));

/** Public, UI-safe view of the stored passkeys. */
export async function listPasskeys() {
  return (await getPasskeys()).map((p) => ({
    id: p.id, name: p.name, rpID: p.rpID, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt || null, backedUp: !!p.backedUp,
  }));
}

export async function countFor(rpID) {
  return (await getPasskeys()).filter((p) => p.rpID === rpID).length;
}

// ---- Registration (signed-in user adds a passkey) ------------------------------

export async function registrationOptions(req) {
  const { rpID, rpName } = await relyingParty(req);
  const cfg = await getAppConfig();
  const existing = (await getPasskeys()).filter((p) => p.rpID === rpID);
  if ((await getPasskeys()).length >= MAX_PASSKEYS) throw new Error(`You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
  const userName = cfg.username || 'kandeck';
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName,
    userDisplayName: `${userName} (KanDeck)`,
    userID: fromB64(await getWebauthnUserId()),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports || undefined })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
  });
  remember(options.challenge, 'reg', rpID);
  return options;
}

export async function verifyRegistration(req, response, name) {
  const { rpID, origin } = await relyingParty(req);
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: consumer('reg', rpID),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!v.verified || !v.registrationInfo) throw new Error('Passkey could not be verified.');
  const { credential, credentialBackedUp } = v.registrationInfo;
  const clean = String(name || '').trim().slice(0, 60) || `Passkey · ${rpID}`;
  await updatePasskeys((list) => {
    if (list.some((p) => p.id === credential.id)) return list;
    return [...list, {
      id: credential.id,
      publicKey: toB64(credential.publicKey),
      counter: credential.counter || 0,
      transports: credential.transports || response?.response?.transports || [],
      rpID,
      name: clean,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      backedUp: !!credentialBackedUp,
    }];
  });
  return { id: credential.id, name: clean, rpID };
}

export async function removePasskey(id) {
  let removed = false;
  await updatePasskeys((list) => list.filter((p) => (p.id === id ? ((removed = true), false) : true)));
  return removed;
}

export async function renamePasskey(id, name) {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) throw new Error('Name can’t be empty.');
  let found = false;
  await updatePasskeys((list) => list.map((p) => (p.id === id ? ((found = true), { ...p, name: clean }) : p)));
  return found;
}

// ---- Sign-in -----------------------------------------------------------------

export async function authenticationOptions(req) {
  const { rpID } = await relyingParty(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: [], // discoverable: the browser / 1Password picks the passkey
  });
  remember(options.challenge, 'auth', rpID);
  return options;
}

/** Returns true if `response` is a valid sign-in with a stored passkey. */
export async function verifyAuthentication(req, response) {
  const { rpID, origin } = await relyingParty(req);
  const cred = (await getPasskeys()).find((p) => p.id === response?.id && p.rpID === rpID);
  if (!cred) return false;
  // If the authenticator sent a user handle, it must be this account's.
  const handle = response?.response?.userHandle;
  if (handle && handle !== (await getWebauthnUserId())) return false;
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: consumer('auth', rpID),
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: { id: cred.id, publicKey: fromB64(cred.publicKey), counter: cred.counter || 0, transports: cred.transports || undefined },
    requireUserVerification: false,
  });
  if (!v.verified) return false;
  await updatePasskeys((list) => list.map((p) => (p.id === cred.id
    ? { ...p, counter: v.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }
    : p)));
  return true;
}
