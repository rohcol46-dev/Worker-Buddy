// sw.js — lets both apps open at once, even with a weak signal or no internet.
// App files come from the phone straight away and are refreshed from the network in the background.
// A new release (a new VERSION) is fetched whole on install; the page then reloads once (features.js).
// So: bump VERSION in every PR that changes an app file. Without a bump, phones get the change one
// open later, file by file, which can briefly mix old and new files.
// Map tiles seen before are kept too. Live data (Supabase, weather, places) always goes to the network.
const VERSION = 'wb-v33';
const APP_FILES = [
  './',
  './index.html',
  './icon.svg',
  './css/style.css',
  './css/live.css',
  './css/theme.css',
  './css/app-look.css',
  './js/config.js',
  './js/data.js',
  './js/intro.js',
  './js/moments.js',
  './js/wage.js',
  './js/safety.js',
  './js/live.js',
  './js/report.js',
  './js/account.js',
  './js/trust.js',
  './js/countries.js',
  './js/features.js',
  './js/lang-hi.js',
  './js/extras.js',
  './js/more.js',
  './js/deck.js',
  './js/fair.js',
  './js/care.js',
  './js/grow.js',
  './js/pages.js',
  './js/buddy.js',
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
  './vendor/leaflet-1.9.4/leaflet.css',
  './vendor/leaflet-1.9.4/leaflet.js',
  './vendor/supabase-js-2.45.4/supabase.js',
  './vendor/qrcode-generator-1.4.4.js',
  './vendor/jsqr-1.4.0.js',
  './vendor/fonts/plus-jakarta-sans-v12-latin.woff2'
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

  // App files: the saved copy at once (no waiting on a weak signal), refreshed in the background
  // for next time. Nothing saved yet: wait for the network, as a normal page would.
  const isAppFile = url.origin === self.location.origin || APP_FILES.includes(req.url);
  if (!isAppFile) return; // live data goes to the network as normal
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const saved = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req, { cache: 'no-cache' })
        .then((res) => {
          // saved without ?query, so job links (worker/?job=…) don't pile up copies of the page
          if (res.ok && res.type === 'basic') cache.put(url.origin + url.pathname, res.clone());
          return res;
        });
      if (saved) {
        event.waitUntil(fresh.catch(() => {}));
        return saved;
      }
      return fresh.catch(() => Response.error());
    })
  );
});
