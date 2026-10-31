// Service worker: precaches the built pages and serves them cache-first, so Orbit works offline.
// Bump VERSION whenever a file in ASSETS changes (the deploy workflow does this for you): the
// browser sees the new sw.js, installs the new set into a fresh cache, and the old cache is
// deleted on activate. Each version is served whole, so files from different releases never mix.
// A new version waits until the page asks it to take over (the "new version" banner, or
// pull-to-refresh), so a release never swaps out under a page that is still running old code.
const VERSION = 'orbit-885cc675bc7e';
const ASSETS = [
  './',
  'index.html',
  'playground.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];
// Google Fonts are cached as they load, in a cache that survives app updates. The stylesheet is
// refreshed in the background; the font files it points to never change.
const FONTS_CACHE = 'orbit-fonts';
const FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  const keep = [VERSION, FONTS_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('orbit-') && !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.origin)) {
    e.respondWith((async () => {
      const cache = await caches.open(FONTS_CACHE);
      const hit = await cache.match(req);
      const fetchAndKeep = () => fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone()); // ok is false for opaque responses: never cache those
        return res;
      });
      if (!hit) return fetchAndKeep();
      if (url.origin === FONT_HOSTS[0]) e.waitUntil(fetchAndKeep().catch(() => {}));
      return hit;
    })());
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Routes live in the hash. Navigations to a page we don't hold fall back to the app.
    const hit = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match('./') : undefined);
    return hit || fetch(req);
  })());
});
