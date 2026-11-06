// Checks the job-alert function's Web Push code against the example in RFC 8291 (Appendix A),
// its VAPID signature, and the message text. Run: node --experimental-strip-types tests/job-alert.test.mjs
import assert from 'node:assert/strict';
import { encryptPayload, vapidAuth, messageFor, b64urlToBytes, bytesToB64url, handle } from '../supabase/functions/job-alert/index.ts';

// 1. Encryption gives exactly the RFC's example message
const out = await encryptPayload(new TextEncoder().encode('When I grow up, I want to be a watermelon'),
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
  { asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
assert.equal(bytesToB64url(out),
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  'RFC 8291 example');

// 2. VAPID: a valid ES256 token for the push service's origin, with our public key
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', pub, priv, 'mailto:test@example.com');
const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(k, pub);
const [h, b, s] = token.split('.');
const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(b)));
assert.equal(claims.aud, 'https://fcm.googleapis.com');
assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'expires within 24 hours');
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlToBytes(s), new TextEncoder().encode(`${h}.${b}`)),
  'signature checks out');

// 3. The message, in the worker's language
const job = { id: 'j1', type: 'mason', area: 'Velachery', hours: 8, wage_min: 800, wage_max: 1000, currency: 'INR', scheduled_for: null };
const en = messageFor(job, 'en');
assert.equal(en.title, 'New job: Mason');
assert.match(en.body, /^Velachery · ₹800–₹1,000 · 8 h/);
assert.equal(en.url, '/worker/');
assert.equal(messageFor(job, 'ta').title, 'புதிய வேலை: கொத்தனார்');
assert.equal(messageFor({ ...job, scheduled_for: '2026-11-20T09:00:00Z' }, 'hi').title, 'बाद का काम: मिस्त्री');
assert.equal(messageFor(job, 'xx').title, 'New job: Mason', 'unknown language falls back to English');

// 4. The function refuses callers without a sign-in, and isn't usable before it's set up
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv };
assert.equal((await handle(new Request('https://f/', { method: 'POST', body: '{}' }), (k) => env[k])).status, 401);
assert.equal((await handle(new Request('https://f/', { method: 'POST' }), () => undefined)).status, 500);
assert.equal((await handle(new Request('https://f/', { method: 'OPTIONS' }), (k) => env[k])).status, 204);

console.log('job alert function: ok');
