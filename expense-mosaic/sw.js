// Service worker: precaches the app and serves it cache-first, so it works offline.
// Bump VERSION whenever any file in ASSETS changes (the deploy workflow does this for you):
// the browser sees the new sw.js, installs the new set into a fresh cache, and the old cache is
// deleted on activate. Each version is served whole, so files from different releases never mix.
const VERSION = 'expense-mosaic-903e347298f2';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];
// pdf.js loads from cdnjs the first time a PDF is added. Its URL is pinned to a version, so it is
// kept cache-first in its own cache that survives app updates. Keep in step with PDFJS_BASE.
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const PDFJS_CACHE = 'expense-mosaic-pdfjs-3.11.174';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  const keep = [VERSION, PDFJS_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('expense-mosaic-') && !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.url.startsWith(PDFJS_BASE)) {
    e.respondWith((async () => {
      const cache = await caches.open(PDFJS_CACHE);
      const hit = await cache.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req.url, res.clone()); // ok is false for opaque responses: never cache those
      return res;
    })());
    return;
  }
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // A single page, so every navigation is the app.
    const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
