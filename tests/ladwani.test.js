'use strict';

// LadWani served by the hub process (portal/ladwani.js): the static export,
// the [param] shells, the in-process API, and the gate in front of both.
// A stand-in export and a stand-in API: nothing here needs LadWani's build,
// a database or the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { createApp } = require('../portal/server.js');
const ladwani = require('../portal/ladwani.js');
const { verifyToken } = require('../portal/hub.js');

const HUB_PROJECTS = [
  { key: 'ladwani', name: 'LadWani', path: '/ladwani/', visibility: 'approval', roles: 'member,karta,operator,admin', sort_order: 10 },
  { key: 'edu', name: 'Education', path: '/edu/', visibility: 'approval', roles: 'parent,student,teacher', sort_order: 30 },
];
const stubDb = (approved) => new Proxy({}, { get: (_, k) => async (sql) => {
  if (k === 'all' && /FROM hub_projects/.test(sql)) return HUB_PROJECTS;
  if (k === 'all' && /FROM project_access/.test(sql)) return approved ? HUB_PROJECTS.map((p) => ({ project_key: p.key, role: p.roles.split(',')[0] })) : [];
  if (k === 'get' && /FROM project_access/.test(sql)) return approved ? { ok: 1 } : null;
  throw new Error(`unexpected db.${String(k)}(${String(sql).slice(0, 60)})`);
} });
const MEMBER = { id: 'u-1', email: 'member@example.com', emailVerified: true };

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
      calls.push({ method: req.method, body: req.body, rawBody: req.rawBody ? req.rawBody.toString('utf8') : null, token: req.headers['x-bkesari-token'] || null, visitor: req.headers['x-bkesari-visitor'] || null });
      res.json({ ok: true, body: req.body });
    });
    return { init: async () => {}, getHttpAdapter: () => ({ getInstance: () => inner }) };
  };
}

async function withHub({ approved = true, db = stubDb(approved), user = MEMBER, env = { LADWANI_DATABASE_URL: 'postgres://stand-in' }, webDir = fakeExport(), calls = [], mountLadwani = true } = {}, fn) {
  const saved = { EDU_ORIGIN: process.env.EDU_ORIGIN, LADWANI_ORIGIN: process.env.LADWANI_ORIGIN, APP_ENV: process.env.APP_ENV };
  Object.assign(process.env, { EDU_ORIGIN: '', LADWANI_ORIGIN: '', APP_ENV: '' });
  const extra = { getUser: async () => user };
  if (mountLadwani) extra.ladwani = { webDir, env, loadApi: fakeApi(calls), log: { error() {} } };
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
    assert.match(await r.text(), /not on this tier yet/i);
  });
});

test('a visitor is sent to sign in; build assets are served without the gate', async () => {
  await withHub({ user: null }, async ({ base, port }) => {
    const page = await get(`${base}/ladwani/family/7/`);
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/auth/sign-in?next=%2Fladwani%2Ffamily%2F7%2F');
    const asset = await get(`${base}/ladwani/_next/static/chunks/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    // Nothing but an asset without the gate: a miss there is a bare 404, not the app's own page.
    for (const p of ['/ladwani/_next/static/chunks/missing.js', '/ladwani/_next/static/%2e%2e/%2e%2e/index.html', '/ladwani/_next/static/../../login/']) {
      const r = await raw(port, p);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.text, /<p>/, p);
    }
    const api = await get(`${base}/ladwani/api/v1/echo`, { accept: 'application/json' });
    assert.equal(api.status, 401);
  });
});

test('/ladwani redirects to /ladwani/, keeping the query', async () => {
  await withHub({}, async ({ base }) => {
    const r = await get(`${base}/ladwani?x=1`);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/ladwani/?x=1');
  });
});

test('a member with access gets the pages, any id answered by its shell', async () => {
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

test('the API runs in-process with the body intact and only the hub-signed token', async () => {
  await withHub({}, async ({ base, calls }) => {
    const r = await fetch(`${base}/ladwani/api/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bkesari-token': 'forged' },
      body: JSON.stringify({ qty: 3 }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).body, { qty: 3 });
    assert.equal(calls.length, 1);
    assert.notEqual(calls[0].token, 'forged');
    assert.equal(calls[0].token.split('.').length, 3, 'the gate attached a signed token');
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

test('the token reaching the API verifies against the key set LadWani is given', async () => {
  await withHub({}, async ({ base, calls, env }) => {
    await fetch(`${base}/ladwani/api/v1/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const claims = verifyToken(JSON.parse(env.LADWANI_HUB_JWKS), calls[0].token, { audience: 'ladwani' });
    assert.equal(claims.sub, MEMBER.id);
    assert.equal(claims.role, 'member');
  });
});

test('the API is told who the visitor is, and a browser cannot claim to be someone else', async () => {
  await withHub({}, async ({ base, calls, env }) => {
    await fetch(`${base}/ladwani/api/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bkesari-visitor': 'someone-else' },
      body: '{}',
    });
    assert.equal(env.LADWANI_VISITOR_HEADER, 'x-bkesari-visitor');
    assert.equal(calls[0].visitor, MEMBER.id, 'the signed-in person, from the hub-signed token');
  });
});

test('a visitor header the browser sent never reaches the API, even when the gate names no one', async () => {
  // A project the hub marks 'open' passes the gate with no token, so the hub
  // names no visitor. The browser's own header must still not reach LadWani,
  // whose rate limits would otherwise count that request against anyone it names.
  const open = HUB_PROJECTS.map((p) => (p.key === 'ladwani' ? { ...p, visibility: 'open' } : p));
  const db = new Proxy({}, { get: (_, k) => async (sql) => {
    if (k === 'all' && /FROM hub_projects/.test(sql)) return open;
    throw new Error(`unexpected db.${String(k)}(${String(sql).slice(0, 60)})`);
  } });
  await withHub({ db, user: null }, async ({ base, calls }) => {
    const r = await fetch(`${base}/ladwani/api/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bkesari-visitor': 'someone-else', 'x-bkesari-token': 'forged' },
      body: '{}',
    });
    assert.equal(r.status, 200);
    assert.equal(calls[0].visitor, null);
    assert.equal(calls[0].token, null);
  });
});

test('a signed-in user without access is refused by page and API', async () => {
  await withHub({ approved: false }, async ({ base, calls }) => {
    const page = await get(`${base}/ladwani/`);
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/access/request?project=ladwani');
    const api = await get(`${base}/ladwani/api/v1/echo`, { accept: 'application/json' });
    assert.equal(api.status, 403);
    assert.equal(calls.length, 0);
  });
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
  const failing = { webDir, env: { LADWANI_DATABASE_URL: 'x' }, log: { error() {} }, loadApi: () => async () => { throw new Error('no database'); } };
  const { app, ladwaniTab } = createApp(stubDb(true), { getUser: async () => MEMBER, ladwani: failing });
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
    const { ladwaniTab } = createApp(stubDb(true), { getUser: async () => MEMBER, ladwani: { webDir: fakeExport(), env, loadApi, log: { error() {} } } });
    const state = await ladwaniTab.api;
    assert.equal(atLoad, expected, 'set when the API is loaded');
    assert.match(state, new RegExp(`^ready \\(database engine: ${expected} worker threads; the server shows \\d+ CPUs\\)$`));
  }
});

test('sessionSecret: derived from the hub key unless LADWANI_JWT_SECRET is set', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = { privateKey };
  const a = ladwani.sessionSecret({}, keys);
  assert.equal(a, ladwani.sessionSecret({}, keys), 'stable for the same key');
  assert.match(a, /^[0-9a-f]{64}$/);
  const other = { privateKey: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey };
  assert.notEqual(a, ladwani.sessionSecret({}, other));
  assert.equal(ladwani.sessionSecret({ LADWANI_JWT_SECRET: 'set' }, keys), 'set');
});
