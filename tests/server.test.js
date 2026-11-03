/**
 * The real portal/server.js app (createApp), with a database that finds
 * nothing. What is pinned is what only the assembled app can show: TaskList's
 * pages and API need TaskList's own sign-in however a path is spelled, what a
 * malformed body gets back, and the proxy's place before the body parsers in
 * THIS file rather than in a copy of its order.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../portal/server.js');

// The hub's own tables are not under test here: every query finds nothing,
// so no one is signed in anywhere.
const stubDb = () => ({ all: async () => [], get: async () => null, run: async () => ({ rowCount: 0, rows: [] }), tx: async (fn) => fn(stubDb()) });
const noDb = stubDb();
const quiet = { log() {}, warn() {}, error() {} };

// APP_ENV is blank, not 'dev': a tier name fills in that tier's live Hostinger
// origins for the blank ones (portal/proxy.js TIER_ORIGINS). 127.0.0.1 is dev anyway.
const ENV = {
  ATIP_USER: 'viewer', ATIP_PASSWORD: 'viewer-pw', ATIP_PUBLISH_TOKEN: 'token',
  EDU_ORIGIN: '', LADWANI_ORIGIN: '', APP_ENV: '',
};

/** Runs `fn(base)` against createApp with `env` applied to process.env, then puts it back. */
async function withHub(env, fn, { db = noDb, extra = {} } = {}) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  const { app, proxied } = createApp(db, { log: quiet, ...extra });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    // A test hub forwards only to an upstream the test started, never to a live site.
    for (const r of proxied) assert.match(r.target, /^http:\/\/127\.0\.0\.1:\d+$/, `${r.path} -> ${r.target}`);
    return await fn(`http://127.0.0.1:${server.address().port}`, server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/**
 * A request with the path sent exactly as written. fetch() and new URL() fold
 * dot segments and slashes before sending, which would hide what is tested.
 */
function raw(port, method, rawPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, type: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}


test('TaskList\'s pages and API need TaskList\'s own sign-in, however the path is spelled', async () => {
  await withHub(ENV, async (base, port) => {
    const spellings = [
      '/tasklist/', '/tasklist/board', '/tasklist/task/7', '/tasklist/api/tasks', '/tasklist/api/bootstrap',
      '/%74asklist/', '/%74asklist/api/tasks', '//tasklist/', '//tasklist/api/tasks', '/./tasklist/api/tasks',
      '/shared/../tasklist/api/tasks', '/TASKLIST/api/tasks',
    ];
    for (const p of spellings) {
      const r = await raw(port, 'GET', p, { headers: { cookie: 'tl_sid=forged-forged-forged-forged; hub_admin_sid=x' } });
      assert.ok([301, 302, 401, 404].includes(r.status), `${p} answered ${r.status}`);
      assert.doesNotMatch(r.text, /id="quick-input"|"tasks":/, `${p} served the app or its data`);
    }
    // The static files are public: the app's empty shell (what the offline
    // worker keeps) and the sign-in page carry no one's data.
    const shell = await raw(port, 'GET', '/tasklist/app.html');
    assert.equal(shell.status, 200);
    assert.doesNotMatch(shell.text, /"tasks":|tl_sid|@example/);
    assert.equal((await raw(port, 'GET', '/tasklist/sign-in')).status, 200);
    assert.equal((await raw(port, 'GET', '/tasklist/quickadd.js')).status, 200);
    assert.equal((await raw(port, 'GET', '/shared/menu.js')).status, 200);
  });
});

test('a malformed JSON body is a 400 that gives nothing away', async () => {
  await withHub(ENV, async (base, port) => {
    // No route takes a body here: not found, and nothing given away either.
    const home = await raw(port, 'POST', '/', { headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(home.status, 404);
    // (A page of copy, so "at a glance" is fine: a stack frame is "    at fn (file:line)".)
    assert.doesNotMatch(home.text, /node_modules|server\.js|\s{2,}at \S+ \(|SyntaxError/);
    const paths = [
      ['/tasklist/api/tasks', {}],
      ['/tasklist/api/auth/sign-in', {}],
      ['/admin/api/auth/sign-in', {}],
      ['/ATIP/api/snapshot', { authorization: 'Bearer token' }],
    ];
    for (const [p, auth] of paths) {
      const r = await raw(port, 'POST', p, { headers: { 'content-type': 'application/json', ...auth }, body: '{bad' });
      assert.equal(r.status, 400, `${p} answered ${r.status}`);
      assert.match(r.type, /application\/json/);
      assert.equal(JSON.parse(r.text).error, 'The request body is not valid JSON');
      // Express's default page carried the stack: file paths, node_modules, "at ..." frames.
      assert.doesNotMatch(r.text, /node_modules|server\.js|\bat \w|SyntaxError/, `${p} leaked: ${r.text}`);
    }
  });
});

test('the real server.js mounts the proxy before the body parsers', async () => {
  // tests/proxy.test.js proves why the order matters on a copy of it; this is
  // the copy that ships. Moving proxy.mount below express.json() in
  // portal/server.js makes this POST hang and fail.
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: req.url, body })); });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  try {
    await withHub({ ...ENV, LADWANI_ORIGIN: origin }, async (base) => {
      const payload = JSON.stringify({ order: 'ghee', qty: 3 });
      const res = await fetch(`${base}/ladwani/api/orders`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: AbortSignal.timeout(5000),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { url: '/ladwani/api/orders', body: payload });
    });
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('TaskList\'s report and live endpoints are behind its sign-in, and the report is the owner\'s only', async () => {
  const spare = http.createServer();
  await new Promise((resolve) => spare.listen(0, '127.0.0.1', resolve));
  const dead = `http://127.0.0.1:${spare.address().port}/`;
  await new Promise((resolve) => spare.close(resolve));
  await withHub({ ...ENV, NEON_FUNCTION_REPORT_BASE_URL: dead, ORIGIN_SECRET: 'origin-secret' }, async (base, port) => {
    for (const p of ['/tasklist/api/report', '/tasklist/api/live']) assert.equal((await raw(port, 'GET', p)).status, 401, p);
  });
});

test('the report function, when it cannot be reached, is a 502 with a plain message', async (t) => {
  const { reportFunction } = require('../portal/server.js');
  assert.equal(reportFunction({}), null, 'off until both settings are there');
  assert.equal(reportFunction({ NEON_FUNCTION_REPORT_BASE_URL: 'http://x' }), null);
  const spare = http.createServer();
  await new Promise((resolve) => spare.listen(0, '127.0.0.1', resolve));
  const dead = `http://127.0.0.1:${spare.address().port}/`;
  await new Promise((resolve) => spare.close(resolve));
  t.mock.method(console, 'error', () => {});
  const call = reportFunction({ NEON_FUNCTION_REPORT_BASE_URL: dead, ORIGIN_SECRET: 's' });
  await assert.rejects(call(), (err) => err.status === 502 && err.message === 'The report function did not answer');
  const failing = http.createServer((req, res) => { res.statusCode = 500; res.end(JSON.stringify({ error: 'boom' })); });
  await new Promise((resolve) => failing.listen(0, '127.0.0.1', resolve));
  try {
    const seen = reportFunction({ NEON_FUNCTION_REPORT_BASE_URL: `http://127.0.0.1:${failing.address().port}/`, ORIGIN_SECRET: 's' });
    await assert.rejects(seen(), (err) => err.status === 502 && err.message === 'boom');
  } finally { await new Promise((resolve) => failing.close(resolve)); }
});

test('the hub is an installable PWA: manifest, icons, service worker, offline page', async () => {
  await withHub(ENV, async (base) => {
    const m = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
    const manifest = await m.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url.split('?')[0], '/');
    for (const icon of manifest.icons) assert.equal((await fetch(base + icon.src)).status, 200, icon.src);
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.status, 200);
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
    const swText = await sw.text();
    // Per-user pages are never cached by the worker.
    for (const p of ['hub', 'api', 'tasks', 'tasklist', 'atip', 'ladwani', 'edu', 'admin', 'access', 'auth', 'contact']) assert.ok(swText.includes(p), p);
    assert.equal((await fetch(`${base}/offline.html`)).status, 200);
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /<link rel="manifest" href="\/manifest.webmanifest">/);
    assert.match(home, /apple-touch-icon/);
    // TaskList installs on its own, scoped to /tasklist/.
    const tm = await (await fetch(`${base}/tasklist/manifest.webmanifest`)).json();
    assert.equal(tm.scope, '/tasklist/');
    assert.equal(tm.start_url.split('?')[0], '/tasklist/');
    const tsw = await fetch(`${base}/tasklist/sw.js`);
    assert.equal(tsw.headers.get('service-worker-allowed'), '/tasklist/');
    assert.doesNotMatch(await tsw.text(), /caches?\.(open|match)\([^)]*\/tasklist\/api/, 'TaskList\'s worker never stores its API');
  });
});
