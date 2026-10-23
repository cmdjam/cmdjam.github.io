// Service worker: precaches the app and serves it cache-first, so it works offline.
// Every file the page loads must be in ASSETS: the deploy fails if ASSETS and the deployed files differ.
// Bump VERSION whenever any file in ASSETS changes (the deploy workflow does this for you):
// the browser sees the new sw.js, installs the new set into a fresh cache, and the old cache is
// deleted on activate. Each version is served whole, so files from different releases never mix.
const VERSION = 'umpire-3118bcb136ca';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/rules.js',
  'js/store.js',
  'js/ui.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('umpire-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // A single page (views live in the URL hash), so every navigation is the app.
    const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
