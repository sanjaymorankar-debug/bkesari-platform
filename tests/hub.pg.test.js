/**
 * The access layer end to end on a real PostgreSQL: sign-in gate, request
 * access, approve, signed token reaching the app, ATIP owner-only.
 * Needs TEST_DATABASE_URL (a database it may WIPE); skipped without it.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const URL_ = process.env.TEST_DATABASE_URL;
const skip = URL_ ? false : 'TEST_DATABASE_URL is not set';

const createDb = require('../portal/db.js');
const { createApp } = require('../portal/server.js');
const { verifyToken } = require('../portal/hub.js');
const { Client } = require('pg');

const OWNER = { id: 'u-owner', email: 'agtcipl@gmail.com', emailVerified: true };
const ASHA = { id: 'u-asha', email: 'asha@example.com', emailVerified: true };
const RAVI = { id: 'u-ravi', email: 'ravi@example.com', emailVerified: true };

describe('hub access layer on PostgreSQL', { skip }, () => {
  let db, server, upstream, base, jwks, current = null, lastSeen = null;
  const as = (u) => { current = u; };
  const hit = (method, path, body, headers = {}) => fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  before(async () => {
    const c = new Client({ connectionString: URL_ }); await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
    db = await createDb({ env: { ...process.env, DATABASE_URL: URL_ }, quiet: true });
    upstream = http.createServer((req, res) => {
      lastSeen = req.headers['x-bkesari-token'] || null;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: req.url }));
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const o = `http://127.0.0.1:${upstream.address().port}`;
    process.env.LADWANI_ORIGIN = o; process.env.EDU_ORIGIN = o;
    process.env.HUB_OWNER_EMAILS = 'agtcipl@gmail.com'; process.env.APP_ENV = 'dev';
    const { app } = createApp(db, { getUser: async () => current });
    server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
    jwks = await (await hit('GET', '/.well-known/jwks.json')).json();
  });
  after(async () => {
    await new Promise((r) => server && server.close(r));
    await new Promise((r) => upstream && upstream.close(r));
    await db.end();
  });

  test('the hub schema is created and seeded with the six projects', async () => {
    const rows = await db.all('SELECT key FROM hub_projects ORDER BY sort_order');
    assert.deepEqual(rows.map((r) => r.key), ['ladwani', 'atip', 'edu', 'tasklist', 'driving', 'environment']);
  });

  test('a visitor sees open projects only and is sent to sign in for a protected one', async () => {
    as(null);
    const me = await (await hit('GET', '/hub/api/me')).json();
    assert.equal(me.user, null);
    assert.ok(!me.projects.some((p) => p.key === 'atip'));
    const r = await hit('GET', '/ladwani/members');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/auth/sign-in?next=%2Fladwani%2Fmembers');
    assert.equal((await hit('GET', '/ladwani/api/x', null, { accept: 'application/json' })).status, 401);
  });

  test('ATIP is a plain 404 for visitors and signed-in non-owners, and open to the owner', async () => {
    for (const u of [null, ASHA]) {
      as(u);
      for (const p of ['/ATIP', '/atip', '/ATIP/', '/atip/', '/ATIP/api/archive']) assert.equal((await hit('GET', p)).status, 404, `${p} as ${u && u.email}`);
    }
    as(OWNER);
    const r = await hit('GET', '/ATIP/');
    assert.equal(r.status, 200);
    assert.match(await r.text(), />ATIP</);
  });

  test('the menu hides ATIP from a non-owner', async () => {
    as(ASHA);
    const html = await (await hit('GET', '/access/request?project=edu')).text();
    assert.ok(!html.includes('>ATIP<'));
    assert.equal((html.match(/class="bk-tabs"[\s\S]*?<\/ul>/)[0].match(/<li>/g) || []).length, 5);
  });

  test('a signed-in person without permission is sent to request access', async () => {
    as(ASHA);
    const r = await hit('GET', '/ladwani/');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/access/request?project=ladwani');
    assert.equal((await hit('GET', '/access/request?project=ladwani')).status, 200);
    assert.equal((await hit('GET', '/access/request?project=atip')).status, 404);
  });

  test('request, duplicate, approve, open: the whole flow', async () => {
    as(ASHA);
    assert.equal((await hit('POST', '/hub/api/access-requests', { project: 'ladwani', role: 'karta' })).status, 201);
    assert.equal((await hit('POST', '/hub/api/access-requests', { project: 'ladwani', role: 'karta' })).status, 409);
    assert.equal((await hit('POST', '/hub/api/access-requests', { project: 'ladwani', role: 'god' })).status, 400);
    assert.equal((await hit('POST', '/hub/api/access-requests', { project: 'atip', role: 'owner' })).status, 404);
    const pending = await (await hit('GET', '/hub/api/me')).json();
    assert.equal(pending.projects.find((p) => p.key === 'ladwani').state, 'pending');

    as(RAVI); // a stranger cannot decide
    assert.equal((await hit('GET', '/hub/api/admin/requests')).status, 403);
    assert.equal((await hit('POST', '/hub/api/admin/requests/1', { decision: 'approve' })).status, 403);

    as(OWNER);
    const list = await (await hit('GET', '/hub/api/admin/requests')).json();
    assert.equal(list.requests.length, 1);
    assert.equal((await hit('POST', `/hub/api/admin/requests/${list.requests[0].id}`, { decision: 'approve' })).status, 200);
    assert.equal((await hit('POST', `/hub/api/admin/requests/${list.requests[0].id}`, { decision: 'approve' })).status, 404);

    as(ASHA);
    const r = await hit('GET', '/ladwani/dashboard');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { url: '/ladwani/dashboard' });
    const claims = verifyToken(jwks, lastSeen, { audience: 'ladwani' });
    assert.equal(claims.sub, 'u-asha'); assert.equal(claims.email, 'asha@example.com'); assert.equal(claims.role, 'karta');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM audit_log')).n >= 2, true);
  });

  test("access to LadWani does not open Education, and its token is not valid there", async () => {
    as(ASHA);
    const r = await hit('GET', '/edu/');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/access/request?project=edu');
    assert.throws(() => verifyToken(jwks, lastSeen, { audience: 'edu' }), /another project/);
  });

  test("a token the browser sends itself never reaches an app", async () => {
    as(ASHA);
    await hit('GET', '/ladwani/', null, { 'x-bkesari-token': 'forged' });
    assert.notEqual(lastSeen, 'forged');
    verifyToken(jwks, lastSeen, { audience: 'ladwani' });
  });

  test('declining leaves the person without access; revoking removes it', async () => {
    as(RAVI);
    await hit('POST', '/hub/api/access-requests', { project: 'edu', role: 'parent' });
    as(OWNER);
    const { requests } = await (await hit('GET', '/hub/api/admin/requests')).json();
    await hit('POST', `/hub/api/admin/requests/${requests[0].id}`, { decision: 'decline' });
    as(RAVI);
    assert.equal((await hit('GET', '/edu/')).status, 302);
    as(OWNER);
    const { access } = await (await hit('GET', '/hub/api/admin/access')).json();
    assert.equal((await hit('POST', `/hub/api/admin/access/${access[0].id}/revoke`, {})).status, 200);
    as(ASHA);
    assert.equal((await hit('GET', '/ladwani/')).status, 302);
  });

  test('cross-site POSTs are refused', async () => {
    as(OWNER);
    const r = await hit('POST', '/hub/api/admin/requests/1', { decision: 'approve' }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });

  test('an impossible id on the admin routes is a 404, never a 500', async () => {
    as(OWNER);
    for (const id of ['99999999999999999999', '1.5', '1e400', '-1', 'abc']) {
      assert.equal((await hit('POST', `/hub/api/admin/requests/${id}`, { decision: 'approve' })).status, 404, `decide ${id}`);
      assert.equal((await hit('POST', `/hub/api/admin/access/${id}/revoke`, {})).status, 404, `revoke ${id}`);
    }
  });

  test('/global-warming redirects permanently to /environment', async () => {
    const r = await hit('GET', '/global-warming/');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/environment/');
  });
});
