'use strict';

/**
 * The bkesari ID and project access, end to end on PostgreSQL (D-039,
 * docs/design/bkesari-id.md): Google sign-in (a fake Google: a key pair made
 * here signs the ID tokens, its token endpoint checks PKCE), the email-code
 * fallback, the built-in administrators, requests and the admin's decisions,
 * and the gate in front of LadWani, Education and TaskList, with the signed
 * identity headers a project receives.
 *
 * Education and LadWani are played by one small upstream that records the
 * headers and cookies it is sent; for LadWani it answers with the
 * X-Bkesari-Project-State the test chooses. TaskList is the real one, in this
 * process.
 *
 * Needs TEST_DATABASE_URL (a database it may WIPE); works in a schema of its own.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');

const createDb = require('../portal/db.js');
const { createApp } = require('../portal/server.js');
const { hashPassword } = require('../portal/builtin-admins.js');
const { GOOGLE_JWKS, GOOGLE_TOKEN } = require('../portal/bkesari-id.js');
const { verifyIdentityHeaders } = require('../portal/access.js');
const { skip, freshSchema } = require('./support/pg.js');
const { Browser } = require('./support/browser.js');

const quiet = { log() {}, warn() {}, error() {} };
const CLIENT_ID = 'bk-test.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-only-google-secret';
const PROXY_SECRET = 'test-only-proxy-secret-0123456789abcdef';
const PASSWORD = 'test-only-builtin-password-2';
const ADMIN = 'admin@example.com';

describe('the bkesari ID and project access on PostgreSQL', { skip }, () => {
  let db, server, base, upstream;
  const saved = {};
  const KEYS = ['APP_ENV', 'HUB_ADMIN_EMAIL', 'HUB_ADMIN_PASSWORD', 'HUB_OWNER_EMAILS', 'HUB_ADMIN_NOTIFY_EMAILS', 'EDU_ORIGIN', 'LADWANI_ORIGIN',
    'HUB_AUTH_SECRET', 'BUILTIN_ADMIN_PASSWORD_HASH', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'HUB_PROXY_SECRET', 'MOBILE_APP_SCHEMES'];
  const outbox = [];
  const seen = []; // what the project upstream received
  let ladwaniState = null; // what LadWani says about its own verification
  let ip = 0;
  const nextIp = () => `198.51.100.${(ip += 1)}`;

  // Google: one key pair, codes issued by the test, PKCE checked at the token endpoint.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'g1', alg: 'RS256', use: 'sig' };
  const issued = new Map();
  let codeSeq = 0;
  const signToken = (claims) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'g1', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
  };
  async function fakeFetch(url, opts = {}) {
    if (String(url) === GOOGLE_JWKS) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' } });
    if (String(url) === GOOGLE_TOKEN) {
      const p = new URLSearchParams(String(opts.body));
      const it = issued.get(p.get('code'));
      issued.delete(p.get('code'));
      const challenge = crypto.createHash('sha256').update(String(p.get('code_verifier'))).digest('base64url');
      if (!it || p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== CLIENT_SECRET || challenge !== it.challenge || p.get('redirect_uri') !== it.redirect) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id_token: signToken(it.claims), access_token: 'x' }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }
  const profile = (email, over = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return { iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, sub: `sub-${email}`, email, email_verified: true, name: email.split('@')[0], iat: now, exp: now + 3600, ...over };
  };

  /** Google sign-in in this browser: start, "Google" issues a code, the callback. Returns the callback's response. */
  async function google(b, claims, start = '/auth/google/start') {
    const s = await b.fetch('GET', start);
    assert.equal(s.status, 302, s.text);
    const u = new URL(s.location);
    assert.equal(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
    const code = `code-${(codeSeq += 1)}`;
    issued.set(code, { claims: { ...claims, nonce: u.searchParams.get('nonce') }, challenge: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri') });
    return b.fetch('GET', `/auth/google/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get('state'))}`);
  }
  async function googleUser(email, over) {
    const b = new Browser(base);
    const r = await google(b, profile(email, over));
    assert.equal(r.status, 302);
    assert.doesNotMatch(r.location, /error=/, r.location);
    const me = (await b.fetch('GET', '/hub/api/me')).json;
    return { b, me, csrf: me.signOut.csrf };
  }
  async function codeUser(email) {
    const b = new Browser(base);
    const at = nextIp();
    const s = await b.fetch('GET', '/account/api/auth/session');
    const sent = await b.fetch('POST', '/account/api/auth/otp/send', { json: { email, purpose: 'sign-in' }, csrf: s.json.csrf, headers: { 'x-forwarded-for': at } });
    assert.equal(sent.status, 200, sent.text);
    const mail = outbox.filter((m) => m.to === email).pop();
    const code = /code is (\d{6})/.exec(mail.text)[1];
    const v = await b.fetch('POST', '/account/api/auth/otp/verify', { json: { email, code }, csrf: s.json.csrf, headers: { 'x-forwarded-for': at } });
    assert.equal(v.status, 200, v.text);
    return { b, csrf: v.json.csrf, mail };
  }
  const states = async (b) => Object.fromEntries((await b.fetch('GET', '/hub/api/me')).json.projects.map((p) => [p.key, p.state]));
  const html = { accept: 'text/html' };

  before(async () => {
    upstream = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        seen.push({ url: req.url, headers: { ...req.headers } });
        if (req.url.startsWith('/ladwani') && ladwaniState) res.setHeader('X-Bkesari-Project-State', ladwaniState);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = `http://127.0.0.1:${upstream.address().port}`;
    const { url } = await freshSchema('access');
    db = await createDb({ env: { DATABASE_URL: url }, quiet: true });
    for (const k of KEYS) saved[k] = process.env[k];
    Object.assign(process.env, {
      APP_ENV: '', EDU_ORIGIN: origin, LADWANI_ORIGIN: origin, HUB_ADMIN_EMAIL: '', HUB_ADMIN_PASSWORD: '',
      HUB_OWNER_EMAILS: ADMIN, HUB_ADMIN_NOTIFY_EMAILS: 'second.admin@example.com',
      HUB_AUTH_SECRET: 'test-only-hub-secret-0123456789abcdef', HUB_PROXY_SECRET: PROXY_SECRET,
      GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, MOBILE_APP_SCHEMES: '',
      BUILTIN_ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, { N: 2 ** 14, r: 8, p: 1 }),
    });
    const notify = (prefix) => ({ mail: async (to, subject, text) => { outbox.push({ prefix, to, subject, text }); return true; } });
    const made = createApp(db, { notify, log: quiet, fetch: fakeFetch });
    server = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (upstream) await new Promise((r) => upstream.close(r));
    if (db) await db.end();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('Google sign-in: one account per Google identity, a persistent session at the hub, and every failure back on the sign-in page', async () => {
    const b = new Browser(base);
    const page = await b.fetch('GET', '/auth/sign-in?next=%2Fedu%2F', { headers: html });
    assert.match(page.text, /href="\/auth\/google\/start\?next=%2Fedu%2F"/, 'the Google button, carrying where to go next');

    const r = await google(b, profile('asha@example.com', { name: 'Asha Patil', picture: 'https://lh3.example/a.png' }), '/auth/google/start?next=%2Faccount');
    assert.equal(r.location, '/account');
    const sid = b.get('bk_sid');
    assert.ok(sid && sid.httpOnly && sid.path === '/' && sid.maxAge > 86400, `a persistent HttpOnly session on Path=/ (the apps' WebViews keep it): ${sid && sid.raw}`);
    assert.equal(sid.sameSite, 'Lax');
    const me = (await b.fetch('GET', '/hub/api/me')).json;
    assert.equal(me.user.email, 'asha@example.com');
    assert.equal(me.user.role, 'member');
    assert.equal(me.user.name, 'Asha Patil');
    const row = await db.get("SELECT * FROM users WHERE email = 'asha@example.com'");
    assert.equal(row.google_sub, 'sub-asha@example.com');
    assert.equal(row.email_verified, true);
    const again = await googleUser('asha@example.com');
    assert.equal(again.me.user.id, me.user.id, 'the same account the second time');
    assert.equal((await db.get("SELECT count(*)::int AS n FROM users WHERE email = 'asha@example.com'")).n, 1);

    const fail = async (claims, code, mutate) => {
      const x = new Browser(base);
      let res;
      if (mutate) res = await mutate(x); else res = await google(x, claims);
      assert.equal(res.status, 302);
      assert.match(res.location, new RegExp(`^/auth/sign-in\\?error=google_${code}`), `${code}: ${res.location}`);
      assert.equal(x.get('bk_sid'), null, `${code}: no session`);
    };
    await fail(profile('ravi@example.com', { email_verified: false }), 'unverified');
    assert.equal(await db.get("SELECT id FROM users WHERE email = 'ravi@example.com'"), null, 'an unverified Google email makes no account');
    await fail(profile('ravi@example.com', { aud: 'another-client' }), 'failed');
    await fail(null, 'cancelled', async (x) => {
      const s = new URL((await x.fetch('GET', '/auth/google/start')).location);
      return x.fetch('GET', `/auth/google/callback?error=access_denied&state=${s.searchParams.get('state')}`);
    });
    await fail(null, 'state', async (x) => {
      await x.fetch('GET', '/auth/google/start');
      issued.set('forged', { claims: profile('ravi@example.com') });
      return x.fetch('GET', '/auth/google/callback?code=forged&state=not-the-state');
    });
    await fail(null, 'state', async (x) => x.fetch('GET', '/auth/google/callback?code=c&state=s'), 'no state cookie: a link someone else started');
    await fail(null, 'failed', async (x) => {
      const s = new URL((await x.fetch('GET', '/auth/google/start')).location);
      return x.fetch('GET', `/auth/google/callback?code=never-issued&state=${s.searchParams.get('state')}`);
    });
    // The callback works once: replaying it finds no state.
    const y = new Browser(base);
    const s = new URL((await y.fetch('GET', '/auth/google/start')).location);
    issued.set('once', { claims: { ...profile('meera@example.com'), nonce: s.searchParams.get('nonce') }, challenge: s.searchParams.get('code_challenge'), redirect: s.searchParams.get('redirect_uri') });
    const cb = `/auth/google/callback?code=once&state=${s.searchParams.get('state')}`;
    const cookieJar = y.cookieFor('/auth/google/callback');
    assert.equal((await y.fetch('GET', cb)).location, '/');
    const replay = await fetch(new URL(cb, base), { headers: { cookie: cookieJar }, redirect: 'manual' });
    assert.match(replay.headers.get('location'), /^\/auth\/sign-in\?error=google_/, 'a replayed callback, even with the old cookie, is refused (Google spends a code once)');
    assert.ok(!replay.headers.getSetCookie().some((c) => c.startsWith('bk_sid=') && !c.startsWith('bk_sid=;')), 'and opens no session');
    const refused = await db.all("SELECT detail FROM hub_auth_audit_log WHERE action = 'sign-in-refused' ORDER BY id");
    assert.ok(refused.some((a) => /unverified/.test(a.detail)) && refused.some((a) => /audience/.test(a.detail)), JSON.stringify(refused));
  });

  test('no automatic linking to an account whose email nobody confirmed; a confirmed one is linked once; built-in and suspended accounts are refused', async () => {
    await db.run("INSERT INTO users (email, email_verified, migrated_from) VALUES ('unconfirmed@example.com', FALSE, 'tasklist:9')");
    const x = new Browser(base);
    const r = await google(x, profile('unconfirmed@example.com'));
    assert.match(r.location, /error=google_unconfirmed/);
    assert.equal((await db.get("SELECT google_sub FROM users WHERE email = 'unconfirmed@example.com'")).google_sub, null);

    await db.run("INSERT INTO users (email, email_verified, name) VALUES ('confirmed@example.com', TRUE, 'Kept Name')");
    const linked = await googleUser('confirmed@example.com', { name: 'Google Name' });
    assert.equal(linked.me.user.name, 'Kept Name', 'the account\'s own name is kept');
    assert.equal((await db.get("SELECT google_sub FROM users WHERE email = 'confirmed@example.com'")).google_sub, 'sub-confirmed@example.com');
    assert.ok(await db.get("SELECT 1 FROM hub_auth_audit_log WHERE action = 'google-linked' AND actor = 'confirmed@example.com'"));
    const other = await google(new Browser(base), profile('confirmed@example.com', { sub: 'a-different-google-account' }));
    assert.match(other.location, /error=google_conflict/, 'another Google account with the same email is not let in');

    assert.match((await google(new Browser(base), profile('smorankar@builtin.bkesari.com'))).location, /error=google_builtin/);

    await db.run("INSERT INTO users (email, email_verified, google_sub, status) VALUES ('gone@example.com', TRUE, 'sub-gone@example.com', 'suspended')");
    assert.match((await google(new Browser(base), profile('gone@example.com'))).location, /error=google_status/);
  });

  test('without access: a direct address to a project goes to sign-in, then to the request page; an API gets 401 / 403', async () => {
    const anon = new Browser(base);
    assert.equal((await anon.fetch('GET', '/edu/', { headers: html })).location, '/auth/sign-in?next=%2Fedu%2F');
    assert.equal((await anon.fetch('GET', '/EDU/courses', { headers: html })).location, '/auth/sign-in?next=%2FEDU%2Fcourses', 'any spelling');
    assert.equal((await anon.fetch('GET', '/ladwani/tree', { headers: html })).location, '/auth/sign-in?next=%2Fladwani%2Ftree');
    const api = await anon.fetch('GET', '/tasklist/api/tasks');
    assert.equal(api.status, 401);
    assert.equal(api.json.signIn, '/auth/sign-in?next=%2Ftasklist%2Fapi%2Ftasks');
    assert.equal((await anon.fetch('POST', '/edu/login', { json: {} })).status, 401);
    assert.equal(seen.filter((s) => !s.url.startsWith('/ladwani/_next/')).length, 0, 'nothing reached a project');
    // LadWani's build files are the one exemption: they hold no one's data.
    assert.equal((await anon.fetch('GET', '/ladwani/_next/static/chunk.js')).status, 200);

    const { b } = await googleUser('noaccess@example.com');
    assert.equal((await b.fetch('GET', '/edu/', { headers: html })).location, '/access/request?project=edu');
    const denied = await b.fetch('GET', '/tasklist/api/tasks');
    assert.equal(denied.status, 403);
    assert.equal(denied.json.request, '/access/request?project=tasklist');
    assert.deepEqual(await states(b), { ladwani: 'request', edu: 'request', tasklist: 'request', driving: 'open', environment: 'open' });
    assert.equal(seen.filter((s) => !s.url.startsWith('/ladwani/_next/')).length, 0);
    // The open projects need nothing.
    assert.notEqual((await anon.fetch('GET', '/driving/', { headers: html })).status, 302);
  });

  test('request → approve (with a role) → access: the project gets signed headers, never the client\'s, and never the hub\'s session', async () => {
    const asha = await googleUser('request@example.com', { name: 'आशा पाटील' });
    const b = asha.b;
    const page = await b.fetch('GET', '/access/request?project=edu', { headers: html });
    assert.equal(page.status, 200);
    assert.match(page.text, /data-access-request="edu"/);
    assert.match(page.text, /<option value="teacher">/);
    const csrf = /name="bk-csrf" content="([^"]+)"/.exec(page.text)[1];

    assert.equal((await b.fetch('POST', '/hub/api/access/requests', { json: { project: 'edu', role: 'teacher' } })).status, 403, 'no CSRF token');
    assert.equal((await b.fetch('POST', '/hub/api/access/requests', { json: { project: 'edu', role: 'superuser' }, csrf })).status, 400);
    assert.equal((await b.fetch('POST', '/hub/api/access/requests', { json: { project: 'driving', role: 'x' }, csrf })).status, 404, 'an open project is not asked for');
    outbox.length = 0;
    const made = await b.fetch('POST', '/hub/api/access/requests', { json: { project: 'edu', role: 'teacher', note: 'I teach class 7' }, csrf });
    assert.equal(made.status, 201, made.text);
    assert.equal((await b.fetch('POST', '/hub/api/access/requests', { json: { project: 'edu', role: 'parent' }, csrf })).status, 409, 'one pending request per project');
    assert.deepEqual(outbox.map((m) => m.to).sort(), [ADMIN, 'second.admin@example.com'], 'the admins are told');
    assert.match(outbox[0].text, /request@example\.com.*Education.*teacher/s);
    assert.match(outbox[0].text, /Decide at http:\/\/127\.0\.0\.1:\d+\/admin\/access/);
    assert.equal((await states(b)).edu, 'pending');

    // The person is no admin.
    assert.equal((await b.fetch('GET', '/admin/access', { headers: html })).status, 404);
    assert.equal((await b.fetch('POST', `/hub/api/admin/access/requests/${made.json.id}/approve`, { json: {}, csrf })).status, 403);

    const admin = await googleUser(ADMIN);
    assert.equal(admin.me.user.role, 'admin', 'a confirmed address on HUB_OWNER_EMAILS');
    assert.equal(admin.me.admin, true);
    const queue = await admin.b.fetch('GET', '/admin/access', { headers: html });
    assert.equal(queue.status, 200);
    assert.match(queue.text, /request@example\.com/);
    assert.match(queue.text, /I teach class 7/);
    assert.match(queue.text, / IST</, 'times in IST');
    assert.match(queue.text, /aria-label="1 waiting">1</, 'the pending badge');
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/requests/${made.json.id}/approve`, { json: { role: 'student' } })).status, 403, 'CSRF here too');
    outbox.length = 0;
    const ok = await admin.b.fetch('POST', `/hub/api/admin/access/requests/${made.json.id}/approve`, { json: { role: 'student' }, csrf: admin.csrf });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, 'request@example.com');
    assert.match(outbox[0].subject, /approved/);
    assert.match(outbox[0].text, /as student/);
    const log = await db.get("SELECT * FROM audit_log WHERE action = 'approve' ORDER BY id DESC LIMIT 1");
    assert.equal(log.actor, ADMIN);
    assert.match(log.detail, /role student \(asked for teacher\)/);
    assert.equal((await states(b)).edu, 'approved');

    // Through the gate, with forged identity headers and the hub's cookies.
    seen.length = 0;
    const res = await b.fetch('GET', '/edu/dashboard?x=1', {
      headers: { ...html, 'x-bkesari-role': 'admin', 'x-bkesari-user': '1', 'x-bkesari-sig': 'forged', 'x-bkesari-project-state': 'verified' },
    });
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    const got = seen[0];
    assert.equal(got.url, '/dashboard?x=1', 'Education gets its own path');
    const idn = verifyIdentityHeaders(PROXY_SECRET, got.headers, 'edu');
    assert.ok(idn, `signed: ${JSON.stringify(got.headers)}`);
    assert.deepEqual(idn, { userId: asha.me.user.id, email: 'request@example.com', role: 'student', name: 'आशा पाटील', project: 'edu' });
    assert.equal(got.headers['x-bkesari-project-state'], undefined);
    assert.doesNotMatch(String(got.headers.cookie || ''), /bk_sid/, 'the hub\'s session stays at the hub');
    assert.equal(verifyIdentityHeaders(PROXY_SECRET, got.headers, 'ladwani'), null, 'not usable at another project');

    // The profile page: role, who approved and when, in IST.
    const account = await b.fetch('GET', '/account', { headers: html });
    assert.match(account.text, /Education/);
    assert.match(account.text, new RegExp(ADMIN.replace('.', '\\.')));
    assert.match(account.text, /\d{2} \w{3} \d{4}, \d{2}:\d{2} (AM|PM) IST/);

    // Change the role: the next request carries the new one, read from the database.
    const grant = await db.get("SELECT id FROM project_access WHERE email = 'request@example.com' AND project_key = 'edu'");
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/grants/${grant.id}/role`, { json: { role: 'nobody' }, csrf: admin.csrf })).status, 400);
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/grants/${grant.id}/role`, { json: { role: 'teacher' }, csrf: admin.csrf })).status, 200);
    seen.length = 0;
    await b.fetch('GET', '/edu/', { headers: html });
    assert.equal(verifyIdentityHeaders(PROXY_SECRET, seen[0].headers, 'edu').role, 'teacher');
    assert.ok(await db.get("SELECT 1 FROM audit_log WHERE action = 'change-role' AND detail = 'student -> teacher'"));
  });

  test('decline (with a reason), revoke and suspend each shut the next request; a declined person may ask again after 24 hours; the email code still works', async () => {
    const ravi = await codeUser('ravi.code@example.com');
    assert.match(ravi.mail.text, /This is your bkesari ID/);
    assert.ok(ravi.b.get('bk_sid'), 'the email code signs in to the bkesari ID');
    const admin = await googleUser(ADMIN);
    const ask = async () => ravi.b.fetch('POST', '/hub/api/access/requests', { json: { project: 'tasklist', role: 'editor' }, csrf: ravi.csrf });
    const first = await ask();
    assert.equal(first.status, 201);

    const declineUrl = `/hub/api/admin/access/requests/${first.json.id}/decline`;
    assert.equal((await admin.b.fetch('POST', declineUrl, { json: { reason: '  ' }, csrf: admin.csrf })).status, 400, 'a reason is required');
    outbox.length = 0;
    assert.equal((await admin.b.fetch('POST', declineUrl, { json: { reason: 'Not on the team yet' }, csrf: admin.csrf })).status, 200);
    assert.match(outbox[0].text, /Reason: Not on the team yet/);
    const me = (await ravi.b.fetch('GET', '/hub/api/me')).json.projects.find((p) => p.key === 'tasklist');
    assert.equal(me.state, 'declined');
    assert.equal(me.reason, 'Not on the team yet');
    const soon = await ask();
    assert.equal(soon.status, 429);
    assert.match(soon.json.error, /after \d{2} \w{3} \d{4}, \d{2}:\d{2} (AM|PM) IST/);
    assert.equal((await ravi.b.fetch('GET', '/tasklist/api/tasks')).status, 403);
    await db.run("UPDATE access_requests SET decided_at = decided_at - interval '25 hours' WHERE id = $1", [first.json.id]);
    const second = await ask();
    assert.equal(second.status, 201, '24 hours on, the person may ask again');

    // Filters on the admin's queue.
    const declined = (await admin.b.fetch('GET', '/hub/api/admin/access/requests?status=declined&project=tasklist')).json;
    assert.deepEqual(declined.requests.map((r) => Number(r.id)), [Number(first.json.id)]);
    assert.ok(declined.pending >= 1);

    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/requests/${second.json.id}/approve`, { json: {}, csrf: admin.csrf })).status, 200);
    const tasks = await ravi.b.fetch('GET', '/tasklist/api/tasks');
    assert.equal(tasks.status, 200, 'TaskList opens on the bkesari ID, no second sign-in');
    const tl = await db.get("SELECT * FROM tl_users WHERE email = 'ravi.code@example.com'");
    const hubUser = await db.get("SELECT id FROM users WHERE email = 'ravi.code@example.com'");
    assert.equal(tl.hub_user_id, String(hubUser.id));
    const list = await ravi.b.fetch('POST', '/tasklist/api/lists', { json: { name: 'Mine' }, csrf: ravi.csrf });
    assert.ok([200, 201].includes(list.status), list.text);
    assert.equal((await ravi.b.fetch('POST', '/tasklist/api/lists', { json: { name: 'x' } })).status, 403, 'TaskList checks the hub session\'s CSRF token');

    const grant = await db.get("SELECT id FROM project_access WHERE email = 'ravi.code@example.com' AND project_key = 'tasklist'");
    outbox.length = 0;
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/grants/${grant.id}/revoke`, { json: { reason: 'Left the team' }, csrf: admin.csrf })).status, 200);
    assert.equal((await ravi.b.fetch('GET', '/tasklist/api/tasks')).status, 403, 'revoked: shut on the very next request');
    assert.equal((await states(ravi.b)).tasklist, 'revoked');
    assert.match(outbox[0].text, /Reason: Left the team/);

    // A direct grant (no request), then suspension.
    const rid = hubUser.id;
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/users/${rid}/grant`, { json: { project: 'tasklist', role: 'viewer' }, csrf: admin.csrf })).status, 200);
    assert.equal((await ravi.b.fetch('GET', '/tasklist/api/tasks')).status, 200);
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/users/${rid}/status`, { json: { status: 'suspended' }, csrf: admin.csrf })).status, 200);
    assert.equal((await ravi.b.fetch('GET', '/tasklist/api/tasks')).status, 401, 'suspended: every session ends at once');
    assert.equal((await ravi.b.fetch('GET', '/hub/api/me')).json.user, null);
    const back = await ravi.b.fetch('POST', '/account/api/auth/otp/send', { json: { email: 'ravi.code@example.com' }, csrf: (await ravi.b.fetch('GET', '/account/api/auth/session')).json.csrf, headers: { 'x-forwarded-for': nextIp() } });
    assert.equal(back.status, 200, 'the answer does not tell whether the account exists');
    const code = /code is (\d{6})/.exec(outbox.filter((m) => m.to === 'ravi.code@example.com').pop().text)[1];
    const v = await ravi.b.fetch('POST', '/account/api/auth/otp/verify', { json: { email: 'ravi.code@example.com', code }, csrf: (await ravi.b.fetch('GET', '/account/api/auth/session')).json.csrf });
    assert.equal(v.status, 403, 'a suspended person cannot sign back in');
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/users/${admin.me.user.id}/status`, { json: { status: 'suspended' }, csrf: admin.csrf })).status, 403, 'nor can the admin suspend themself');
    for (const action of ['decline', 'revoke', 'grant', 'suspend']) assert.ok(await db.get('SELECT 1 FROM audit_log WHERE action = $1', [action]), `${action} is in audit_log`);
  });

  test('LadWani: "approved — awaiting LadWani verification" until LadWani says verified; its header never reaches the browser', async () => {
    const { b, csrf, me } = await googleUser('family@example.com');
    const admin = await googleUser(ADMIN);
    const r = await b.fetch('POST', '/hub/api/access/requests', { json: { project: 'ladwani', role: 'member' }, csrf });
    outbox.length = 0;
    await admin.b.fetch('POST', `/hub/api/admin/access/requests/${r.json.id}/approve`, { json: {}, csrf: admin.csrf });
    assert.match(outbox[0].text, /LadWani will also verify/);
    assert.equal((await states(b)).ladwani, 'awaiting');
    const page = await b.fetch('GET', '/account', { headers: html });
    assert.match(page.text, /awaiting LadWani verification/i);

    seen.length = 0;
    ladwaniState = 'pending';
    const first = await b.fetch('GET', '/ladwani/api/v1/auth/session', { headers: { 'x-bkesari-project-state': 'verified' } });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-bkesari-project-state'), null, 'removed before the response leaves the hub');
    assert.equal(seen[0].headers['x-bkesari-project-state'], undefined, 'the client\'s own is removed before LadWani sees the request');
    assert.equal(verifyIdentityHeaders(PROXY_SECRET, seen[0].headers, 'ladwani').userId, me.user.id);
    assert.equal((await states(b)).ladwani, 'awaiting');

    ladwaniState = 'verified';
    const second = await b.fetch('GET', '/ladwani/api/v1/auth/session');
    assert.equal(second.headers.get('x-bkesari-project-state'), null);
    for (let i = 0; i < 20 && (await states(b)).ladwani !== 'approved'; i += 1) await new Promise((res) => setTimeout(res, 25));
    assert.equal((await states(b)).ladwani, 'approved', 'LadWani verified the person: fully open');
    assert.ok(await db.get("SELECT 1 FROM audit_log WHERE action = 'project-state' AND detail = 'verified'"));
    ladwaniState = 'nonsense';
    await b.fetch('GET', '/ladwani/api/v1/auth/session');
    await new Promise((res) => setTimeout(res, 50));
    assert.equal((await db.get("SELECT project_state FROM project_access WHERE email = 'family@example.com'")).project_state, 'verified', 'only verified or pending is believed');
    ladwaniState = null;
  });

  test('the built-in administrators are owners at the hub: every project opens with its top role, ATIP too, and they decide requests', async () => {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/account/api/auth/session');
    const r = await b.fetch('POST', '/account/api/auth/sign-in', { json: { identifier: 'smorankar', password: PASSWORD }, csrf: s.json.csrf, headers: { 'x-forwarded-for': nextIp() } });
    assert.equal(r.status, 200, r.text);
    const me = (await b.fetch('GET', '/hub/api/me')).json;
    assert.equal(me.user.role, 'owner');
    assert.ok(me.projects.filter((p) => p.visibility === 'approval').every((p) => p.state === 'approved'), JSON.stringify(me.projects));
    seen.length = 0;
    await b.fetch('GET', '/edu/', { headers: html });
    await b.fetch('GET', '/ladwani/api/v1/auth/session');
    assert.equal(verifyIdentityHeaders(PROXY_SECRET, seen[0].headers, 'edu').role, 'admin', 'Education\'s top role');
    assert.equal(verifyIdentityHeaders(PROXY_SECRET, seen[1].headers, 'ladwani').role, 'admin', 'LadWani\'s top role, never "owner"');
    assert.equal((await b.fetch('GET', '/tasklist/api/tasks')).status, 200);
    assert.equal((await db.get("SELECT role FROM tl_users WHERE email = 'smorankar@builtin.bkesari.com'")).role, 'owner');
    assert.equal((await b.fetch('GET', '/admin/access', { headers: html })).status, 200);
    assert.notEqual((await b.fetch('GET', '/ATIP/', { headers: html })).status, 404, 'the owner sees ATIP');
    const owner = await db.get("SELECT id FROM users WHERE email = 'smorankar@builtin.bkesari.com'");
    const admin = await googleUser(ADMIN);
    assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/users/${owner.id}/status`, { json: { status: 'suspended' }, csrf: admin.csrf })).status, 403);
    // Their addresses are reserved: no code for them, and a wrong password is refused.
    const code = await b.fetch('POST', '/account/api/auth/otp/send', { json: { email: 'smorankar@builtin.bkesari.com' }, csrf: r.json.csrf });
    assert.equal(code.status, 400);
    const x = new Browser(base);
    const xs = await x.fetch('GET', '/account/api/auth/session');
    assert.equal((await x.fetch('POST', '/account/api/auth/sign-in', { json: { identifier: 'sonalimorankar', password: 'wrong' }, csrf: xs.json.csrf, headers: { 'x-forwarded-for': nextIp() } })).status, 401);
    // No password sign-up for anyone else: the bkesari ID is Google or the email code.
    assert.equal((await x.fetch('POST', '/account/api/auth/sign-up', { json: { email: 'new@example.com', password: 'Some-password-123' }, csrf: xs.json.csrf })).status, 403);
  });

  test('the mobile app: Google in the system browser, a two-minute code back to the app, its own session in the WebView', async () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const browser = new Browser(base);
    assert.equal((await browser.fetch('GET', `/mobile-auth/start?challenge=${challenge}&app=evil.app`, { headers: html })).status, 400, 'only the bkesari app\'s scheme');
    assert.equal((await browser.fetch('GET', '/mobile-auth/start?challenge=short&app=in.bkesari.app', { headers: html })).status, 400);
    const start = await browser.fetch('GET', `/mobile-auth/start?challenge=${challenge}&app=in.bkesari.app`, { headers: html });
    assert.equal(start.location, '/auth/google/start?next=%2Fmobile-auth%2Fcomplete');
    const cb = await google(browser, profile('phone@example.com'), start.location);
    assert.equal(cb.location, '/mobile-auth/complete');
    const done = await browser.fetch('GET', '/mobile-auth/complete', { headers: html });
    assert.equal(done.status, 200);
    const link = /href="(in\.bkesari\.app:\/\/auth-callback\?code=[^"]+)"/.exec(done.text)[1].replace(/&amp;/g, '&');
    const code = new URL(link).searchParams.get('code');

    const app = new Browser(base); // the app's WebView: no cookies from the system browser
    assert.match((await app.fetch('GET', `/mobile-auth/finish?code=${encodeURIComponent(code)}&verifier=${crypto.randomBytes(32).toString('base64url')}`)).location, /error=google_failed/, 'another verifier');
    const fin = await app.fetch('GET', `/mobile-auth/finish?code=${encodeURIComponent(code)}&verifier=${verifier}`);
    assert.equal(fin.location, '/');
    assert.equal((await app.fetch('GET', '/hub/api/me')).json.user.email, 'phone@example.com');
    assert.ok(app.get('bk_sid').maxAge > 86400, 'persistent, so the app stays signed in');

    // A failed Google sign-in goes back to the app with the reason, not to the hub's page in the system browser.
    const again = new Browser(base);
    const s2 = await again.fetch('GET', `/mobile-auth/start?challenge=${challenge}&app=in.bkesari.app`, { headers: html });
    const failed = await google(again, profile('phone@example.com', { email_verified: false }), s2.location);
    assert.equal(failed.location, '/mobile-auth/complete?error=unverified');
    const page = await again.fetch('GET', failed.location, { headers: html });
    assert.match(page.text, /in\.bkesari\.app:\/\/auth-callback\?error=unverified/);

    // The sign-in page inside the app sends Google to the app's own start screen; other WebViews get no Google button.
    const ua = (s) => ({ ...html, 'user-agent': s });
    const android = await new Browser(base).fetch('GET', '/auth/sign-in', { headers: ua('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 bkesariApp/1.1.0 (android)') });
    assert.match(android.text, /href="https:\/\/localhost\/\?google=1"/);
    const ios = await new Browser(base).fetch('GET', '/auth/sign-in', { headers: ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 bkesariApp/1.1.0 (ios)') });
    assert.match(ios.text, /href="capacitor:\/\/localhost\/\?google=1"/);
    const webview = await new Browser(base).fetch('GET', '/auth/sign-in', { headers: ua('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36') });
    assert.doesNotMatch(webview.text, /hub-google/);
    assert.match(webview.text, /id="si-send"/, 'the email code is still there');
  });

  test('an address nobody confirmed is no one\'s identity in a project: an account made by SMS code that adds someone else\'s email opens nothing of theirs', async () => {
    // Someone's TaskList account from before D-039: a confirmed email, not yet linked to a hub user.
    const victim = await db.get("INSERT INTO tl_users (email, name, role, email_verified) VALUES ('victim.tl@example.com', 'Victim', 'member', TRUE) RETURNING id");
    // Another person makes a bkesari ID with a mobile code (dev shows it), then puts the victim's address on it.
    const x = new Browser(base);
    const at = nextIp();
    const s = await x.fetch('GET', '/account/api/auth/session');
    const sent = await x.fetch('POST', '/account/api/auth/otp/send', { json: { mobile: '9876500111' }, csrf: s.json.csrf, headers: { 'x-forwarded-for': at } });
    assert.equal(sent.status, 200, sent.text);
    const v = await x.fetch('POST', '/account/api/auth/otp/verify', { json: { mobile: '9876500111', code: sent.json.devCode }, csrf: s.json.csrf, headers: { 'x-forwarded-for': at } });
    assert.equal(v.status, 200, v.text);
    const csrf = v.json.csrf;
    await x.fetch('POST', '/account/api/auth/account', { json: { email: 'victim.tl@example.com' }, csrf });
    const hubUser = await db.get('SELECT id, email, email_verified FROM users WHERE mobile = $1', ['9876500111']);
    assert.equal(hubUser.email_verified, false, 'the address was added, not confirmed');

    // The admin is never shown that address as a request...
    const asked = await x.fetch('POST', '/hub/api/access/requests', { json: { project: 'tasklist', role: 'viewer' }, csrf });
    assert.equal(asked.status, 403, asked.text);
    assert.equal(asked.json.code, 'unconfirmed');
    // ...and even a direct grant puts nobody's account in their hands.
    const admin = await googleUser(ADMIN);
    for (const project of ['tasklist', 'edu']) {
      const role = project === 'edu' ? 'student' : 'viewer';
      assert.equal((await admin.b.fetch('POST', `/hub/api/admin/access/users/${hubUser.id}/grant`, { json: { project, role }, csrf: admin.csrf })).status, 200);
    }
    seen.length = 0;
    const tasks = await x.fetch('GET', '/tasklist/api/tasks');
    assert.equal(tasks.status, 403, tasks.text);
    assert.equal(tasks.json.code, 'unconfirmed');
    assert.equal((await x.fetch('GET', '/tasklist/', { headers: html })).location, '/account');
    assert.equal((await x.fetch('GET', '/edu/', { headers: html })).location, '/account');
    assert.equal(seen.length, 0, 'no identity headers reached a project');
    assert.equal((await db.get('SELECT hub_user_id FROM tl_users WHERE id = $1', [victim.id])).hub_user_id, null, 'the victim\'s TaskList account is not linked to them');
  });
});
