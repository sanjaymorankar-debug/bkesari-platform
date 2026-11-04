/**
 * The built-in administrators (smorankar, sonalimorankar) in the hub admin and
 * TaskList, each as an account of that project's own (D-036): username + the
 * one password whose scrypt hash is BUILTIN_ADMIN_PASSWORD_HASH, the owner
 * role there, a session of that project's own, and their reserved addresses
 * closed to everyone else.
 *
 * Needs TEST_DATABASE_URL (a database it may WIPE); works in a schema of its own.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const createDb = require('../portal/db.js');
const { createApp } = require('../portal/server.js');
const { hashPassword } = require('../portal/builtin-admins.js');
const { skip, freshSchema } = require('./support/pg.js');
const { Browser } = require('./support/browser.js');

const quiet = { log() {}, warn() {}, error() {} };
const PASSWORD = 'test-only-builtin-password-1';

describe('built-in administrators on PostgreSQL', { skip }, () => {
  let db, server, base;
  const saved = {};
  const KEYS = ['APP_ENV', 'HUB_ADMIN_EMAIL', 'HUB_ADMIN_PASSWORD', 'HUB_OWNER_EMAILS', 'EDU_ORIGIN', 'LADWANI_ORIGIN', 'HUB_AUTH_SECRET', 'BUILTIN_ADMIN_PASSWORD_HASH'];

  before(async () => {
    const { url } = await freshSchema('builtin_admins');
    db = await createDb({ env: { DATABASE_URL: url }, quiet: true });
    for (const k of KEYS) saved[k] = process.env[k];
    Object.assign(process.env, {
      APP_ENV: '', EDU_ORIGIN: '', LADWANI_ORIGIN: '', HUB_ADMIN_EMAIL: '', HUB_OWNER_EMAILS: 'agtcipl@gmail.com',
      HUB_AUTH_SECRET: 'test-only-hub-secret-0123456789abcdef',
      BUILTIN_ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, { N: 2 ** 14, r: 8, p: 1 }),
    });
    const notify = () => ({ mail: async () => true });
    const made = createApp(db, { notify, log: quiet });
    server = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.end();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  async function signIn(api, identifier, password, ip) {
    const b = new Browser(base);
    const s = await b.fetch('GET', `${api}/session`);
    const r = await b.fetch('POST', `${api}/sign-in`, { json: { identifier, password }, csrf: s.json.csrf, headers: ip ? { 'x-forwarded-for': ip } : {} });
    return { b, r, csrf: r.json && r.json.csrf };
  }

  test('each signs in to the hub admin as owner, with the hub admin\'s own cookie, and ATIP opens', async () => {
    for (const name of ['smorankar', ' SonaliMorankar ']) {
      const { b, r } = await signIn('/admin/api/auth', name, PASSWORD, '203.0.113.10');
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.user.role, 'owner');
      assert.equal(r.json.user.email, `${name.trim().toLowerCase()}@builtin.bkesari.com`);
      assert.ok(b.cookies().some((c) => c.name === 'hub_admin_sid'), JSON.stringify(b.cookies().map((c) => c.name)));
      assert.equal((await b.fetch('GET', '/admin/api/state')).status, 200);
      assert.notEqual((await b.fetch('GET', '/ATIP/', { headers: { accept: 'text/html' } })).status, 404, 'the owner sees ATIP');
      // The hub admin's session is no one in TaskList: each project signs them in itself.
      assert.equal((await b.fetch('GET', '/tasklist/api/tasks')).status, 401);
    }
  });

  test('each signs in to TaskList as its owner, an account of TaskList\'s own', async () => {
    const { b, r } = await signIn('/tasklist/api/auth', 'smorankar', PASSWORD, '203.0.113.11');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.role, 'owner');
    assert.ok(b.cookies().some((c) => c.name === 'tl_sid'), JSON.stringify(b.cookies().map((c) => c.name)));
    assert.equal((await b.fetch('GET', '/tasklist/api/tasks')).status, 200);
    assert.equal((await b.fetch('GET', '/admin/api/state')).status, 401, 'TaskList\'s session opens nothing at the hub admin');
    // The same row every time, never a second one.
    await signIn('/tasklist/api/auth', 'SMORANKAR', PASSWORD, '203.0.113.11');
    const n = await db.get("SELECT COUNT(*)::int AS n FROM tl_users WHERE email = 'smorankar@builtin.bkesari.com'");
    assert.equal(n.n, 1);
  });

  test('a wrong password is refused like any wrong password, and the account cannot sign in by its address', async () => {
    const wrong = await signIn('/tasklist/api/auth', 'sonalimorankar', 'not-the-password', '203.0.113.12');
    assert.equal(wrong.r.status, 401);
    assert.equal(wrong.r.json.code, 'credentials');
    const byEmail = await signIn('/tasklist/api/auth', 'smorankar@builtin.bkesari.com', PASSWORD, '203.0.113.12');
    assert.equal(byEmail.r.status, 401, 'the built-in account has no password of its own');
  });

  test('without a valid hash the built-in sign-in is off', async () => {
    const keep = process.env.BUILTIN_ADMIN_PASSWORD_HASH;
    process.env.BUILTIN_ADMIN_PASSWORD_HASH = 'not-a-hash';
    try {
      const made = createApp(db, { notify: () => ({}), log: quiet });
      const s2 = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
      try {
        const b = new Browser(`http://127.0.0.1:${s2.address().port}`);
        const s = await b.fetch('GET', '/tasklist/api/auth/session');
        const r = await b.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'smorankar', password: PASSWORD }, csrf: s.json.csrf, headers: { 'x-forwarded-for': '203.0.113.13' } });
        assert.equal(r.status, 401);
      } finally { await new Promise((r) => s2.close(r)); }
    } finally { process.env.BUILTIN_ADMIN_PASSWORD_HASH = keep; }
  });

  test('nobody can sign up with, get a code for, reset or add a built-in address', async () => {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    const h = { 'x-forwarded-for': '203.0.113.14' };
    for (const email of ['smorankar@builtin.bkesari.com', ' Other@Builtin.Bkesari.com ']) {
      const up = await b.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'X', email, password: 'mango-tree-43' }, csrf: s.json.csrf, headers: h });
      assert.equal(up.status, 400, up.text);
      assert.equal(up.json.code, 'reserved');
      const code = await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email }, csrf: s.json.csrf, headers: h });
      assert.equal(code.json.code, 'reserved');
      const forgot = await b.fetch('POST', '/tasklist/api/auth/password/forgot', { json: { email }, csrf: s.json.csrf, headers: h });
      assert.equal(forgot.json.code, 'reserved');
    }
    // A signed-in person cannot put one on their account.
    const v = new Browser(base);
    const vs = await v.fetch('GET', '/tasklist/api/auth/session');
    // This local host is the dev tier with no SMS provider, so the code comes back on screen.
    const send = await v.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile: '9876509901', purpose: 'sign-up' }, csrf: vs.json.csrf, headers: h });
    const ok = await v.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { mobile: '9876509901', code: send.json.devCode, name: 'Someone' }, csrf: vs.json.csrf, headers: h });
    assert.equal(ok.status, 200, ok.text);
    const add = await v.fetch('POST', '/tasklist/api/auth/account', { json: { email: 'smorankar@builtin.bkesari.com' }, csrf: ok.json.csrf });
    assert.equal(add.json.code, 'reserved');
  });

  test('the built-in account cannot set a password or an email of its own in a project', async () => {
    const { b, csrf } = await signIn('/tasklist/api/auth', 'sonalimorankar', PASSWORD, '203.0.113.15');
    const r = await b.fetch('POST', '/tasklist/api/auth/account', { json: { newPassword: 'a-new-pass-2026' }, csrf });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'builtin');
    const n = await b.fetch('POST', '/tasklist/api/auth/account', { json: { name: 'Sonali' }, csrf });
    assert.equal(n.status, 200, 'a name is fine');
  });

  test('tries sent together are held to 10 per address, before any password is checked', async () => {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    const tries = await Promise.all(Array.from({ length: 14 }, () => b.fetch('POST', '/tasklist/api/auth/sign-in',
      { json: { identifier: 'smorankar', password: 'wrong-guess' }, csrf: s.json.csrf, headers: { 'x-forwarded-for': '203.0.113.16' } })));
    const counts = tries.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
    assert.deepEqual(counts, { 401: 10, 429: 4 }, JSON.stringify(counts));
    const right = await b.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'smorankar', password: PASSWORD }, csrf: s.json.csrf, headers: { 'x-forwarded-for': '203.0.113.16' } });
    assert.equal(right.status, 429, 'locked out from that address, right password or not');
  });
});
