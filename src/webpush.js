// Minimal Web Push sender built entirely on WebCrypto (SubtleCrypto), so it runs
// natively in Cloudflare Workers with no Node polyfills — deliberately NOT the
// npm 'web-push' package (that assumes Node's crypto module). Implements the
// VAPID JWT (RFC 8292) and aes128gcm payload encryption (RFC 8291 / RFC 8188).

function base64UrlToBytes(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, dataBytes);
  return new Uint8Array(sig);
}

// HKDF (RFC 5869) built from raw HMAC-SHA256 primitives — WebCrypto's HKDF
// import requires a non-extractable base key, which doesn't compose cleanly
// with the two-step extract/expand aes128gcm needs, so we do it by hand.
async function hkdf(salt, ikm, info, length) {
  const prk = await hmacSha256(salt, ikm);
  let t = new Uint8Array(0);
  let okm = new Uint8Array(0);
  let counter = 1;
  while (okm.length < length) {
    t = await hmacSha256(prk, concatBytes(t, info, new Uint8Array([counter])));
    okm = concatBytes(okm, t);
    counter++;
  }
  return okm.slice(0, length);
}

async function importVapidPrivateKey(privateKeyB64url, publicKeyB64url) {
  const publicBytes = base64UrlToBytes(publicKeyB64url); // 65 bytes: 0x04 || x(32) || y(32)
  const x = publicBytes.slice(1, 33);
  const y = publicBytes.slice(33, 65);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyB64url,
    x: bytesToBase64Url(x),
    y: bytesToBase64Url(y),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function buildVapidJWT(endpoint, subject, publicKeyB64url, privateKeyB64url) {
  const { origin } = new URL(endpoint);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const encHeader = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;

  const privateKey = await importVapidPrivateKey(privateKeyB64url, publicKeyB64url);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

// RFC 8291 aes128gcm content encryption for a single-record push message.
async function encryptPayload(payloadBytes, p256dhB64url, authB64url) {
  const subscriberPublicBytes = base64UrlToBytes(p256dhB64url);
  const authSecret = base64UrlToBytes(authB64url);

  const subscriberKey = await crypto.subtle.importKey(
    'raw',
    subscriberPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const ephemeralKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephemeralPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey));

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberKey },
    ephemeralKeyPair.privateKey,
    256
  );
  const ecdhSecret = new Uint8Array(sharedSecretBits);

  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    subscriberPublicBytes,
    ephemeralPublicRaw
  );
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(salt, ikm, new Uint8Array(0), 32);

  const cek = await hkdf(prk, new Uint8Array(0), new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(prk, new Uint8Array(0), new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Single-record body: plaintext + delimiter byte 0x02 (last record, RFC 8188).
  const recordPlaintext = concatBytes(payloadBytes, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, recordPlaintext)
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([ephemeralPublicRaw.length]), ephemeralPublicRaw);

  return concatBytes(header, ciphertext);
}

// Sends one push message. `subscription` = {endpoint, p256dh, auth} (as stored
// in push_subscriptions). `vapid` = {publicKey, privateKey, subject} — publicKey
// is the non-secret value from src/vapidPublicKey.js, privateKey is the
// VAPID_PRIVATE_KEY secret. Throws with a `.status` matching the push service's
// HTTP status so callers can prune dead subscriptions on 404/410.
export async function sendWebPush(subscription, payloadObj, vapid) {
  const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payloadObj)), subscription.p256dh, subscription.auth);
  const jwt = await buildVapidJWT(subscription.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'content-encoding': 'aes128gcm',
      ttl: '86400',
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body,
  });

  if (!res.ok) {
    const err = new Error(`push failed (${res.status}): ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
}
