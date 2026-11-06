// job-alert — Supabase Edge Function: alerts nearby workers about a new job, even with the app closed.
//
// The employer's app calls it right after posting a job: POST { bookings: [id, ...] } with the
// employer's sign-in. For each job, the database (job_alert_targets, supabase/034) checks it is this
// employer's new job, marks it alerted (once), and returns the push addresses of online workers with
// that skill nearby. This function then sends each one a Web Push message.
//
// No libraries: Web Push encryption (RFC 8291) and VAPID signing (RFC 8292) use the built-in WebCrypto.
//
// Secrets to set once (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   the same key as PUSH_PUBLIC_KEY in js/config.js
//   VAPID_PRIVATE_KEY  its private half (never in the repo)
//   VAPID_SUBJECT      mailto: address push services can write to about problems
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are given to every function by Supabase.
// "Verify JWT" can be off: the function checks the caller's sign-in itself.

const enc = new TextEncoder();

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// RFC 8291: encrypt one message for one browser (aes128gcm, a single record)
// (fixed is only for the test: the RFC's example keys and salt instead of fresh random ones)
export async function encryptPayload(payload: Uint8Array, p256dh: string, authSecret: string,
                                     fixed?: { asPublic: string; asPrivate: string; salt: string }): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(p256dh);
  const auth = b64urlToBytes(authSecret);
  let asPublic: Uint8Array, asPrivate: CryptoKey;
  if (fixed) {
    asPublic = b64urlToBytes(fixed.asPublic);
    const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64url(asPublic.slice(1, 33)), y: bytesToB64url(asPublic.slice(33, 65)), d: fixed.asPrivate };
    asPrivate = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
    asPrivate = local.privateKey;
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed ? b64urlToBytes(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

// RFC 8292: a short-lived signed token that tells the push service who is sending
export async function vapidAuth(endpoint: string, publicKey: string, privateKey: string, subject: string): Promise<string> {
  const pub = b64urlToBytes(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${bytesToB64url(sig)}, k=${publicKey}`;
}

// ---------- The message a worker sees ----------
const WORDS: Record<string, Record<string, string>> = {
  en: { now: 'New job', later: 'Job for later', h: 'h', tap: 'Tap to see it',
        coolie: 'Coolie / Loader', helper: 'Helper', plumber: 'Plumber', electrician: 'Electrician', mason: 'Mason', painter: 'Painter' },
  ta: { now: 'புதிய வேலை', later: 'பின்னர் ஒரு வேலை', h: 'மணி', tap: 'பார்க்கத் தட்டுங்கள்',
        coolie: 'கூலி / சுமை தூக்குபவர்', helper: 'உதவியாளர்', plumber: 'பிளம்பர்', electrician: 'எலக்ட்ரீஷியன்', mason: 'கொத்தனார்', painter: 'பெயிண்டர்' },
  hi: { now: 'नया काम', later: 'बाद का काम', h: 'घंटे', tap: 'देखने के लिए दबाएँ',
        coolie: 'कुली / लोडर', helper: 'हेल्पर', plumber: 'प्लंबर', electrician: 'इलेक्ट्रीशियन', mason: 'मिस्त्री', painter: 'पेंटर' }
};

type Job = { id: string; type: string; area: string; hours: number; wage_min: number; wage_max: number; currency: string; scheduled_for: string | null };

export function messageFor(job: Job, lang: string) {
  const w = WORDS[lang] || WORDS.en;
  const locale = { en: 'en-IN', ta: 'ta-IN', hi: 'hi-IN' }[lang] || 'en';
  let money = (n: number) => String(n);
  try {
    const f = new Intl.NumberFormat(locale, { style: 'currency', currency: job.currency || 'INR', maximumFractionDigits: 0 });
    money = (n: number) => f.format(n);
  } catch (_) { /* unknown currency: plain numbers */ }
  const wage = job.wage_min === job.wage_max ? money(job.wage_min) : `${money(job.wage_min)}–${money(job.wage_max)}`;
  return {
    title: `${job.scheduled_for ? w.later : w.now}: ${w[job.type] || job.type}`,
    body: `${job.area} · ${wage} · ${job.hours} ${w.h}\n${w.tap}`,
    tag: 'job-' + job.id,
    url: '/worker/'
  };
}

// ---------- The function ----------
const PUSH_SERVICE = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)\//;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export async function handle(req: Request, env: (k: string) => string | undefined): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'post_only' });

  const url = env('SUPABASE_URL');
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublic = env('VAPID_PUBLIC_KEY');
  const vapidPrivate = env('VAPID_PRIVATE_KEY');
  const subject = env('VAPID_SUBJECT') || 'mailto:rohcol69@gmail.com';
  if (!url || !service || !vapidPublic || !vapidPrivate) return reply(500, { error: 'not_set_up' });
  const serverHeaders: Record<string, string> = { apikey: service, 'Content-Type': 'application/json' };
  if (service.startsWith('eyJ')) serverHeaders.Authorization = `Bearer ${service}`;

  // Who is asking: the employer's own sign-in
  const userToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!userToken) return reply(401, { error: 'sign_in' });
  const who = await fetch(`${url}/auth/v1/user`, { headers: { apikey: service, Authorization: `Bearer ${userToken}` } });
  if (!who.ok) return reply(401, { error: 'sign_in' });
  const user = await who.json();

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body.bookings) ? body.bookings.filter((x: unknown) => typeof x === 'string').slice(0, 10) : [];
  } catch (_) { /* bad body */ }
  if (!ids.length) return reply(400, { error: 'no_jobs' });

  let sent = 0, gone = 0, failed = 0;
  for (const id of ids) {
    const r = await fetch(`${url}/rest/v1/rpc/job_alert_targets`, {
      method: 'POST', headers: serverHeaders, body: JSON.stringify({ p_booking: id, p_auth: user.id })
    });
    if (!r.ok) { failed++; continue; }
    const found = await r.json();
    if (!found || !found.targets) continue;

    await Promise.all(found.targets.map(async (s: { endpoint: string; p256dh: string; auth: string; lang: string }) => {
      try {
        if (!PUSH_SERVICE.test(s.endpoint)) { failed++; return; }   // the database checks this too
        const payload = enc.encode(JSON.stringify(messageFor(found.job, s.lang)));
        const res = await fetch(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await vapidAuth(s.endpoint, vapidPublic, vapidPrivate, subject),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: found.job.scheduled_for ? '3600' : '600',   // a job for now is stale after 10 minutes
            Urgency: 'high'
          },
          body: await encryptPayload(payload, s.p256dh, s.auth)
        });
        if (res.status === 404 || res.status === 410) {
          // The phone dropped this address (app removed, alerts turned off): forget it
          gone++;
          await fetch(`${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`,
            { method: 'DELETE', headers: serverHeaders });
        } else if (res.ok) sent++;
        else failed++;
      } catch (_) { failed++; }
    }));
  }
  return reply(200, { sent, gone, failed });
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) D.serve((req: Request) => handle(req, (k) => D.env.get(k)));
