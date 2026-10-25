/* bkesari service worker: makes the hub installable and shows an offline page.
   Only the hub's own static shell is cached. Anything signed-in or per-user
   (/hub/api, /api/auth, /tasks, /ATIP, /ladwani, /edu) always goes to the
   network and is never stored, so a shared phone cannot replay someone else's
   page from the cache. */
const CACHE = 'bkesari-shell-v1';
const SHELL = ['/offline.html', '/shared/menu.js', '/shared/page.css', '/manifest.webmanifest', '/icons/icon-192.png'];
const PRIVATE = /^\/(hub|api|tasks|atip|ladwani|edu|admin|access|auth)(\/|$)/i;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  if (PRIVATE.test(url.pathname)) return;
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
