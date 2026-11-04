/* TaskList's service worker, scoped to /tasklist/. Caches the app's static
   shell so TaskList opens with no connection; the app keeps the person's
   last data and offline changes in its own per-account storage (app.js).
   Nothing from /tasklist/api is ever stored here, so a shared phone cannot
   replay one person's tasks from this cache to another. */
const CACHE = 'tasklist-shell-v1';
const SHELL = [
  '/tasklist/app.html', '/tasklist/app.js', '/tasklist/i18n.js', '/tasklist/quickadd.js', '/tasklist/tasklist.css',
  '/tasklist/auth.html', '/tasklist/auth.js', '/tasklist/manifest.webmanifest',
  '/kesari-ui/1.0.0/kesari.css', '/kesari-ui/1.0.0/kesari.js', '/kesari-ui/1.0.0/fonts/mukta-latin-400-normal.woff2',
  '/kesari-ui/1.0.0/fonts/mukta-latin-600-normal.woff2', '/kesari-ui/1.0.0/fonts/mukta-devanagari-400-normal.woff2',
  '/shared/menu.js', '/icons/icon-192.png',
];
const AUTH_PAGES = /^\/tasklist\/(sign-in|sign-up|forgot-password|reset-password|verify)\/?$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('tasklist-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/tasklist/api/')) return; // always the network, never stored
  if (req.mode === 'navigate') {
    // Online: the server decides (it sends a signed-out visitor to sign in).
    // Offline: the app shell, which shows the last data this device saw.
    const fallback = AUTH_PAGES.test(url.pathname) ? '/tasklist/auth.html' : '/tasklist/app.html';
    e.respondWith(fetch(req).catch(() => caches.match(fallback)));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    // Network first, so a deploy reaches installed phones straight away.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.error())));
  }
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/tasklist/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((wins) => {
    const open = wins.find((w) => w.url.includes('/tasklist/'));
    if (open) { open.navigate(target); return open.focus(); }
    return self.clients.openWindow(target);
  }));
});
