'use strict';

// LadWani served by the hub process (portal/ladwani.js): the static export,
// the [param] shells and the in-process API. Since 3 Nov 2026 there is no hub
// gate in front of it: LadWani signs its own people in (lw_sid on /ladwani),
// and the hub forwards nothing about who anyone is, only the visitor's address
// for LadWani's rate limits. A stand-in export and a stand-in API: nothing here
// needs LadWani's build, a database or the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const { createApp } = require('../portal/server.js');
const ladwani = require('../portal/ladwani.js');

// The hub's own tables are not under test here: every query finds nothing.
const stubDb = () => ({ all: async () => [], get: async () => null, run: async () => ({ rowCount: 0, rows: [] }), tx: async (fn) => fn(stubDb()) });
const quiet = { log() {}, warn() {}, error() {} };

/** A stand-in static export, laid out as `next build` with NEXT_OUTPUT=export writes it. */
function fakeExport() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladwani-out-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('index.html', '<p>home</p>');
  put('404.html', '<p>not here</p>');
  put('login/index.html', '<p>login</p>');
  put('family/_/index.html', '<p>family shell</p>');
  put('family/_/index.txt', 'family rsc');
  put('family/_/fees/_/index.html', '<p>invoice shell</p>');
  put('_next/static/chunks/app.js', 'console.log(1)');
  return dir;
}

/** A stand-in for LadWani's createApi(): echoes what reached it. */
function fakeApi(calls) {
  return () => async () => {
    const inner = express();
    // Keeps the raw bytes as NestFactory.create(AppModule, { rawBody: true })
    // does. Like Nest's, this parser does nothing if the body was parsed before.
    inner.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
    inner.all('/api/v1/echo', (req, res) => {
      calls.push({ method: req.method, body: req.body, rawBody: req.rawBody ? req.rawBody.toString('utf8') : null, token: req.headers['x-bkesari-token'] || null, visitor: req.headers['x-bkesari-visitor'] || null, cookie: req.headers.cookie || null });
      res.json({ ok: true, body: req.body });
    });
    return { init: async () => {}, getHttpAdapter: () => ({ getInstance: () => inner }) };
  };
}

async function withHub({ db = stubDb(), env = { LADWANI_DATABASE_URL: 'postgres://stand-in' }, webDir = fakeExport(), calls = [], mountLadwani = true } = {}, fn) {
  const saved = { EDU_ORIGIN: process.env.EDU_ORIGIN, LADWANI_ORIGIN: process.env.LADWANI_ORIGIN, APP_ENV: process.env.APP_ENV };
  Object.assign(process.env, { EDU_ORIGIN: '', LADWANI_ORIGIN: '', APP_ENV: '' });
  const extra = { log: quiet };
  if (mountLadwani) extra.ladwani = { webDir, env, loadApi: fakeApi(calls), log: quiet };
  const { app, ladwaniTab } = createApp(db, extra);
  if (ladwaniTab) await ladwaniTab.api;
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    return await fn({ base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, calls, env, ladwaniTab });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const get = (url, headers = {}) => fetch(url, { headers, redirect: 'manual' });
function raw(port, rawPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

test('resolveStatic: pages, [param] shells, and nothing outside the export', () => {
  const dir = fakeExport();
  const rel = (p) => { const f = ladwani.resolveStatic(dir, p); return f && path.relative(dir, f); };
  assert.equal(rel('/'), 'index.html');
  assert.equal(rel('/login/'), path.join('login', 'index.html'));
  assert.equal(rel('/family/7/'), path.join('family', '_', 'index.html'));
  assert.equal(rel('/family/cmv%20x/'), path.join('family', '_', 'index.html'));
  assert.equal(rel('/family/7/index.txt'), path.join('family', '_', 'index.txt'));
  assert.equal(rel('/family/7/fees/9/'), path.join('family', '_', 'fees', '_', 'index.html'));
  assert.equal(rel('/_next/static/chunks/app.js'), path.join('_next', 'static', 'chunks', 'app.js'));
  assert.equal(rel('/_next/static/chunks/other.js'), null, 'a missing asset is not a page');
  assert.equal(rel('/family/7/app.js'), null, 'a file name under a [param] folder is not an id');
  assert.equal(rel('/nowhere/'), null);
  for (const evil of ['/../package.json', '/%2e%2e/package.json', '/family/%2e%2e/%2e%2e/x', '/family/a%2fb/', '/%E0%A4%A/', '/family/.%00/']) {
    assert.equal(ladwani.resolveStatic(dir, evil), null, evil);
  }
});

test('no static export: nothing is mounted and the tab keeps its placeholder', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ladwani-none-'));
  await withHub({ webDir: empty }, async ({ base, ladwaniTab }) => {
    assert.equal(ladwaniTab, null);
    const r = await get(`${base}/ladwani/`);
    assert.equal(r.status, 404);
    assert.match(await r.text(), /is not on this server yet/i);
  });
});

test('no hub sign-in stands in front: pages, assets and the API are LadWani\'s to answer', async () => {
  await withHub({}, async ({ base, port, calls }) => {
    const page = await get(`${base}/ladwani/family/7/`);
    assert.equal(page.status, 200, 'the shared bkesari ID gate is gone');
    assert.equal(await page.text(), '<p>family shell</p>');
    const asset = await get(`${base}/ladwani/_next/static/chunks/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    // A missing build asset is a bare 404, never the app's own page.
    for (const p of ['/ladwani/_next/static/chunks/missing.js', '/ladwani/_next/static/%2e%2e/%2e%2e/index.html', '/ladwani/_next/static/../../login/']) {
      const r = await raw(port, p);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.text, /<p>/, p);
    }
    const api = await get(`${base}/ladwani/api/v1/echo`, { accept: 'application/json' });
    assert.equal(api.status, 200, 'the API decides about sign-in itself');
    assert.equal(calls.length, 1);
  });
});

test('/ladwani redirects to /ladwani/, keeping the query', async () => {
  await withHub({}, async ({ base }) => {
    const r = await get(`${base}/ladwani?x=1`);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/ladwani/?x=1');
  });
});

test('every page is answered, any id by its shell', async () => {
  await withHub({}, async ({ base }) => {
    const home = await get(`${base}/ladwani/`);
    assert.equal(home.status, 200);
    assert.equal(await home.text(), '<p>home</p>');
    assert.match(home.headers.get('cache-control'), /no-cache/);
    assert.equal(await (await get(`${base}/ladwani/family/cmvabc123/`)).text(), '<p>family shell</p>');
    assert.equal(await (await get(`${base}/ladwani/family/cmvabc123/index.txt?_rsc=1`)).text(), 'family rsc');
    assert.equal(await (await get(`${base}/ladwani/family/a/fees/b/`)).text(), '<p>invoice shell</p>');
    const missing = await get(`${base}/ladwani/nowhere/`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), '<p>not here</p>');
  });
});

test('dot segments never reach a file outside the export', async () => {
  await withHub({}, async ({ port }) => {
    for (const p of ['/ladwani/%2e%2e/package.json', '/ladwani/family/%2e%2e/%2e%2e/%2e%2e/package.json', '/ladwani/..%2f..%2fpackage.json']) {
      const r = await raw(port, p);
      assert.notEqual(r.status, 200, p);
      assert.doesNotMatch(r.text, /"name"/, p);
    }
  });
});

test('the API runs in-process with the body intact, and a hub token the browser sends never reaches it', async () => {
  await withHub({}, async ({ base, calls }) => {
    const r = await fetch(`${base}/ladwani/api/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bkesari-token': 'forged' },
      body: JSON.stringify({ qty: 3 }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).body, { qty: 3 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].token, null, 'no hub token, forged or otherwise');
  });
});

test('LadWani\'s own session cookie reaches its API, and the hub admin\'s grants it nothing', async () => {
  await withHub({}, async ({ base, calls, env }) => {
    await fetch(`${base}/ladwani/api/v1/echo`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'lw_sid=abc; tl_sid=xyz' }, body: '{}' });
    assert.match(calls[0].cookie, /lw_sid=abc/, 'the cookie travels; LadWani reads only its own');
    assert.equal(env.LADWANI_COOKIE_PATH, '/ladwani', 'LadWani scopes lw_sid to its own path');
    assert.equal(env.LADWANI_HUB_JWKS, undefined, 'the hub no longer hands LadWani a key set');
  });
});

test('the API is mounted before the hub\'s body parsers, so it gets the raw body itself', async () => {
  // LadWani's payment webhook checks its signature over req.rawBody, which only
  // Nest's own parser keeps. Mounted after the hub's express.json(), the hub
  // parses first, Nest's parser skips, and the real API answers every webhook
  // "Missing request body." while ordinary JSON still looks fine.
  await withHub({}, async ({ base, calls }) => {
    const payload = '{"event":"payment.captured",  "amount": 100}';
    const r = await fetch(`${base}/ladwani/api/v1/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
    assert.equal(r.status, 200);
    assert.equal(calls[0].rawBody, payload, 'portal/server.js must mount LadWani above express.json()');
  });
});

test('the API is told the visitor\'s address, and a browser cannot claim to be someone else', async () => {
  await withHub({}, async ({ base, calls, env }) => {
    await fetch(`${base}/ladwani/api/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bkesari-visitor': 'someone-else' },
      body: '{}',
    });
    assert.equal(env.LADWANI_VISITOR_HEADER, 'x-bkesari-visitor');
    assert.equal(calls[0].visitor, 'ip:127.0.0.1', 'the address the hub saw, never the browser\'s claim');
  });
});

test('behind the host\'s proxy the visitor is the forwarded address, which a direct caller cannot forge', async () => {
  await withHub({}, async ({ base, calls }) => {
    // From loopback (the host's front end) X-Forwarded-For is believed...
    await fetch(`${base}/ladwani/api/v1/echo`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body: '{}' });
    assert.equal(calls[0].visitor, 'ip:203.0.113.7');
  });
  assert.equal(require('../portal/server.js').trustProxySetting(''), 'loopback', '...and only from loopback by default');
});

test('without LADWANI_DATABASE_URL the pages are served and the API answers 503', async () => {
  await withHub({ env: {} }, async ({ base, ladwaniTab }) => {
    assert.equal(await ladwaniTab.api, 'LADWANI_DATABASE_URL is not set');
    assert.equal((await get(`${base}/ladwani/`)).status, 200);
    const api = await get(`${base}/ladwani/api/v1/echo`);
    assert.equal(api.status, 503);
    assert.equal((await api.json()).reason, 'LADWANI_DATABASE_URL is not set');
  });
});

test('an API that fails to start leaves the hub and the pages up', async () => {
  const webDir = fakeExport();
  const failing = { webDir, env: { LADWANI_DATABASE_URL: 'x' }, log: quiet, loadApi: () => async () => { throw new Error('no database'); } };
  const { app, ladwaniTab } = createApp(stubDb(), { log: quiet, ladwani: failing });
  assert.match(await ladwaniTab.api, /did not start: no database/);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await get(`${base}/ladwani/`)).status, 200);
    assert.equal((await get(`${base}/ladwani/api/v1/echo`)).status, 503);
    assert.equal((await get(`${base}/`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the database engine\'s threads are capped before LadWani loads it, unless the site sets them', async () => {
  // Prisma's engine starts one worker thread per CPU the server shows; on
  // Hostinger every thread counts against the account's process limit.
  for (const [given, expected] of [[undefined, String(ladwani.ENGINE_THREADS)], ['5', '5']]) {
    const env = { LADWANI_DATABASE_URL: 'postgres://stand-in' };
    if (given) env.TOKIO_WORKER_THREADS = given;
    let atLoad;
    const loadApi = () => { atLoad = env.TOKIO_WORKER_THREADS; return fakeApi([])(); };
    const { ladwaniTab } = createApp(stubDb(), { log: quiet, ladwani: { webDir: fakeExport(), env, loadApi, log: quiet } });
    const state = await ladwaniTab.api;
    assert.equal(atLoad, expected, 'set when the API is loaded');
    assert.match(state, new RegExp(`^ready \\(database engine: ${expected} worker threads; the server shows \\d+ CPUs\\)$`));
  }
});

test('a TOKIO_WORKER_THREADS the engine cannot use stops only LadWani\'s API, never the hub', async () => {
  // The engine panics on 0 or anything but a whole number, and that panic
  // aborts the whole process (SIGABRT while the engine loads): the hub with it.
  for (const given of ['0', 'abc', ' 2', '2.5', '-1']) {
    const env = { LADWANI_DATABASE_URL: 'postgres://stand-in', TOKIO_WORKER_THREADS: given };
    let loaded = false;
    const loadApi = () => { loaded = true; return fakeApi([])(); };
    const { app, ladwaniTab } = createApp(stubDb(), { log: quiet, ladwani: { webDir: fakeExport(), env, loadApi, log: quiet } });
    assert.match(await ladwaniTab.api, /did not start: TOKIO_WORKER_THREADS must be a whole number above 0/, JSON.stringify(given));
    assert.equal(loaded, false, `the engine is not loaded with ${JSON.stringify(given)}`);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await get(`${base}/ladwani/`)).status, 200);
      assert.equal((await get(`${base}/ladwani/api/v1/echo`)).status, 503);
      assert.equal((await get(`${base}/`)).status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('sessionSecret: LADWANI_JWT_SECRET, else derived from the hub secret, else random', () => {
  const a = ladwani.sessionSecret({ HUB_AUTH_SECRET: 'h'.repeat(40) }, quiet);
  assert.equal(a, ladwani.sessionSecret({ HUB_AUTH_SECRET: 'h'.repeat(40) }, quiet), 'stable for the same secret');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, ladwani.sessionSecret({ HUB_AUTH_SECRET: 'g'.repeat(40) }, quiet));
  assert.equal(ladwani.sessionSecret({ LADWANI_JWT_SECRET: 'set' }, quiet), 'set');
  assert.match(ladwani.sessionSecret({}, quiet), /^[0-9a-f]{64}$/);
});
