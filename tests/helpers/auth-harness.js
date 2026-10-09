/**
 * Test harness for the central login: the real hub (portal/server.js
 * createApp) on an in-memory SQLite database, a cookie-keeping HTTP client,
 * and shortcuts for putting users in known states.
 *
 * One hub per test file: node --test runs each file in its own process, and
 * the hub reads its settings from process.env.
 */
const http = require('node:http');
const totp = require('../../portal/auth/totp');
const { decrypt } = require('../../portal/auth/crypto');

const OWNER_EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery';

async function startHub(extraEnv = {}) {
  Object.assign(process.env, {
    DB_CLIENT: 'sqlite',
    SQLITE_PATH: ':memory:',
    APP_ENV: 'dev',
    AUTH_ENABLED: '1',
    AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    AUTH_OWNER_EMAIL: OWNER_EMAIL,
    AUTH_PUBLIC_URL: 'http://127.0.0.1',
    ATIP_PUBLISH_TOKEN: 'publish-token-for-tests',
    MILK_ORIGIN: '', EDU_ORIGIN: '', LADWANI_ORIGIN: '',
  }, extraEnv);
  // TEST_AUTH_MYSQL=mysql://user:pass@host:port/db runs the same suites with
  // the auth tables on MySQL / MariaDB (dropped first). CI uses SQLite.
  if (process.env.TEST_AUTH_MYSQL) {
    const u = new URL(process.env.TEST_AUTH_MYSQL);
    Object.assign(process.env, {
      AUTH_DB_CLIENT: 'mysql', AUTH_DB_HOST: u.hostname, AUTH_DB_PORT: u.port || '3306',
      AUTH_DB_NAME: u.pathname.slice(1), AUTH_DB_USER: decodeURIComponent(u.username), AUTH_DB_PASSWORD: decodeURIComponent(u.password),
    });
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'auth\\_%'");
    for (const { t } of tables) await conn.query(`DROP TABLE \`${t}\``);
    await conn.end();
  }
  // Quiet: the app logs every migration and request-level warning.
  const quiet = { log() {}, warn() {}, error() {} };
  const saved = { log: console.log, warn: console.warn };
  console.log = quiet.log; console.warn = quiet.warn;
  const { createApp } = require('../../portal/server.js');
  let built;
  try { built = await createApp(); } finally { console.log = saved.log; console.warn = saved.warn; }
  const server = http.createServer(built.app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...built,
    base,
    close: async () => {
      await new Promise(r => { server.closeAllConnections?.(); server.close(r); });
      // A MySQL pool keeps the process alive; close both connections.
      await built.auth.db.close();
      if (built.db !== built.auth.db && built.db.close) await built.db.close();
    },
  };
}

/** fetch with a cookie jar and no automatic redirects. */
function client(base) {
  const jar = new Map();
  async function request(path, { method = 'GET', form, json, headers = {} } = {}) {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const res = await fetch(path.startsWith('http') ? path : base + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some(a => /max-age=0/i.test(a)) || value === '') jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location'), json: () => JSON.parse(text) };
  }
  /** GETs a page and returns the CSRF token in its first form. */
  async function csrf(path = '/auth/login') {
    const r = await request(path);
    const m = /name="_csrf" value="([^"]+)"/.exec(r.text);
    if (!m) throw new Error(`no csrf token on ${path} (status ${r.status})`);
    return m[1];
  }
  async function post(path, form, { csrfFrom } = {}) {
    const token = await csrf(csrfFrom || path);
    return request(path, { method: 'POST', form: { _csrf: token, ...form } });
  }
  return { request, csrf, post, jar };
}

/**
 * Creates a verified user directly, with roles and subscriptions.
 * roles: ['ADMIN'] or [['MODERATOR','LADWANI']]; subs: { LADWANI: 'active' | {status, expires_at} }
 */
async function makeUser(hub, email, { roles = [], subs = {}, mfa = false, name = null, password = PASSWORD } = {}) {
  const { service, db } = hub.auth;
  const passwords = require('../../portal/auth/passwords');
  let user = await service.findUserByEmail(email);
  if (!user) {
    const { nowUtc } = require('../../portal/auth/util');
    const id = require('node:crypto').randomUUID();
    await db.run(`INSERT INTO auth_users (id, email, name, password_hash, email_verified_at, status, failed_logins, privacy_consent_at, privacy_version, created_at, updated_at)
      VALUES (?,?,?,?,?,'ACTIVE',0,?,?,?,?)`, [id, email, name, await passwords.hashPassword(password), nowUtc(), nowUtc(), 'test', nowUtc(), nowUtc()]);
    await db.run("INSERT INTO auth_user_roles (user_id, role_code, feature_code, created_at) VALUES (?, 'USER', '', ?)", [id, nowUtc()]);
    user = await service.findUserById(id);
  }
  const { nowUtc } = require('../../portal/auth/util');
  for (const r of roles) {
    const [role, feature] = Array.isArray(r) ? r : [r, ''];
    await db.run('INSERT INTO auth_user_roles (user_id, role_code, feature_code, created_at) VALUES (?,?,?,?)', [user.id, role, feature || '', nowUtc()]);
  }
  for (const [feature, v] of Object.entries(subs)) {
    const s = typeof v === 'string' ? { status: v } : v;
    await db.run(`INSERT INTO auth_subscriptions (user_id, feature_code, status, expires_at, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      [user.id, feature, s.status, s.expires_at || null, 'admin', nowUtc(), nowUtc()]);
  }
  if (mfa) {
    const { secret } = await service.beginTotpEnrollment(user, { allowOwner: true });
    await service.confirmTotpEnrollment(user, totp.codeAt(secret, totp.currentStep()));
    user = await service.findUserById(user.id);
    user.totpSecret = secret;
  }
  return user;
}

/**
 * A valid TOTP code for this user. A code works once, and tests sign the
 * same user in more often than once per 30 seconds, so this rewinds the
 * "last used step" first. Replay refusal itself is tested in auth-flows.
 */
async function freshCode(hub, user) {
  const row = await hub.auth.service.findUserById(user.id);
  const secret = decrypt(hub.auth.config.keys.encryption, row.totp_secret_enc);
  await hub.auth.db.run('UPDATE auth_users SET totp_last_step = NULL WHERE id = ?', [user.id]);
  return totp.codeAt(secret, totp.currentStep());
}

/** Signs a user in through the real form (and TOTP if enrolled). */
async function login(hub, email, { password = PASSWORD, user = null } = {}) {
  const c = client(hub.base);
  let r = await c.post('/auth/login', { email, password });
  if (r.status === 200 && /name="pending"/.test(r.text)) {
    const pending = /name="pending" value="([^"]+)"/.exec(r.text)[1];
    const token = /name="_csrf" value="([^"]+)"/.exec(r.text)[1];
    r = await c.request('/auth/login/mfa', { method: 'POST', form: { _csrf: token, pending, code: await freshCode(hub, user || await hub.auth.service.findUserByEmail(email)) } });
  }
  if (r.status !== 303) throw new Error(`login for ${email} failed: ${r.status} ${r.text.slice(0, 300)}`);
  return c;
}

module.exports = { startHub, client, makeUser, login, freshCode, OWNER_EMAIL, PASSWORD };
