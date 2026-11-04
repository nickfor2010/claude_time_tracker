// Verifies Web Push encryption (RFC 8291) and VAPID signing (RFC 8292) by acting as the receiving browser.
import { test } from 'node:test';
import assert from 'node:assert';
import { createVapidKeys, sendPush, b64url, fromB64url } from '../src/push.js';

const subtle = crypto.subtle;
async function hkdf(salt, ikm, info, len) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const te = new TextEncoder();

test('push message decrypts on the receiving side and VAPID signature verifies', async () => {
  // "browser" keys
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: 'https://push.example.com/send/abc', p256dh: b64url(uaPub), auth: b64url(authSecret) };
  const vapid = await createVapidKeys();

  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { captured = { url, init }; return new Response(null, { status: 201 }); };
  try {
    assert.equal(await sendPush(sub, { title: '休假已核准 ✓', body: 'Nov 10 – 12' }, vapid, 'https://parsley.example'), 'ok');
  } finally { globalThis.fetch = realFetch; }

  // --- decrypt like a browser would ---
  const body = new Uint8Array(captured.init.body);
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  assert.equal(plain[plain.length - 1], 2, 'last-record padding delimiter');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain.slice(0, -1))), { title: '休假已核准 ✓', body: 'Nov 10 – 12' });

  // --- check headers and the VAPID JWT ---
  const h = captured.init.headers;
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  const [, jwt, k] = h.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, vapid.publicKey);
  const [hd, cl, sig] = jwt.split('.');
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(cl)));
  assert.equal(claims.aud, 'https://push.example.com');
  assert.equal(claims.sub, 'https://parsley.example');
  const pub = await subtle.importKey('raw', fromB64url(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(sig), te.encode(`${hd}.${cl}`)));
});

test('expired subscriptions are reported as gone', async () => {
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sub = { endpoint: 'https://push.example.com/x', p256dh: b64url(await subtle.exportKey('raw', ua.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 410 });
  try { assert.equal(await sendPush(sub, { title: 'x' }, await createVapidKeys(), 'https://a.example'), 'gone'); }
  finally { globalThis.fetch = realFetch; }
});
