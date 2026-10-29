/* KanDeck passkey helpers (WebAuthn) — shared by the sign-in page and the
 * Account tab. Converts between the server's JSON options/responses
 * (base64url strings) and the browser's ArrayBuffer-based API. */
(function () {
  const enc = (buf) => {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const dec = (str) => {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4);
    const bin = atob(b64); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };

  const supported = () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);

  async function conditionalAvailable() {
    try { return supported() && !!(await PublicKeyCredential.isConditionalMediationAvailable?.()); } catch { return false; }
  }

  function toCreationOptions(o) {
    return {
      ...o,
      challenge: dec(o.challenge),
      user: { ...o.user, id: dec(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: dec(c.id) })),
    };
  }
  function toRequestOptions(o) {
    return {
      ...o,
      challenge: dec(o.challenge),
      allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: dec(c.id) })),
    };
  }
  function registrationJSON(cred) {
    const r = cred.response;
    return {
      id: cred.id, rawId: enc(cred.rawId), type: cred.type,
      response: {
        clientDataJSON: enc(r.clientDataJSON),
        attestationObject: enc(r.attestationObject),
        transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
      },
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
    };
  }
  function authenticationJSON(cred) {
    const r = cred.response;
    return {
      id: cred.id, rawId: enc(cred.rawId), type: cred.type,
      response: {
        clientDataJSON: enc(r.clientDataJSON),
        authenticatorData: enc(r.authenticatorData),
        signature: enc(r.signature),
        userHandle: r.userHandle ? enc(r.userHandle) : undefined,
      },
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
    };
  }

  async function postJSON(url, body) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  /** Sign in with a passkey. mode 'conditional' = offered by autofill / 1Password
   *  as soon as the username box is focused; 'modal' = a normal prompt. */
  async function signIn({ mode = 'modal', signal } = {}) {
    const options = await postJSON('/api/auth/passkey/options');
    const cred = await navigator.credentials.get({
      publicKey: toRequestOptions(options),
      mediation: mode === 'conditional' ? 'conditional' : 'optional',
      signal,
    });
    if (!cred) throw new Error('No passkey selected');
    return postJSON('/api/auth/passkey/verify', { response: authenticationJSON(cred) });
  }

  /** Add a passkey to the signed-in account. */
  async function register(name) {
    const options = await postJSON('/api/account/passkeys/options');
    const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) });
    if (!cred) throw new Error('Cancelled');
    return postJSON('/api/account/passkeys/verify', { response: registrationJSON(cred), name });
  }

  window.KanDeckPasskeys = { supported, conditionalAvailable, signIn, register };
})();
