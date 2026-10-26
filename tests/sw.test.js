/**
 * portal/public/sw.js, the service worker that makes the hub installable.
 *
 * It runs on every page of the origin, the signed-in project tabs included, so
 * the one thing it must never do is keep a per-user response: on a shared
 * phone that would replay someone else's page. These tests run the worker in a
 * sandbox with a fake network and a fake Cache Storage and pin what it stores,
 * what it answers from the cache, and that the shell it does cache never goes
 * stale while the network is there.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SW = path.join(__dirname, '..', 'portal', 'public', 'sw.js');
const ORIGIN = 'https://bkesari.com';

/** Load sw.js with a fake network (`online` decides whether fetch works) and a fake Cache Storage. */
function loadWorker() {
  const handlers = {};
  const stores = new Map(); // cache name -> Map(path -> body)
  const writes = []; // every write to any cache, after install
  let installing = false;
  const net = { online: true, calls: [] };
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname + new URL(typeof r === 'string' ? r : r.url, ORIGIN).search;
  const response = (body, from) => ({ ok: true, status: 200, body, from, clone() { return this; } });
  const fetch = async (r) => {
    net.calls.push(key(r));
    if (!net.online) throw new TypeError('Failed to fetch');
    return response(`network:${key(r)}`, 'network');
  };
  const openCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const put = async (r, res) => { if (!installing) writes.push(key(r)); m.set(key(r), res.body); };
    return {
      put,
      add: async (r) => put(r, await fetch(r)),
      addAll: async (list) => { for (const r of list) await put(r, await fetch(r)); },
      match: async (r) => (m.has(key(r)) ? response(m.get(key(r)), 'cache') : undefined),
      keys: async () => [...m.keys()],
      delete: async (r) => m.delete(key(r)),
    };
  };
  const caches = {
    open: async (name) => openCache(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (r) => { for (const n of stores.keys()) { const hit = await openCache(n).match(r); if (hit) return hit; } return undefined; },
  };
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const ctx = { self, caches, fetch, URL, Promise, location: new URL(ORIGIN + '/sw.js'), console };
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(SW, 'utf8'), ctx, { filename: SW });

  const event = (extra) => {
    const e = { waits: [], waitUntil(p) { this.waits.push(p); }, ...extra };
    return e;
  };
  return {
    net, stores, writes, handlers,
    async install() {
      installing = true;
      const e = event({});
      handlers.install(e);
      await Promise.all(e.waits);
      installing = false;
      const e2 = event({});
      handlers.activate(e2);
      await Promise.all(e2.waits);
    },
    /** Dispatch a fetch; returns the response the worker answered with, or null if it let the browser handle it. */
    async request(url, { method = 'GET', mode = 'no-cors' } = {}) {
      let answered = null;
      const e = event({ request: { url: new URL(url, ORIGIN).href, method, mode }, respondWith(p) { answered = p; } });
      handlers.fetch(e);
      return answered ? await answered : null;
    },
    cached() { return [...stores.values()].flatMap((m) => [...m.keys()]); },
  };
}

// Pages and APIs whose answer depends on who is signed in, or that belong to a project tab.
const PER_USER = [
  '/hub/api/me', '/api/auth/get-session', '/tasks/', '/tasks/api/overview', '/tasks/live.js',
  '/tasklist/', '/tasklist/api/tasks', '/tasklist/app.js',
  '/ATIP/', '/atip/api/archive', '/ladwani/orders', '/edu/livewire/update', '/edu/',
  '/admin/access', '/access/request?project=edu', '/auth/sign-in',
];

test('the worker caches only the static shell, and every shell file is a real static file', async () => {
  const w = loadWorker();
  await w.install();
  const shell = w.cached();
  assert.ok(shell.includes('/offline.html'));
  for (const p of shell) {
    assert.ok(fs.statSync(path.join(__dirname, '..', 'portal', 'public', p)).isFile(), p);
    assert.ok(!PER_USER.some((u) => p.toLowerCase().startsWith(u.toLowerCase().replace(/\/[^/]*$/, '/'))), `${p} is per-user`);
  }
});

test('per-user pages and APIs are never stored, online or offline', async () => {
  const w = loadWorker();
  await w.install();
  const before = w.cached().sort();
  for (const online of [true, false]) {
    w.net.online = online;
    for (const p of PER_USER) {
      // Subresource requests to them are left to the browser entirely.
      assert.equal(await w.request(p), null, `${p} was intercepted`);
      for (const variant of [p.toUpperCase(), p.replace(/^\//, '/./')]) {
        const r = await w.request(variant);
        assert.ok(r === null || r.from === 'network', `${variant} was answered from the cache`);
      }
      // A navigation goes to the network; offline it gets the offline page, never a stored copy of itself.
      const nav = await w.request(p, { mode: 'navigate' });
      if (online) assert.equal(nav.from, 'network', p);
      else assert.equal(nav.body, 'network:/offline.html', p);
    }
  }
  assert.deepEqual(w.writes, [], 'the worker wrote to the cache outside install');
  assert.deepEqual(w.cached().sort(), before);
});

test('the shell is served fresh from the network while online, and from the cache only offline', async () => {
  const w = loadWorker();
  await w.install();
  for (const p of ['/shared/menu.js', '/shared/page.css']) {
    w.net.online = true;
    const live = await w.request(p);
    // Cache-first would keep an installed phone on the old menu after every deploy
    // until someone remembered to rename the cache.
    assert.ok(live === null || live.from === 'network', `${p} came from the cache while online`);
    w.net.online = false;
    const off = await w.request(p);
    assert.equal(off && off.from, 'cache', `${p} offline`);
  }
  assert.deepEqual(w.writes, []);
});

test('POSTs and other origins pass straight through the worker', async () => {
  const w = loadWorker();
  await w.install();
  assert.equal(await w.request('/tasks/api/tasks', { method: 'POST' }), null);
  assert.equal(await w.request('/shared/menu.js', { method: 'POST' }), null);
  assert.equal(await w.request('https://fonts.googleapis.com/css2?family=Inter'), null);
  assert.equal(await w.request('https://evil.example/shared/menu.js'), null);
});
