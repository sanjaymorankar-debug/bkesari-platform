/**
 * Central login, end to end through the real hub: sign-up with consent,
 * email verification, login, lockout, rate limiting, CSRF, password reset,
 * two-step sign-in and logout.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHub, client, makeUser, login, freshCode, PASSWORD } = require('./helpers/auth-harness');

let hub;
test.before(async () => { hub = await startHub(); });
test.after(async () => { await hub.close(); });
test.beforeEach(() => hub.auth.limiter.clear());

const linkIn = (mail, path) => {
  const m = new RegExp(`(https?://[^\\s]+${path.replace('/', '\\/')}\\?token=[A-Za-z0-9_-]+)`).exec(mail.text);
  assert.ok(m, `no ${path} link in mail: ${mail.text}`);
  return new URL(m[1]).pathname + new URL(m[1]).search;
};
const lastMailTo = (email) => [...hub.auth.mailer.outbox].reverse().find(m => m.to === email);

test('sign-up needs the privacy consent', async () => {
  const c = client(hub.base);
  const r = await c.post('/auth/signup', { email: 'noconsent@example.com', password: PASSWORD }, { csrfFrom: '/auth/signup' });
  assert.equal(r.status, 400);
  assert.match(r.text, /privacy notice/);
  assert.equal(await hub.auth.service.findUserByEmail('noconsent@example.com'), null);
});

test('sign-up, verify by email, then sign in; consent and audit are recorded', async () => {
  const c = client(hub.base);
  let r = await c.post('/auth/signup', { email: 'New.User@Example.com', name: 'New User', password: PASSWORD, consent: '1' });
  assert.equal(r.status, 200);
  assert.match(r.text, /Check your email/);

  const user = await hub.auth.service.findUserByEmail('new.user@example.com');
  assert.ok(user, 'stored lower-cased');
  assert.ok(user.privacy_consent_at && user.privacy_version);
  assert.match(user.password_hash, /^\$2[aby]\$12\$/);

  // Not verified yet: refused, and a fresh link is sent.
  r = await c.post('/auth/login', { email: 'new.user@example.com', password: PASSWORD });
  assert.equal(r.status, 403);
  assert.match(r.text, /Confirm your email/);

  r = await c.request(linkIn(lastMailTo('new.user@example.com'), '/auth/verify'));
  assert.equal(r.status, 200);
  assert.match(r.text, /Email confirmed/);
  r = await c.request(linkIn(lastMailTo('new.user@example.com'), '/auth/verify'));
  assert.equal(r.status, 400, 'a verification link works once');

  r = await c.post('/auth/login', { email: 'new.user@example.com', password: PASSWORD });
  assert.equal(r.status, 303);
  const me = (await c.request('/auth/api/me')).json();
  assert.equal(me.user.email, 'new.user@example.com');
  assert.deepEqual(me.roles, ['USER']);
  assert.deepEqual(me.features, []);

  const actions = (await hub.auth.audit.list({ userId: user.id })).map(a => a.action);
  for (const a of ['SIGNUP', 'EMAIL_VERIFIED', 'LOGIN_SUCCESS']) assert.ok(actions.includes(a), a);
});

test('the session cookie is HttpOnly, SameSite=Lax, path /', async () => {
  await makeUser(hub, 'cookie@example.com');
  const c = client(hub.base);
  const r = await c.post('/auth/login', { email: 'cookie@example.com', password: PASSWORD });
  const cookie = r.headers.getSetCookie().find(s => s.startsWith('bk_sso='));
  assert.ok(cookie, 'session cookie set');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Domain=/i, 'host-only');
});

test('signing up twice with one email answers exactly the same', async () => {
  await makeUser(hub, 'taken@example.com');
  const a = await client(hub.base).post('/auth/signup', { email: 'taken@example.com', password: PASSWORD, consent: '1' });
  const b = await client(hub.base).post('/auth/signup', { email: 'fresh-one@example.com', password: PASSWORD, consent: '1' });
  assert.equal(a.status, b.status);
  assert.equal(a.text.replace(/taken@example\.com/g, 'X'), b.text.replace(/fresh-one@example\.com/g, 'X'));
});

test('a form without its CSRF token is refused', async () => {
  await makeUser(hub, 'csrf@example.com');
  const c = client(hub.base);
  await c.request('/auth/login'); // has the cookie, but not the token
  const r = await c.request('/auth/login', { method: 'POST', form: { email: 'csrf@example.com', password: PASSWORD } });
  assert.equal(r.status, 403);
  const forged = await c.request('/auth/login', { method: 'POST', form: { _csrf: 'forged', email: 'csrf@example.com', password: PASSWORD } });
  assert.equal(forged.status, 403);
});

test('five wrong passwords lock the account, even against the right one', async () => {
  const user = await makeUser(hub, 'lockme@example.com');
  const c = client(hub.base);
  for (let i = 0; i < 5; i++) {
    const r = await c.post('/auth/login', { email: 'lockme@example.com', password: 'wrong password!!' });
    assert.equal(r.status, 401);
  }
  const r = await c.post('/auth/login', { email: 'lockme@example.com', password: PASSWORD });
  assert.equal(r.status, 429);
  assert.match(r.text, /Too many failed attempts/);
  const actions = (await hub.auth.audit.list({ userId: user.id })).map(a => a.action);
  assert.ok(actions.includes('ACCOUNT_LOCKED'));
  assert.equal(actions.filter(a => a === 'LOGIN_FAILED').length, 6);
});

test('logins are rate-limited per account', async () => {
  await makeUser(hub, 'ratelimited@example.com');
  const c = client(hub.base);
  let last;
  for (let i = 0; i < 11; i++) last = await c.post('/auth/login', { email: 'nobody-here@example.com', password: 'x'.repeat(12) });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});

test('password reset: one-time link, ends every session, unlocks', async () => {
  await makeUser(hub, 'reset@example.com');
  const signedIn = await login(hub, 'reset@example.com');
  assert.equal((await signedIn.request('/auth/api/me')).status, 200);

  const c = client(hub.base);
  let r = await c.post('/auth/forgot', { email: 'reset@example.com' });
  assert.match(r.text, /reset link is on its way/);
  const unknown = await client(hub.base).post('/auth/forgot', { email: 'never-registered@example.com' });
  assert.equal(unknown.text.length > 0 && unknown.status, r.status, 'same answer for unknown email');

  const path = linkIn(lastMailTo('reset@example.com'), '/auth/reset');
  const token = new URL(hub.base + path).searchParams.get('token');
  r = await c.post('/auth/reset', { token, password: 'a brand new passphrase' }, { csrfFrom: path });
  assert.equal(r.status, 200);
  assert.match(r.text, /Password changed/);
  r = await c.post('/auth/reset', { token, password: 'another new passphrase' }, { csrfFrom: path });
  assert.equal(r.status, 400, 'used once');

  assert.equal((await signedIn.request('/auth/api/me')).status, 401, 'the old session ended');
  await login(hub, 'reset@example.com', { password: 'a brand new passphrase' });
});

test('two-step sign-in: password then TOTP, a used code is refused', async () => {
  const user = await makeUser(hub, 'mfa@example.com', { mfa: true });
  const c = client(hub.base);
  let r = await c.post('/auth/login', { email: 'mfa@example.com', password: PASSWORD });
  assert.equal(r.status, 200);
  assert.match(r.text, /Enter your code/);
  assert.equal((await c.request('/auth/api/me')).status, 401, 'no session before the code');
  const pending = /name="pending" value="([^"]+)"/.exec(r.text)[1];
  const token = /name="_csrf" value="([^"]+)"/.exec(r.text)[1];
  r = await c.request('/auth/login/mfa', { method: 'POST', form: { _csrf: token, pending, code: '000000' } });
  assert.equal(r.status, 401);
  const code = await freshCode(hub, user);
  r = await c.request('/auth/login/mfa', { method: 'POST', form: { _csrf: token, pending, code } });
  assert.equal(r.status, 303);
  assert.equal((await c.request('/auth/api/me')).json().mfa, true);

  const again = client(hub.base);
  r = await again.post('/auth/login', { email: 'mfa@example.com', password: PASSWORD });
  const p2 = /name="pending" value="([^"]+)"/.exec(r.text)[1];
  const t2 = /name="_csrf" value="([^"]+)"/.exec(r.text)[1];
  r = await again.request('/auth/login/mfa', { method: 'POST', form: { _csrf: t2, pending: p2, code } });
  assert.equal(r.status, 401, 'replayed code');
});

test('a user can enrol TOTP from the account page; the owner cannot', async () => {
  await makeUser(hub, 'enrol@example.com');
  const c = await login(hub, 'enrol@example.com');
  let r = await c.post('/auth/account/mfa/begin', {}, { csrfFrom: '/auth/account' });
  assert.equal(r.status, 200);
  const secret = /class="mono" style="font-size:16px">([A-Z2-7 ]+)</.exec(r.text)[1].replace(/ /g, '');
  const totp = require('../portal/auth/totp');
  r = await c.post('/auth/account/mfa/confirm', { code: totp.codeAt(secret, totp.currentStep()) }, { csrfFrom: '/auth/account' });
  assert.equal(r.status, 303);
  const me = (await c.request('/auth/api/me')).json();
  assert.equal(me.mfa, true);

  const owner = await makeUser(hub, require('./helpers/auth-harness').OWNER_EMAIL, { roles: ['SUPER_ADMIN'] });
  const oc = await login(hub, owner.email);
  r = await oc.post('/auth/account/mfa/begin', {}, { csrfFrom: '/auth/account' });
  assert.equal(r.status, 403);
  assert.match(r.text, /from the server/);
});

test('logout ends the session and clears the cookie', async () => {
  await makeUser(hub, 'bye@example.com');
  const c = await login(hub, 'bye@example.com');
  const token = c.jar.get('bk_sso');
  const r = await c.post('/auth/logout', {}, { csrfFrom: '/auth/account' });
  assert.equal(r.status, 303);
  assert.equal(c.jar.get('bk_sso'), undefined);
  // The old token is dead on the server, not just forgotten by the browser.
  const replay = client(hub.base);
  replay.jar.set('bk_sso', token);
  assert.equal((await replay.request('/auth/api/me')).status, 401);
});

test('a suspended user is signed out and cannot sign in', async () => {
  const admin = await makeUser(hub, 'suspender@example.com', { roles: ['ADMIN'] });
  const target = await makeUser(hub, 'suspended@example.com');
  const c = await login(hub, 'suspended@example.com');
  await hub.auth.service.setUserStatus({ actor: admin, userId: target.id, status: 'SUSPENDED' });
  assert.equal((await c.request('/auth/api/me')).status, 401);
  const r = await client(hub.base).post('/auth/login', { email: 'suspended@example.com', password: PASSWORD });
  assert.equal(r.status, 403);
});

test('the privacy notice is public', async () => {
  const r = await client(hub.base).request('/auth/privacy');
  assert.equal(r.status, 200);
  assert.match(r.text, /Privacy notice/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
