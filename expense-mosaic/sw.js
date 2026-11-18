// Service worker: precaches the app and serves it cache-first, so it works offline.
// Bump VERSION whenever any file in ASSETS changes (the deploy workflow does this for you):
// the browser sees the new sw.js, installs the new set into a fresh cache, and the old cache is
// deleted on activate. Each version is served whole, so files from different releases never mix.
// A new version waits until the page asks it to take over (its "new version" banner), so a
// release never swaps out under a page that is still running the old code.
const VERSION = 'expense-mosaic-2d4be1e59364';
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
// Files shared from another app (manifest share_target) arrive as a POST to SHARE_URL. They are
// stashed in SHARE_CACHE, one entry per file, and the page (index.html, takeShared) adds them to a
// batch and deletes each entry once it is stored. Kept across app updates; same name in index.html.
const SHARE_URL = new URL('share-target', location).href;
const SHARE_CACHE = 'expense-mosaic-share';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  const keep = [VERSION, PDFJS_CACHE, SHARE_CACHE];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('expense-mosaic-') && !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stashes the shared files, then sends the browser to the page with a 303 (so it loads it with a
// GET). The redirect happens even if the stash failed: the page then says nothing arrived.
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('receipts').filter(f => f && typeof f !== 'string');
    const cache = await caches.open(SHARE_CACHE);
    const stamp = Date.now();
    // Keys sort in the order the files were shared: the stamp, then the zero-padded index.
    await Promise.all(files.map((f, i) => cache.put(
      `share-target/${stamp}-${String(i).padStart(4, '0')}`,
      new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || '') } }),
    )));
  } catch (err) {
    console.warn('Could not stash the shared files', err);
  }
  return Response.redirect(new URL('./?shared=1', location).href, 303);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method === 'POST' && req.url.split('?')[0] === SHARE_URL) {
    e.respondWith(receiveShare(req));
    return;
  }
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
