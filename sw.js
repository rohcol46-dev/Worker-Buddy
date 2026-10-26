// sw.js — lets both apps open without internet.
// App files come from the network when online (so a new version shows at once) and from the
// phone when offline; map tiles seen before are kept too.
// Live data (Supabase, weather, places) always goes to the network.
const VERSION = 'wb-v21';
const APP_FILES = [
  './',
  './index.html',
  './icon.svg',
  './css/style.css',
  './css/live.css',
  './css/theme.css',
  './js/config.js',
  './js/data.js',
  './js/wage.js',
  './js/safety.js',
  './js/live.js',
  './js/account.js',
  './js/trust.js',
  './js/features.js',
  './js/lang-hi.js',
  './js/extras.js',
  './js/more.js',
  './js/deck.js',
  './js/fair.js',
  './js/care.js',
  './js/grow.js',
  './js/pages.js',
  './wages/',
  './wages/index.html',
  './dispute/',
  './dispute/index.html',
  './privacy/',
  './privacy/index.html',
  './js/worker-app.js',
  './js/employer-app.js',
  './worker/',
  './worker/index.html',
  './worker/manifest.json',
  './worker/icon.svg',
  './employer/',
  './employer/index.html',
  './employer/manifest.json',
  './employer/icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];
const TILE_LIMIT = 300;

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own cache, so the saved copy is the new version
  event.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'wb-tiles').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: use the saved copy if there is one, otherwise fetch and save it
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open('wb-tiles').then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          cache.put(req, res.clone());
          cache.keys().then((keys) => { if (keys.length > TILE_LIMIT) cache.delete(keys[0]); });
        }
        return res;
      }).catch(() => Response.error())
    );
    return;
  }

  // App files: the network first (new versions show at once), the saved copy when offline or slow
  const isAppFile = url.origin === self.location.origin || APP_FILES.includes(req.url);
  if (!isAppFile) return; // live data goes to the network as normal
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const saved = () => cache.match(req, { ignoreSearch: true });
      try {
        const res = await Promise.race([
          fetch(req, { cache: 'no-cache' }),
          new Promise((_, no) => setTimeout(() => no(new Error('slow')), 5000))
        ]);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return (await saved()) || Response.error();
      }
    })
  );
});
