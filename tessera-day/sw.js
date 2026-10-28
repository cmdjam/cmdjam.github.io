// Service worker: precaches the app shell and serves it cache-first, so the app works offline.
// Bump VERSION whenever any file in ASSETS changes: the browser sees the new sw.js, installs the
// new set into a fresh cache, and the old cache is deleted on activate. Each version is served
// whole, so files from different releases never mix.
// A new version waits until the page asks it to take over (its "new version" banner), so a
// release never swaps out under a page that is still running the old code.
const VERSION = 'tessera-day-e963b0637383';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/model.js',
  'js/store.js',
  'js/ui.js',
  'js/paint.js',
  'js/palette.js',
  'js/settings.js',
  'js/stats.js',
  'js/tiles.js',
  'js/views/day.js',
  'js/views/week.js',
  'js/views/mosaic.js',
  'js/views/baseline.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('tessera-day-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Routes live in the hash, so every navigation is the app shell.
    const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
