/**
 * TaskList end to end on a real PostgreSQL: its own accounts (mobile + OTP,
 * email + password, lockout, CSRF, its own cookie), the person's lists and
 * tasks and nobody else's, and isolation from the hub admin.
 *
 * Needs TEST_DATABASE_URL (a database it may WIPE); works in a schema of its
 * own there (tests/support/pg.js). Skipped without it, which CI counts as a
 * failure.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const createDb = require('../portal/db.js');
const { createApp } = require('../portal/server.js');
const { skip, freshSchema } = require('./support/pg.js');
const { Browser } = require('./support/browser.js');
const quick = require('../portal/public/tasklist/quickadd.js');

const quiet = { log() {}, warn() {}, error() {} };

describe('TaskList on PostgreSQL', { skip }, () => {
  let db, server, base, hub;
  const sent = { sms: [], mail: [] };
  const lastCode = (mobile) => { const m = [...sent.sms].reverse().find((x) => x.to === mobile); return m && m.text.match(/\b(\d{6})\b/)[1]; };
  const lastLink = (email) => { const m = [...sent.mail].reverse().find((x) => x.to === email); return m && m.text.match(/https?:\/\/\S+/)[0]; };
  const saved = {};

  before(async () => {
    const { url } = await freshSchema('tasklist');
    db = await createDb({ env: { DATABASE_URL: url }, quiet: true });
    for (const k of ['APP_ENV', 'HUB_ADMIN_EMAIL', 'HUB_ADMIN_PASSWORD', 'HUB_OWNER_EMAILS', 'EDU_ORIGIN', 'LADWANI_ORIGIN', 'HUB_AUTH_SECRET']) saved[k] = process.env[k];
    Object.assign(process.env, { APP_ENV: '', EDU_ORIGIN: '', LADWANI_ORIGIN: '', HUB_ADMIN_EMAIL: 'agtcipl@gmail.com', HUB_ADMIN_PASSWORD: 'Owner-pass-123', HUB_OWNER_EMAILS: 'agtcipl@gmail.com', HUB_AUTH_SECRET: 'test-only-hub-secret-0123456789abcdef' });
    const notify = () => ({
      sms: async (to, text) => { sent.sms.push({ to, text }); return true; },
      mail: async (to, subject, text) => { sent.mail.push({ to, subject, text }); return true; },
    });
    const made = createApp(db, { notify, log: quiet });
    hub = made.hub;
    await hub.bootstrapAdmin();
    server = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.end();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  // Opens the server's database connections, as on a busy server, before requests sent
  // together: with a cold pool all but one of them wait for a connection, which hides a race.
  const warm = () => Promise.all(Array.from({ length: 10 }, () => new Browser(base).fetch('GET', '/tasklist/api/auth/me', { headers: { cookie: `tl_sid=${'x'.repeat(40)}` } })));

  // A browser at its own address (the hub trusts X-Forwarded-For from loopback), so a test's sends
  // and sign-ups count against that person's limits, not the 127.0.0.1 budget the other tests share.
  function from(ip) {
    const b = new Browser(base);
    const f = b.fetch.bind(b);
    b.fetch = (method, path, o = {}) => f(method, path, { ...o, headers: { 'x-forwarded-for': ip, ...(o.headers || {}) } });
    return b;
  }

  async function signUpByOtp(mobile, name) {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    const send = await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile, purpose: 'sign-up' }, csrf: s.json.csrf });
    assert.equal(send.status, 200, send.text);
    const v = await b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { mobile, code: lastCode(mobile.replace(/\D/g, '').slice(-10)), name }, csrf: s.json.csrf });
    assert.equal(v.status, 200, v.text);
    b.csrf = v.json.csrf;
    return b;
  }

  test('a visitor is sent to TaskList\'s own sign-in page, and its API answers 401', async () => {
    const b = new Browser(base);
    const app = await b.fetch('GET', '/tasklist/', { headers: { accept: 'text/html' } });
    assert.equal(app.status, 302);
    assert.equal(app.location, '/tasklist/sign-in');
    const deep = await b.fetch('GET', '/tasklist/board', { headers: { accept: 'text/html' } });
    assert.equal(deep.location, '/tasklist/sign-in?next=%2Ftasklist%2Fboard');
    const page = await b.fetch('GET', '/tasklist/sign-in', { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
    assert.match(page.text, /This is a separate account for TaskList\./);
    assert.equal((await b.fetch('GET', '/tasklist/api/tasks')).status, 401);
    const me = await b.fetch('GET', '/tasklist/api/auth/me');
    assert.equal(me.status, 200, 'signed out is not an error');
    assert.deepEqual(me.json, { user: null, signInUrl: '/tasklist/sign-in' });
  });

  test('the old Task Tracker addresses move to TaskList; its API is gone', async () => {
    const b = new Browser(base);
    assert.equal((await b.fetch('GET', '/tasks/')).location, '/tasklist/');
    assert.equal((await b.fetch('GET', '/tasks/12')).location, '/tasklist/');
    assert.equal((await b.fetch('GET', '/tasklist')).location, '/tasklist/');
    const api = await b.fetch('GET', '/tasks/api/overview');
    assert.equal(api.status, 410);
    assert.match(api.json.error, /TaskList/);
  });

  test('mobile + OTP: a new number gets an account, a session cookie of TaskList\'s own, and nothing is echoed when SMS is live', async () => {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    assert.equal(s.json.user, null);
    assert.match(s.json.csrf, /^[A-Za-z0-9_-]{20,}$/);
    // No CSRF token: refused before anything is sent.
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile: '9876500001' } })).status, 403);
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile: '12345' }, csrf: s.json.csrf })).status, 400);
    const send = await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile: '+91 98765 00001', purpose: 'sign-up' }, csrf: s.json.csrf });
    assert.equal(send.status, 200);
    assert.equal(send.json.devCode, undefined, 'a delivered code is never also shown');
    const code = lastCode('9876500001');
    assert.match(code, /^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { mobile: '9876500001', code: wrong }, csrf: s.json.csrf });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /4 tries left/);
    const ok = await b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { mobile: '9876500001', code, name: 'Sanjay' }, csrf: s.json.csrf });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.user.mobile, '9876500001');
    assert.equal(ok.json.created, true);
    const sid = b.get('tl_sid');
    assert.ok(sid, 'tl_sid is set');
    assert.equal(sid.path, '/tasklist');
    assert.equal(sid.httpOnly, true);
    assert.equal(sid.sameSite, 'Lax');
    assert.equal(sid.secure, false, 'plain http to localhost only; Secure everywhere else');
    assert.notEqual(ok.json.csrf, s.json.csrf, 'the signed-in session has a token of its own');
    // The code is single use.
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { mobile: '9876500001', code }, csrf: ok.json.csrf })).status, 400);
    const stored = await db.get("SELECT token_hash FROM tl_sessions WHERE token_hash = encode(sha256($1::bytea), 'hex')", [sid.value]);
    assert.ok(stored, 'only the hash of the session token is stored');
  });

  test('a code takes 5 guesses at most and is spent once, even when the requests arrive together', async () => {
    const verify = (b, mobile, code, csrf, i) => b.fetch('POST', '/tasklist/api/auth/otp/verify',
      // Each from its own address: the per-address limit is not what may stop them.
      { json: { mobile, code, name: 'Race' }, csrf, headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
    await warm();
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile: '9876500060', purpose: 'sign-up' }, csrf: s.json.csrf })).status, 200);
    const code = lastCode('9876500060');
    const wrong = code === '000000' ? '111111' : '000000';
    const guesses = await Promise.all(Array.from({ length: 10 }, (_, i) => verify(b, '9876500060', wrong, s.json.csrf, i)));
    const checked = guesses.filter((r) => r.status === 400 && r.json.code === 'code').length;
    assert.ok(checked <= 5, `${checked} of 10 guesses sent together were checked against one code`);
    assert.deepEqual(guesses.filter((r) => !(r.status === 400 && r.json.code === 'code')).map((r) => [r.status, r.json.code]),
      Array(10 - checked).fill([429, 'tries']), 'the rest are told there are no tries left');
    const row = await db.get("SELECT attempts FROM tl_otp_codes WHERE target = '9876500060' ORDER BY id DESC LIMIT 1");
    assert.ok(row.attempts <= 5, `the code counted ${row.attempts} tries`);
    assert.equal((await verify(b, '9876500060', code, s.json.csrf, 10)).status, 429, 'after 5 wrong guesses even the right code is refused');

    // The right code five times at once: one account and one session, not several.
    const c = new Browser(base);
    const s2 = await c.fetch('GET', '/tasklist/api/auth/session');
    assert.equal((await c.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile: '9876500061', purpose: 'sign-up' }, csrf: s2.json.csrf })).status, 200);
    const code2 = lastCode('9876500061');
    await warm();
    const both = await Promise.all([20, 21, 22, 23, 24].map((i) => verify(c, '9876500061', code2, s2.json.csrf, i)));
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 400, 400, 400, 400], both.map((r) => `${r.status} ${r.text}`).join(' | '));
    assert.ok(both.filter((r) => r.status === 400).every((r) => r.json.code === 'expired'), 'the others find the code spent');
    const n = await db.get("SELECT (SELECT COUNT(*) FROM tl_users WHERE mobile = '9876500061') AS users, (SELECT COUNT(*) FROM tl_sessions s JOIN tl_users u ON u.id = s.user_id WHERE u.mobile = '9876500061') AS sessions");
    assert.deepEqual(n, { users: 1, sessions: 1 });
  });

  test('on test and production without a provider a code is refused, never shown on screen; only dev shows it', async (t) => {
    const made = createApp(db, { notify: () => ({}), log: quiet });
    const s2 = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
    t.after(() => new Promise((r) => s2.close(r)));
    const b = new Browser(`http://127.0.0.1:${s2.address().port}`);
    // An address with an account, so a reset link would be made (the nobox addresses below have none).
    const lb = new Browser(b.base);
    const ls = await lb.fetch('GET', '/tasklist/api/auth/session');
    assert.equal((await lb.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'Link', email: 'linkbox@example.com', password: 'linkbox-pass-1' }, csrf: ls.json.csrf })).status, 201);
    let i = 0;
    for (const tierName of ['prod', 'test']) {
      process.env.APP_ENV = tierName;
      try {
        const s = await b.fetch('GET', '/tasklist/api/auth/session');
        for (const to of [{ mobile: `98765000${20 + i}` }, { email: `nobox${i}@example.com` }]) {
          i += 1;
          const r = await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: to, csrf: s.json.csrf });
          assert.equal(r.status, 503, `${tierName} ${JSON.stringify(to)}: ${r.text}`);
          assert.equal(r.json.devCode, undefined);
          assert.doesNotMatch(r.text, /\b\d{6}\b/, 'no code anywhere in the answer');
        }
        const f = await b.fetch('POST', '/tasklist/api/auth/password/forgot', { json: { email: 'nobox0@example.com' }, csrf: s.json.csrf });
        assert.equal(f.json.devResetLink, undefined);
        // A reset for an account that exists, and a new password account: no link in either answer.
        const fr = await b.fetch('POST', '/tasklist/api/auth/password/forgot', { json: { email: 'linkbox@example.com' }, csrf: s.json.csrf });
        assert.equal(fr.status, 503, `${tierName} forgot: ${fr.text}`);
        assert.equal(fr.json.devResetLink, undefined);
        assert.doesNotMatch(fr.text, /token=|https?:/, 'no reset link anywhere in the answer');
        const nb = new Browser(b.base);
        const ns = await nb.fetch('GET', '/tasklist/api/auth/session');
        const up = await nb.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'New', email: `newbox-${tierName}@example.com`, password: 'newbox-pass-1' }, csrf: ns.json.csrf });
        assert.equal(up.status, 201, up.text);
        assert.equal(up.json.devVerifyLink, undefined);
        assert.doesNotMatch(up.text, /token=|https?:/, 'no confirmation link anywhere in the answer');
      } finally {
        process.env.APP_ENV = '';
      }
    }
    // dev (here: a local address) shows it, since nothing could deliver it.
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    for (const to of [{ mobile: '9876500002' }, { email: 'devbox@example.com' }]) {
      const r = await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: to, csrf: s.json.csrf });
      assert.equal(r.status, 200);
      assert.match(r.json.devCode, /^\d{6}$/);
    }
  });

  test('on dev a mail provider that fails is "could not send": the code is shown only when no mail is set (D-029)', async (t) => {
    const failing = () => ({ mail: async () => { throw new Error('535 authentication failed'); } });
    const made = createApp(db, { notify: failing, log: quiet });
    const s2 = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
    t.after(() => new Promise((r) => s2.close(r)));
    const b = new Browser(`http://127.0.0.1:${s2.address().port}`);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    const r = await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'failbox@example.com', purpose: 'sign-up' }, csrf: s.json.csrf, headers: { 'x-forwarded-for': '203.0.113.20' } });
    assert.equal(r.status, 503, r.text);
    assert.equal(r.json.devCode, undefined);
    assert.doesNotMatch(r.text, /\b\d{6}\b/, 'no code anywhere in the answer');
  });

  test('an email nobody has confirmed opens nothing by code: whoever put it on the account keeps no way into what its owner saves', async () => {
    // Someone signs up with another person's address and a password of their own (nothing proves the address).
    const atk = from('203.0.113.21');
    let s = await atk.fetch('GET', '/tasklist/api/auth/session');
    const made = await atk.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'Meera', email: 'meera.pre@example.com', password: 'not-meeras-pass-1' }, csrf: s.json.csrf });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json.user.emailVerified, false);
    // Later the person who reads that inbox asks for a code: it arrives, but signs in to nothing.
    const codeFor = (to) => [...sent.mail].reverse().find((m) => m.to === to && /code/.test(m.subject)).text.match(/\b(\d{6})\b/)[1];
    const owner = from('203.0.113.22');
    s = await owner.fetch('GET', '/tasklist/api/auth/session');
    assert.equal((await owner.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'meera.pre@example.com', purpose: 'sign-up' }, csrf: s.json.csrf })).status, 200);
    const v = await owner.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'meera.pre@example.com', code: codeFor('meera.pre@example.com'), name: 'Meera' }, csrf: s.json.csrf });
    assert.equal(v.status, 403, v.text);
    assert.equal(v.json.code, 'unconfirmed');
    assert.match(v.json.error, /Forgot password/);
    assert.equal((await owner.fetch('GET', '/tasklist/api/auth/me')).json.user, null, 'no session');
    // Once the address is confirmed (here by its link), the code signs in as usual.
    const confirm = sent.mail.find((m) => m.to === 'meera.pre@example.com' && /^Confirm/.test(m.subject)).text.match(/token=([\w-]+)/)[1];
    assert.equal((await owner.fetch('POST', '/tasklist/api/auth/verify-email', { json: { token: confirm }, csrf: s.json.csrf })).status, 200);
    assert.equal((await owner.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'meera.pre@example.com' }, csrf: s.json.csrf })).status, 200);
    const ok = await owner.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'meera.pre@example.com', code: codeFor('meera.pre@example.com') }, csrf: s.json.csrf });
    assert.equal(ok.status, 200, ok.text);

    // The same for an address added to an account in its settings (also unconfirmed).
    const mob = from('203.0.113.23');
    const ms = await mob.fetch('GET', '/tasklist/api/auth/session');
    assert.equal((await mob.fetch('POST', '/tasklist/api/auth/otp/send', { json: { mobile: '9876500071', purpose: 'sign-up' }, csrf: ms.json.csrf })).status, 200);
    const mv = await mob.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { mobile: '9876500071', code: lastCode('9876500071'), name: 'Mobile person' }, csrf: ms.json.csrf });
    assert.equal(mv.status, 200, mv.text);
    const add = await mob.fetch('POST', '/tasklist/api/auth/account', { json: { email: 'added.pre@example.com' }, csrf: mv.json.csrf });
    assert.equal(add.status, 200, add.text);
    const o2 = from('203.0.113.24');
    const s3 = await o2.fetch('GET', '/tasklist/api/auth/session');
    assert.equal((await o2.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'added.pre@example.com' }, csrf: s3.json.csrf })).status, 200);
    const v2 = await o2.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'added.pre@example.com', code: codeFor('added.pre@example.com') }, csrf: s3.json.csrf });
    assert.equal(v2.status, 403, v2.text);
    assert.equal(v2.json.code, 'unconfirmed');
    const n = await db.get("SELECT COUNT(*)::int AS sessions FROM tl_sessions s JOIN tl_users u ON u.id = s.user_id WHERE u.email IN ('meera.pre@example.com', 'added.pre@example.com')");
    assert.equal(n.sessions, 3, 'the two sign-ups\' own sessions and the one after confirming; none from a refused code');
  });

  test('email codes sent together: 5 an hour per address, and 5 guesses at one code', async () => {
    const b = from('203.0.113.25');
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    await warm();
    const sends = await Promise.all(Array.from({ length: 9 }, () => b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'race.mail@example.com', purpose: 'sign-up' }, csrf: s.json.csrf })));
    assert.deepEqual(sends.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 429, 429, 429, 429], sends.map((r) => `${r.status} ${r.text}`).join(' | '));
    assert.equal(sent.mail.filter((m) => m.to === 'race.mail@example.com').length, 5, 'five emails, not more');
    const code = [...sent.mail].reverse().find((m) => m.to === 'race.mail@example.com').text.match(/\b(\d{6})\b/)[1];
    const wrong = (k) => String((Number(code) + 1 + k) % 1000000).padStart(6, '0');
    await warm();
    const guesses = await Promise.all(Array.from({ length: 10 }, (_, k) => b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'race.mail@example.com', code: wrong(k) }, csrf: s.json.csrf })));
    const checked = guesses.filter((r) => r.status === 400 && r.json.code === 'code').length;
    assert.ok(checked <= 5, `${checked} of 10 guesses sent together were checked against one code`);
    const row = await db.get("SELECT attempts FROM tl_otp_codes WHERE target = 'race.mail@example.com' ORDER BY id DESC LIMIT 1");
    assert.ok(row.attempts <= 5, `the code counted ${row.attempts} tries`);
    const late = await b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'race.mail@example.com', code }, csrf: s.json.csrf });
    assert.notEqual(late.status, 200, 'after 5 wrong guesses even the right code is refused');
  });

  test('email + code: a new address gets an account; the code goes by email only, works once and takes 5 guesses', async () => {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    assert.equal(s.json.smsLive, true, 'this suite has a fake SMS provider');
    assert.equal(s.json.mailLive, true);
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'not-an-email' }, csrf: s.json.csrf })).status, 400);
    const send = await b.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: ' Kavya.Code@Example.com ', purpose: 'sign-up' }, csrf: s.json.csrf });
    assert.equal(send.status, 200, send.text);
    assert.equal(send.json.devCode, undefined, 'a delivered code is never also shown');
    const mail = [...sent.mail].reverse().find((m) => m.to === 'kavya.code@example.com');
    assert.ok(mail, 'the code went to the address, lower-cased');
    assert.match(mail.subject, /^\d{6} is your TaskList code$/);
    assert.match(mail.text, /This is a separate account for TaskList\./);
    const code = mail.text.match(/\b(\d{6})\b/)[1];
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'kavya.code@example.com', code: wrong }, csrf: s.json.csrf });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /4 tries left/);
    const ok = await b.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'KAVYA.CODE@example.com', code, name: 'Kavya' }, csrf: s.json.csrf });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.created, true);
    assert.equal(ok.json.user.email, 'kavya.code@example.com');
    const row = await db.get("SELECT email_verified, mobile FROM tl_users WHERE email = 'kavya.code@example.com'");
    assert.deepEqual(row, { email_verified: true, mobile: null });
    const again = await new Browser(base).fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'kavya.code@example.com', code } });
    assert.notEqual(again.status, 200, 'the same code never signs in twice');

    // A second sign-in by code finds the same account.
    const b2 = new Browser(base);
    const s2 = await b2.fetch('GET', '/tasklist/api/auth/session');
    await b2.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'kavya.code@example.com' }, csrf: s2.json.csrf });
    const code2 = [...sent.mail].reverse().find((m) => m.to === 'kavya.code@example.com').text.match(/\b(\d{6})\b/)[1];
    const in2 = await b2.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'kavya.code@example.com', code: code2 }, csrf: s2.json.csrf });
    assert.equal(in2.status, 200, in2.text);
    assert.equal(in2.json.created, false);
    assert.equal(in2.json.user.id, ok.json.user.id);

    // Five wrong guesses use the code up.
    await b2.fetch('POST', '/tasklist/api/auth/otp/send', { json: { email: 'kavya.code@example.com' }, csrf: s2.json.csrf });
    const code3 = [...sent.mail].reverse().find((m) => m.to === 'kavya.code@example.com').text.match(/\b(\d{6})\b/)[1];
    const miss = code3 === '222222' ? '333333' : '222222';
    for (let k = 0; k < 5; k += 1) await b2.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'kavya.code@example.com', code: miss }, csrf: s2.json.csrf });
    const late = await b2.fetch('POST', '/tasklist/api/auth/otp/verify', { json: { email: 'kavya.code@example.com', code: code3 }, csrf: s2.json.csrf });
    assert.notEqual(late.status, 200, 'the right code after 5 misses is refused');
  });

  test('cross-site and non-JSON requests are refused', async () => {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    const evil = await b.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'a@b.co', password: 'x' }, csrf: s.json.csrf, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const form = await b.fetch('POST', '/tasklist/api/auth/sign-in', { body: 'identifier=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': s.json.csrf } });
    assert.equal(form.status, 415);
  });

  test('email + password: sign up, sign in, and 5 wrong passwords lock the account for 15 minutes', async () => {
    const b = new Browser(base);
    let s = await b.fetch('GET', '/tasklist/api/auth/session');
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'Asha', email: 'asha@example.com', password: '12345678' }, csrf: s.json.csrf })).status, 400, 'numbers only');
    const up = await b.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'Asha', email: 'Asha@Example.com', password: 'mango-tree-42' }, csrf: s.json.csrf });
    assert.equal(up.status, 201, up.text);
    assert.equal(up.json.user.email, 'asha@example.com');
    assert.ok(lastLink('asha@example.com').includes('/tasklist/verify?token='), 'a verification email went out');
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'A', email: 'asha@example.com', password: 'mango-tree-42' }, csrf: up.json.csrf })).status, 409);
    await b.fetch('POST', '/tasklist/api/auth/sign-out', { json: {}, csrf: up.json.csrf });
    assert.equal(b.get('tl_sid'), null, 'signing out clears the cookie');

    const other = new Browser(base);
    s = await other.fetch('GET', '/tasklist/api/auth/session');
    for (let i = 1; i <= 4; i++) {
      const r = await other.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'asha@example.com', password: 'wrong-guess' }, csrf: s.json.csrf });
      assert.equal(r.status, 401, `attempt ${i}`);
    }
    const fifth = await other.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'asha@example.com', password: 'wrong-guess' }, csrf: s.json.csrf });
    assert.equal(fifth.status, 423);
    assert.match(fifth.json.error, /15 minutes/);
    const right = await other.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'asha@example.com', password: 'mango-tree-42' }, csrf: s.json.csrf });
    assert.equal(right.status, 423, 'the right password does not open a locked account');
    const lock = await db.get("SELECT EXTRACT(EPOCH FROM (locked_until - now())) / 60 AS minutes FROM tl_users WHERE email = 'asha@example.com'");
    assert.ok(lock.minutes > 14 && lock.minutes <= 15, `locked for ${lock.minutes} minutes`);
    // An unknown address answers like a wrong password, not "no such account".
    const unknown = await other.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'nobody@example.com', password: 'whatever-1' }, csrf: s.json.csrf });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json.error, 'That email/mobile and password do not match.');
  });

  test('wrong passwords sent together are no more than 5 tries either', async (t) => {
    // The database a network round trip away, as Neon is: here every query is
    // sub-millisecond, and bcrypt's own time then spaces the requests out.
    const later = (fn) => async (...a) => { await new Promise((r) => setTimeout(r, 15)); return fn(...a); };
    const remote = { ...db, get: later(db.get), run: later(db.run), all: later(db.all) };
    const made = createApp(remote, { notify: () => ({ sms: async () => true, mail: async () => true }), log: quiet });
    const s3 = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
    t.after(() => new Promise((r) => s3.close(r)));
    const at = `http://127.0.0.1:${s3.address().port}`;
    const b = new Browser(at);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    const up = await b.fetch('POST', '/tasklist/api/auth/sign-up', { json: { name: 'Ravi', email: 'ravi@example.com', password: 'mango-tree-43' }, csrf: s.json.csrf, headers: { 'x-forwarded-for': '203.0.113.90' } });
    assert.equal(up.status, 201, up.text);
    const o = new Browser(at);
    const so = await o.fetch('GET', '/tasklist/api/auth/session');
    await warm();
    // Nine at once, each from its own address (the per-address limit is not what may stop them).
    const tries = await Promise.all(Array.from({ length: 9 }, (_, i) => o.fetch('POST', '/tasklist/api/auth/sign-in',
      { json: { identifier: 'ravi@example.com', password: `wrong-guess-${i}` }, csrf: so.json.csrf, headers: { 'x-forwarded-for': `203.0.113.${100 + i}` } })));
    assert.ok(tries.every((r) => r.status === 401 || r.status === 423), tries.map((r) => r.status).join(','));
    const row = await db.get(`SELECT u.failed_attempts, u.locked_until > now() AS locked,
      (SELECT COUNT(*) FROM tl_audit_log a WHERE a.user_id = u.id AND a.action = 'sign-in-failed') AS checked FROM tl_users u WHERE u.email = 'ravi@example.com'`);
    assert.ok(row.checked <= 5 && row.failed_attempts <= 5, `${row.checked} of 9 passwords sent together were checked (failed_attempts ${row.failed_attempts})`);
    assert.equal(row.locked, true, 'and the account is locked');
    const right = await o.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'ravi@example.com', password: 'mango-tree-43' }, csrf: so.json.csrf, headers: { 'x-forwarded-for': '203.0.113.120' } });
    assert.equal(right.status, 423, 'the right password does not open it either');
    assert.match(right.json.error, /1[45] minutes/);
  });

  test('forgot password: same answer for any address, a single-use link, and every old session ends', async () => {
    const owner = await signUpByOtp('9876500003', 'Meera');
    await owner.fetch('POST', '/tasklist/api/auth/account', { json: { email: 'meera@example.com' }, csrf: owner.csrf });
    const b = new Browser(base);
    const s = await b.fetch('GET', '/tasklist/api/auth/session');
    const none = await b.fetch('POST', '/tasklist/api/auth/password/forgot', { json: { email: 'nobody@example.com' }, csrf: s.json.csrf });
    const some = await b.fetch('POST', '/tasklist/api/auth/password/forgot', { json: { email: 'meera@example.com' }, csrf: s.json.csrf });
    assert.deepEqual(none.json, { sent: true });
    assert.deepEqual(some.json, { sent: true });
    const token = new URL(lastLink('meera@example.com')).searchParams.get('token');
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/password/reset', { json: { token, password: 'short' }, csrf: s.json.csrf })).status, 400);
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/password/reset', { json: { token, password: 'new-pass-word-9' }, csrf: s.json.csrf })).status, 200);
    assert.equal((await b.fetch('POST', '/tasklist/api/auth/password/reset', { json: { token, password: 'new-pass-word-9' }, csrf: s.json.csrf })).status, 400, 'single use');
    assert.equal((await owner.fetch('GET', '/tasklist/api/tasks')).status, 401, 'the old session ended');
    const r = await b.fetch('POST', '/tasklist/api/auth/sign-in', { json: { identifier: 'meera@example.com', password: 'new-pass-word-9' }, csrf: s.json.csrf });
    assert.equal(r.status, 200);
  });

  test('tasks belong to their person: another account sees, edits and deletes none of them', async () => {
    const a = await signUpByOtp('9876500010', 'A');
    const b = await signUpByOtp('9876500011', 'B');
    const list = await a.fetch('POST', '/tasklist/api/lists', { json: { name: 'GoKesari' }, csrf: a.csrf });
    assert.equal(list.status, 201);
    const t = await a.fetch('POST', '/tasklist/api/tasks', { json: { title: 'Call vendor', due_date: '2026-11-04', due_time: '17:00', tags: ['#GoKesari', 'calls'], priority: 3, list_id: list.json.id }, csrf: a.csrf });
    assert.equal(t.status, 201, t.text);
    assert.deepEqual([t.json.due_date, t.json.due_time, t.json.priority, t.json.tags, t.json.list_id], ['2026-11-04', '17:00', 3, ['gokesari', 'calls'], list.json.id]);
    assert.equal((await b.fetch('GET', `/tasklist/api/tasks/${t.json.id}`)).status, 404);
    assert.equal((await b.fetch('PATCH', `/tasklist/api/tasks/${t.json.id}`, { json: { title: 'mine now' }, csrf: b.csrf })).status, 404);
    await b.fetch('DELETE', `/tasklist/api/tasks/${t.json.id}`, { csrf: b.csrf });
    assert.equal((await a.fetch('GET', `/tasklist/api/tasks/${t.json.id}`)).json.title, 'Call vendor', 'B\'s delete touched nothing');
    assert.equal((await b.fetch('POST', '/tasklist/api/tasks', { json: { title: 'x', list_id: list.json.id }, csrf: b.csrf })).status, 400, 'nor can B file into A\'s list');
    assert.equal((await b.fetch('GET', '/tasklist/api/tasks')).json.tasks.length, 0);
    assert.equal((await a.fetch('GET', '/tasklist/api/tasks?tag=gokesari')).json.tasks.length, 1);
    // A row from the old shared tracker belongs to no one until migrated.
    await db.run("INSERT INTO tasks (title, status, created_at, updated_at) VALUES ('legacy', 'Not Started', '2026-10-01 00:00:00', '2026-10-01 00:00:00')");
    assert.ok(!(await a.fetch('GET', '/tasklist/api/tasks?status=all')).json.tasks.some((x) => x.title === 'legacy'));
    // A signed-in request without the session's CSRF token is refused.
    assert.equal((await a.fetch('POST', '/tasklist/api/tasks', { json: { title: 'no token' } })).status, 403);
  });

  test('quick add parses the line in IST; a retried offline create never makes a second copy', async () => {
    const a = await signUpByOtp('9876500020', 'Q');
    await a.fetch('POST', '/tasklist/api/lists', { json: { name: 'Home' }, csrf: a.csrf });
    const r = await a.fetch('POST', '/tasklist/api/quick-add', { json: { text: 'Pay electricity bill tomorrow 5pm #home !high @Home' }, csrf: a.csrf });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.task.title, 'Pay electricity bill');
    assert.equal(r.json.task.due_date, quick.nextDue(quick.istDay(Date.now()), 'daily'));
    assert.equal(r.json.task.due_time, '17:00');
    assert.deepEqual(r.json.task.tags, ['home']);
    assert.equal(r.json.task.priority, 3);
    assert.ok(r.json.task.list_id, 'filed into @Home');
    const body = { title: 'Made offline', client_id: 'c-offline-1' };
    const first = await a.fetch('POST', '/tasklist/api/tasks', { json: body, csrf: a.csrf });
    const again = await a.fetch('POST', '/tasklist/api/tasks', { json: body, csrf: a.csrf });
    assert.equal(again.json.id, first.json.id);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM tasks WHERE client_id = 'c-offline-1'")).n, 1);
  });

  test('a repeating task, completed, brings the next one; the board keeps order; sub-tasks and updates', async () => {
    const a = await signUpByOtp('9876500030', 'R');
    const t = await a.fetch('POST', '/tasklist/api/tasks', { json: { title: 'Standup', due_date: '2026-11-06', recurrence: 'weekdays' }, csrf: a.csrf });
    const done = await a.fetch('PATCH', `/tasklist/api/tasks/${t.json.id}`, { json: { status: 'Completed' }, csrf: a.csrf });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.nextDue, '2026-11-09', 'Friday -> Monday');
    assert.ok(done.json.completed_at);
    const open = (await a.fetch('GET', '/tasklist/api/tasks')).json.tasks;
    assert.ok(open.some((x) => x.title === 'Standup' && x.due_date === '2026-11-09' && x.recurrence === 'weekdays'));
    assert.equal((await a.fetch('GET', '/tasklist/api/tasks?status=done')).json.tasks[0].title, 'Standup');

    const ids = [];
    for (const title of ['one', 'two', 'three']) ids.push((await a.fetch('POST', '/tasklist/api/tasks', { json: { title }, csrf: a.csrf })).json.id);
    const moved = await a.fetch('POST', '/tasklist/api/board/move', { json: { status: 'In Progress', ids: [ids[2], ids[0]] }, csrf: a.csrf });
    assert.equal(moved.status, 200, moved.text);
    const doing = (await a.fetch('GET', '/tasklist/api/tasks')).json.tasks.filter((x) => x.status === 'In Progress').sort((x, y) => x.position - y.position);
    assert.deepEqual(doing.map((x) => x.title), ['three', 'one']);
    assert.equal((await a.fetch('POST', '/tasklist/api/board/move', { json: { status: 'Nope', ids } , csrf: a.csrf })).status, 400);

    const sub = await a.fetch('POST', '/tasklist/api/tasks', { json: { title: 'find the number', parent_id: ids[0] }, csrf: a.csrf });
    assert.equal(sub.status, 201);
    await a.fetch('POST', `/tasklist/api/tasks/${ids[0]}/comments`, { json: { body: 'Called, no answer' }, csrf: a.csrf });
    const full = await a.fetch('GET', `/tasklist/api/tasks/${ids[0]}`);
    assert.equal(full.json.subtask_count, 1);
    assert.equal(full.json.subtasks[0].title, 'find the number');
    assert.equal(full.json.comments[0].body, 'Called, no answer');
    assert.match(full.json.comments[0].created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'stamped by the server, in UTC');
    for (const bad of [{ due_date: '2026-02-30' }, { due_time: '25:00' }, { priority: 9 }, { tags: ['a b'] }, { attachments: [{ url: 'javascript:alert(1)' }] }, { recurrence: 'hourly' }, { title: '' }]) {
      const r = await a.fetch('PATCH', `/tasklist/api/tasks/${ids[1]}`, { json: bad, csrf: a.csrf });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal((await a.fetch('GET', '/tasklist/api/tasks/abc')).status, 404);
  });

  test('download my data, then delete my account: everything of mine goes, nothing of anyone else\'s', async () => {
    const a = await signUpByOtp('9876500040', 'D');
    const keep = await signUpByOtp('9876500041', 'K');
    await a.fetch('POST', '/tasklist/api/tasks', { json: { title: 'mine' }, csrf: a.csrf });
    await keep.fetch('POST', '/tasklist/api/tasks', { json: { title: 'theirs' }, csrf: keep.csrf });
    const out = await a.fetch('GET', '/tasklist/api/export');
    assert.equal(out.status, 200);
    assert.deepEqual(out.json.tasks.map((x) => x.title), ['mine']);
    assert.equal((await a.fetch('POST', '/tasklist/api/account/delete', { json: { confirm: 'yes' }, csrf: a.csrf })).status, 400);
    assert.equal((await a.fetch('POST', '/tasklist/api/account/delete', { json: { confirm: 'DELETE' }, csrf: a.csrf })).status, 200);
    assert.equal(await db.get("SELECT id FROM tl_users WHERE mobile = '9876500040'"), null);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM tasks WHERE title = 'mine'")).n, 0);
    assert.equal((await keep.fetch('GET', '/tasklist/api/tasks')).json.tasks[0].title, 'theirs');
  });

  test('accounts are isolated: TaskList\'s session opens nothing at the hub, the hub admin\'s nothing in TaskList', async () => {
    const t = await signUpByOtp('9876500050', 'Iso');
    assert.equal((await t.fetch('GET', '/admin/api/state')).status, 401);
    assert.equal((await t.fetch('GET', '/ATIP/')).status, 404);
    const admin = new Browser(base);
    const s = await admin.fetch('GET', '/admin/api/auth/session');
    const signIn = await admin.fetch('POST', '/admin/api/auth/sign-in', { json: { identifier: 'agtcipl@gmail.com', password: 'Owner-pass-123' }, csrf: s.json.csrf });
    assert.equal(signIn.status, 200, signIn.text);
    assert.equal(admin.get('hub_admin_sid').path, '/');
    assert.equal((await admin.fetch('GET', '/tasklist/api/tasks')).status, 401, 'the hub admin is no one in TaskList');
    // Signing out of TaskList leaves the hub admin signed in, and the other way round.
    const both = new Browser(base);
    for (const c of [...t.cookies(), ...admin.cookies()]) both.jar.set(`${c.name}|${c.path}`, c);
    await both.fetch('POST', '/tasklist/api/auth/sign-out', { json: {}, csrf: t.csrf });
    assert.equal((await both.fetch('GET', '/tasklist/api/tasks')).status, 401);
    assert.equal((await both.fetch('GET', '/admin/api/state')).status, 200, 'still the hub admin');
  });
});
