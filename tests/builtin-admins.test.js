/**
 * The built-in administrators (portal/builtin-admins.js): smorankar and
 * sonalimorankar sign in with a username, and are owners in every project.
 * Drives the real createApp with a stand-in database; no PostgreSQL needed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../portal/server.js');
const { createHub, verifyToken } = require('../portal/hub.js');
const {
  createBuiltinAdmins, hashPassword, parseHash, verifyPassword, isBuiltinUser, USERNAMES, COOKIE,
} = require('../portal/builtin-admins.js');

const PASSWORD = 'test-only-builtin-password-1';
const COST = { N: 2 ** 14, r: 8, p: 1 }; // the lowest cost parseHash accepts: keeps the suite quick
const quiet = { warn() {}, error() {}, log() {} };

const HUB_PROJECTS = [
  { key: 'ladwani', name: 'LadWani', path: '/ladwani/', visibility: 'approval', roles: 'member,karta,operator,admin', sort_order: 10 },
  { key: 'atip', name: 'ATIP', path: '/ATIP/', visibility: 'owner', roles: 'owner', sort_order: 20 },
  { key: 'edu', name: 'Education', path: '/edu/', visibility: 'approval', roles: 'parent,student,teacher,school_admin,admin', sort_order: 30 },
  { key: 'tasklist', name: 'TaskList', path: '/tasks/', visibility: 'approval', roles: 'viewer,editor,owner', sort_order: 40 },
  { key: 'driving', name: 'Driving Simulator', path: '/driving-simulator/', visibility: 'open', roles: 'public', sort_order: 50 },
  { key: 'environment', name: 'Environmental Activities', path: '/environment/', visibility: 'open', roles: 'public', sort_order: 60 },
];

/** A database that knows the projects, grants no one anything, and keeps the audit rows. */
function stubDb() {
  const audit = [];
  const db = new Proxy({}, { get: (_, k) => async (sql, params) => {
    if (k === 'all' && /FROM hub_projects/.test(sql)) return HUB_PROJECTS;
    if (k === 'all' && /FROM (project_access|access_requests)/.test(sql)) return [];
    if (k === 'get' && /FROM (project_access|atip_snapshots)/.test(sql)) return null;
    if (k === 'run' && /INSERT INTO audit_log/.test(sql)) { audit.push(params); return {}; }
    throw new Error(`unexpected db.${String(k)}(${String(sql).slice(0, 60)})`);
  } });
  return { db, audit };
}

const ENV = {
  TRACKER_USER: 'tracker', TRACKER_PASSWORD: 'tracker-pw',
  ATIP_USER: 'viewer', ATIP_PASSWORD: 'viewer-pw',
  EDU_ORIGIN: '', LADWANI_ORIGIN: '', APP_ENV: '', HUB_OWNER_EMAILS: 'agtcipl@gmail.com',
};

let hashPromise;
const testHash = () => (hashPromise ||= hashPassword(PASSWORD, COST));

/** Runs `fn` against createApp with `env` on process.env and the built-in sign-in on. */
async function withHub(fn, { env = {}, extra = {}, hash } = {}) {
  const all = { ...ENV, ...env };
  const saved = {};
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; process.env[k] = all[k]; }
  const { db, audit } = stubDb();
  const passwordHash = hash === undefined ? await testHash() : hash;
  const { app } = createApp(db, { builtinAdmins: { env: { BUILTIN_ADMIN_PASSWORD_HASH: passwordHash }, log: quiet }, ...extra });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ base, audit, signIn: (username, password = PASSWORD, headers = {}) => post(base, '/auth/builtin/sign-in', { username, password }, headers) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const post = (base, path, body, headers = {}) => fetch(base + path, {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const get = (base, path, cookie, headers = {}) => fetch(base + path, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...headers } });
/** "bk_builtin=..." from a sign-in response, as a browser would send it back. */
const cookieFrom = (res) => (res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`)) || '').split(';')[0];

test('the two built-in accounts are smorankar and sonalimorankar', () => {
  assert.deepEqual(USERNAMES, ['smorankar', 'sonalimorankar']);
});

test('the repository carries no password or hash for them', async () => {
  // A public repository: the hash comes from the server's environment only.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../portal/builtin-admins.js'), 'utf8');
  assert.doesNotMatch(src, /scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{32,}/);
  assert.equal(createBuiltinAdmins({ env: {}, log: quiet }).enabled(), false);
});

test('a hash round-trips, and a malformed or too-cheap one is refused', async () => {
  const h = await testHash();
  assert.match(h, /^scrypt:16384:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.equal(h.includes('$'), false, 'no $ for an env parser to expand');
  const parsed = parseHash(h);
  assert.equal(await verifyPassword(PASSWORD, parsed), true);
  assert.equal(await verifyPassword(`${PASSWORD}x`, parsed), false);
  for (const bad of ['', 'plain-text-password', h.replace(':16384:', ':1024:'), h.replace(':16384:', ':16385:'), h.replace(/:[^:]+$/, ':AAAA'), `bcrypt${h.slice(6)}`]) {
    assert.equal(parseHash(bad), null, bad);
  }
  const warnings = [];
  assert.equal(createBuiltinAdmins({ env: { BUILTIN_ADMIN_PASSWORD_HASH: 'not-a-hash' }, log: { warn: (m) => warnings.push(m) } }).enabled(), false);
  assert.match(warnings[0], /not a valid scrypt hash/);
});

test('without the hash the built-in sign-in is off', async () => {
  await withHub(async ({ signIn, base }) => {
    const r = await signIn('smorankar');
    assert.equal(r.status, 503);
    assert.equal(cookieFrom(r), '');
    assert.deepEqual(await (await get(base, '/auth/builtin/session')).json(), { enabled: false, user: null });
  }, { hash: '' });
});

test('the right password signs either account in, and the session names it', async () => {
  await withHub(async ({ signIn, base, audit }) => {
    for (const username of USERNAMES) {
      const r = await signIn(username.toUpperCase().padStart(username.length + 2));
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).user, { username, email: `${username}@builtin.bkesari.com` });
      const set = r.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
      assert.match(set, /; HttpOnly/); assert.match(set, /; SameSite=Lax/); assert.match(set, /; Max-Age=43200/);
      const session = await (await get(base, '/auth/builtin/session', cookieFrom(r))).json();
      assert.deepEqual(session.user, { username, email: `${username}@builtin.bkesari.com` });
    }
    assert.deepEqual(audit.map((a) => [a[0], a[1]]), USERNAMES.map((u) => [`${u}@builtin.bkesari.com`, 'builtin-sign-in']));
  });
});

test('the session cookie is Secure behind HTTPS', async () => {
  await withHub(async ({ signIn }) => {
    const r = await signIn('smorankar', PASSWORD, { 'x-forwarded-proto': 'https' });
    assert.match(r.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`)), /; Secure/);
  });
});

test('a wrong password, an unknown username or an email is refused alike, and never logged as typed', async () => {
  await withHub(async ({ signIn, audit }) => {
    for (const [u, p] of [['smorankar', 'wrong-password'], ['someoneelse', PASSWORD], ['smorankar@builtin.bkesari.com', PASSWORD], ['smorankar', '']]) {
      const r = await signIn(u, p);
      assert.equal(r.status, 401, `${u} / ${p}`);
      assert.deepEqual(await r.json(), { error: 'Wrong username or password' });
      assert.equal(cookieFrom(r), '');
    }
    assert.ok(audit.every((a) => a[1] === 'builtin-sign-in-failed'));
    assert.ok(audit.every((a) => !a.join(' ').includes('wrong-password') && !a.join(' ').includes(PASSWORD)));
  });
});

test('a cross-site sign-in is refused', async () => {
  await withHub(async ({ signIn }) => {
    assert.equal((await signIn('smorankar', PASSWORD, { origin: 'https://evil.example' })).status, 403);
  });
});

test('ten failures from one client lock it out for fifteen minutes, without locking out others', async () => {
  await withHub(async ({ signIn }) => {
    const from = (ip) => ({ 'x-forwarded-for': ip });
    for (let i = 0; i < 10; i++) assert.equal((await signIn('smorankar', 'nope', from('203.0.113.9'))).status, 401);
    const locked = await signIn('smorankar', PASSWORD, from('203.0.113.9'));
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 800);
    // The first X-Forwarded-For entries are the client's to choose; only the last one counts.
    assert.equal((await signIn('smorankar', PASSWORD, from('198.51.100.1, 203.0.113.9'))).status, 429);
    assert.equal((await signIn('smorankar', PASSWORD, from('198.51.100.7'))).status, 200);
  });
});

test('a session expires after twelve hours, and a new hash ends every session', async () => {
  let now = Date.UTC(2026, 10, 4, 8);
  const hash = await testHash();
  const admins = createBuiltinAdmins({ env: { BUILTIN_ADMIN_PASSWORD_HASH: hash }, now: () => now, log: quiet });
  const req = (value) => ({ headers: { cookie: `other=1; ${COOKIE}=${value}` } });
  const value = admins.issue('smorankar');
  assert.equal(admins.currentUser(req(value)).id, 'builtin:smorankar');
  now += 12 * 60 * 60 * 1000 - 1000;
  assert.ok(admins.currentUser(req(value)));
  now += 2000;
  assert.equal(admins.currentUser(req(value)), null);
  now -= 2000;
  const rotated = createBuiltinAdmins({ env: { BUILTIN_ADMIN_PASSWORD_HASH: await hashPassword('another-password-12', COST) }, now: () => now, log: quiet });
  assert.equal(rotated.currentUser(req(value)), null);
  assert.equal(createBuiltinAdmins({ env: {}, log: quiet }).currentUser(req(value)), null, 'hash removed: sign-in off');
});

test('a tampered or forged cookie signs no one in', async () => {
  const admins = createBuiltinAdmins({ env: { BUILTIN_ADMIN_PASSWORD_HASH: await testHash() }, log: quiet });
  const req = (value) => ({ headers: { cookie: `${COOKIE}=${value}` } });
  const [payload, sig] = admins.issue('smorankar').split('.');
  const swap = Buffer.from(JSON.stringify({ u: 'sonalimorankar', exp: 9e9 })).toString('base64url');
  for (const v of [`${swap}.${sig}`, `${payload}.${sig.slice(0, -2)}AA`, payload, `${payload}.${sig}.x`, '', 'garbage']) {
    assert.equal(admins.currentUser(req(v)), null, v);
  }
  const outsider = Buffer.from(JSON.stringify({ u: 'mallory', exp: 9e9 })).toString('base64url');
  const crypto = require('node:crypto');
  // Even a correctly signed cookie names only the two built-in accounts.
  const key = crypto.createHmac('sha256', 'bkesari builtin admin session v1').update(await testHash()).digest();
  const forged = `${outsider}.${crypto.createHmac('sha256', key).update(outsider).digest('base64url')}`;
  assert.equal(admins.currentUser(req(forged)), null);
});

test('only a user object this module made is built-in; look-alike JSON from Neon Auth is not an owner', async () => {
  const lookalike = JSON.parse(JSON.stringify({ id: 'builtin:smorankar', email: 'smorankar@builtin.bkesari.com', name: 'smorankar', emailVerified: true, builtin: true }));
  assert.equal(isBuiltinUser(lookalike), false);
  const noAccess = { get: async () => null, all: async () => [] };
  const hub = createHub({ db: noAccess, getUser: async () => lookalike, env: { HUB_OWNER_EMAILS: 'agtcipl@gmail.com' }, log: quiet });
  assert.equal((await hub.whoami({ headers: {} }, {})).isOwner, false);
  assert.equal(await hub.allowsTasklist(lookalike), false);
  const admins = createBuiltinAdmins({ env: { BUILTIN_ADMIN_PASSWORD_HASH: await testHash() }, log: quiet });
  const real = admins.currentUser({ headers: { cookie: `${COOKIE}=${admins.issue('sonalimorankar')}` } });
  assert.equal(isBuiltinUser(real), true);
  const ownerHub = createHub({ db: noAccess, getUser: async () => real, env: { HUB_OWNER_EMAILS: 'agtcipl@gmail.com' }, log: quiet });
  assert.equal((await ownerHub.whoami({ headers: {} }, {})).isOwner, true);
  assert.equal(await ownerHub.allowsTasklist(real), true);
});

test('a built-in administrator is an owner: every project open at its top role, ATIP shown, access admin on', async () => {
  await withHub(async ({ signIn, base }) => {
    const cookie = cookieFrom(await signIn('smorankar'));
    const me = await (await get(base, '/hub/api/me', cookie)).json();
    assert.equal(me.owner, true);
    assert.equal(me.canAdmin, true);
    assert.deepEqual(me.user, { email: 'smorankar@builtin.bkesari.com', name: 'smorankar' });
    assert.deepEqual(me.projects.map((p) => [p.key, p.state, p.role]), [
      ['ladwani', 'open', 'admin'], ['atip', 'open', 'owner'], ['edu', 'open', 'admin'],
      ['tasklist', 'open', 'owner'], ['driving', 'open', 'public'], ['environment', 'open', 'public'],
    ]);
    // Without a cookie the same hub sees a visitor.
    const visitor = await (await get(base, '/hub/api/me')).json();
    assert.equal(visitor.user, null);
    assert.ok(!visitor.projects.some((p) => p.key === 'atip'));
  });
});

test('ATIP opens for a built-in administrator, under Neon Auth and under the Basic login alike', async () => {
  // Neon Auth (or a stand-in): the owner check.
  await withHub(async ({ signIn, base }) => {
    const cookie = cookieFrom(await signIn('sonalimorankar'));
    assert.equal((await get(base, '/ATIP/', cookie)).status, 200);
    assert.equal((await get(base, '/ATIP/')).status, 404);
  }, { extra: { getUser: async () => null } });
  // No Neon Auth: ATIP_USER/ATIP_PASSWORD, which the built-in session passes.
  await withHub(async ({ signIn, base }) => {
    const cookie = cookieFrom(await signIn('sonalimorankar'));
    assert.equal((await get(base, '/ATIP/', cookie)).status, 200);
    assert.equal((await get(base, '/ATIP/')).status, 401);
  });
});

test('the Task Tracker lets a built-in administrator in and names them', async () => {
  await withHub(async ({ signIn, base }) => {
    assert.equal((await get(base, '/tasks/api/me')).status, 401, 'Basic login still guards everyone else');
    const cookie = cookieFrom(await signIn('smorankar'));
    const r = await get(base, '/tasks/api/me', cookie);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { auth: 'builtin', email: 'smorankar@builtin.bkesari.com', name: 'smorankar' });
    assert.equal((await get(base, '/tasks/', cookie)).status, 200);
  });
});

test('LadWani and Education receive the hub\'s token for the built-in administrator, with the admin role', async () => {
  let seen = [];
  const upstream = http.createServer((req, res) => { seen.push(req.headers['x-bkesari-token'] || null); res.end('ok'); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  try {
    await withHub(async ({ signIn, base }) => {
      const jwks = await (await get(base, '/.well-known/jwks.json')).json();
      const cookie = cookieFrom(await signIn('sonalimorankar'));
      for (const project of ['ladwani', 'edu']) {
        seen = [];
        const r = await get(base, `/${project}/`, cookie);
        assert.equal(r.status, 200, project);
        const claims = verifyToken(jwks, seen[0], { audience: project });
        assert.equal(claims.sub, 'builtin:sonalimorankar');
        assert.equal(claims.email, 'sonalimorankar@builtin.bkesari.com');
        assert.equal(claims.role, 'admin');
      }
      // A visitor is still sent to sign in.
      const visitor = await get(base, '/edu/');
      assert.equal(visitor.status, 302);
      assert.match(visitor.headers.get('location'), /^\/auth\/sign-in\?next=/);
    }, { env: { LADWANI_ORIGIN: origin, EDU_ORIGIN: origin }, extra: { getUser: async () => null } });
  } finally {
    await new Promise((r) => upstream.close(r));
  }
});

test('sign-out ends the built-in session, with or without Neon Auth behind it', async () => {
  await withHub(async ({ signIn, base }) => {
    const cookie = cookieFrom(await signIn('smorankar'));
    const out = await post(base, '/api/auth/sign-out', {}, { cookie });
    assert.equal(out.status, 200);
    const cleared = out.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
    assert.match(cleared, new RegExp(`^${COOKIE}=;.*Max-Age=0`));
  });
});
