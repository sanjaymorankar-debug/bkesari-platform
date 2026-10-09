/**
 * RBAC and the admin panel, through the real routes: who may open the panel,
 * who may change whose role, subscription approval and revocation, and the
 * audit trail each change leaves.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHub, client, makeUser, login, freshCode, OWNER_EMAIL } = require('./helpers/auth-harness');

let hub;
let owner, admin, mod, user;
test.before(async () => {
  hub = await startHub();
  owner = await makeUser(hub, OWNER_EMAIL, { roles: ['SUPER_ADMIN'], mfa: true });
  admin = await makeUser(hub, 'admin@example.com', { roles: ['ADMIN'], mfa: true });
  mod = await makeUser(hub, 'mod@example.com', { roles: [['MODERATOR', 'LADWANI']], mfa: true });
  user = await makeUser(hub, 'user@example.com');
});
test.after(async () => { await hub.close(); });
test.beforeEach(() => hub.auth.limiter.clear());

/**
 * Admin pages want TOTP on the session; sign in with it. One browser per
 * user: a TOTP code works once, so signing in again within the same
 * 30 seconds would (correctly) be refused.
 */
const browsers = new Map();
async function signIn(u) {
  if (!browsers.has(u.id)) browsers.set(u.id, await login(hub, u.email, { user: u }));
  return browsers.get(u.id);
}
const formToken = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];

async function adminPost(c, path, form) {
  const page = await c.request(path.replace(/\/(roles|subscriptions|status)$/, ''));
  return c.request(path, { method: 'POST', form: { _csrf: formToken(page.text), ...form } });
}

test('logged out: the admin panel sends you to sign in', async () => {
  const r = await client(hub.base).request('/auth/admin');
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/auth\/login\?return_to=%2Fauth%2Fadmin/);
});

test('USER and MODERATOR get 403 from the admin panel', async () => {
  for (const u of [user, mod]) {
    const r = await (await signIn(u)).request('/auth/admin');
    assert.equal(r.status, 403, u.email);
  }
});

test('an admin without TOTP on this session is asked for a code first', async () => {
  const c = client(hub.base);
  // Password only: the login form asks for the code, so build the session directly.
  const { token } = await hub.auth.service.createSession(admin, { mfa: false });
  c.jar.set('bk_sso', token);
  const r = await c.request('/auth/admin');
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/auth\/step-up/);
  const post = await c.request(`/auth/admin/users/${user.id}/roles`, { method: 'POST', form: { role: 'MODERATOR', feature: 'LADWANI', action: 'grant' } });
  assert.equal(post.status, 403);
  // Step up, then the panel opens.
  const step = await c.request('/auth/step-up?return_to=/auth/admin');
  const s = await c.request('/auth/step-up', { method: 'POST', form: { _csrf: formToken(step.text), return_to: '/auth/admin', code: await freshCode(hub, admin) } });
  assert.equal(s.status, 303);
  assert.equal((await c.request('/auth/admin')).status, 200);
});

test('ADMIN lists users and grants a moderator role; it is audited', async () => {
  const c = await signIn(admin);
  const list = await c.request('/auth/admin');
  assert.equal(list.status, 200);
  assert.match(list.text, /user@example\.com/);
  const r = await adminPost(c, `/auth/admin/users/${user.id}/roles`, { role: 'MODERATOR', feature: 'TASKLIST', action: 'grant' });
  assert.equal(r.status, 303);
  assert.match(r.location, /info=Role%20granted/);
  const roles = await hub.auth.service.rolesOf(user.id);
  assert.ok(roles.some(x => x.role_code === 'MODERATOR' && x.feature_code === 'TASKLIST'));
  const log = await hub.auth.audit.list({ action: 'ROLE_GRANTED', userId: user.id });
  assert.equal(log[0].actor_user_id, admin.id);
  // and back
  await adminPost(c, `/auth/admin/users/${user.id}/roles`, { role: 'MODERATOR', feature: 'TASKLIST', action: 'revoke' });
  assert.ok(!(await hub.auth.service.rolesOf(user.id)).some(x => x.role_code === 'MODERATOR'));
});

test('an admin cannot change their own role', async () => {
  const c = await signIn(admin);
  const r = await adminPost(c, `/auth/admin/users/${admin.id}/roles`, { role: 'ADMIN', action: 'revoke' });
  assert.match(decodeURIComponent(r.location), /cannot change your own role/);
  assert.ok((await hub.auth.service.rolesOf(admin.id)).some(x => x.role_code === 'ADMIN'));
  const denied = await hub.auth.audit.list({ action: 'ROLE_CHANGE_DENIED', userId: admin.id });
  assert.ok(denied.length >= 1);
});

test('an admin cannot grant ADMIN or touch the owner; nobody can grant SUPER_ADMIN', async () => {
  const c = await signIn(admin);
  let r = await adminPost(c, `/auth/admin/users/${user.id}/roles`, { role: 'ADMIN', action: 'grant' });
  assert.match(decodeURIComponent(r.location), /Only the owner/);
  r = await adminPost(c, `/auth/admin/users/${owner.id}/roles`, { role: 'USER', action: 'revoke' });
  assert.match(decodeURIComponent(r.location), /owner account/);
  r = await adminPost(c, `/auth/admin/users/${user.id}/roles`, { role: 'SUPER_ADMIN', action: 'grant' });
  assert.match(decodeURIComponent(r.location), /server/);
  const oc = await signIn(owner);
  r = await adminPost(oc, `/auth/admin/users/${user.id}/roles`, { role: 'SUPER_ADMIN', action: 'grant' });
  assert.match(decodeURIComponent(r.location), /server/);
  assert.ok(!(await hub.auth.service.rolesOf(user.id)).some(x => x.role_code === 'SUPER_ADMIN' || x.role_code === 'ADMIN'));
});

test('the owner can grant and remove ADMIN', async () => {
  const target = await makeUser(hub, 'promote@example.com');
  const oc = await signIn(owner);
  await adminPost(oc, `/auth/admin/users/${target.id}/roles`, { role: 'ADMIN', action: 'grant' });
  assert.ok((await hub.auth.service.rolesOf(target.id)).some(x => x.role_code === 'ADMIN'));
  await adminPost(oc, `/auth/admin/users/${target.id}/roles`, { role: 'ADMIN', action: 'revoke' });
  assert.ok(!(await hub.auth.service.rolesOf(target.id)).some(x => x.role_code === 'ADMIN'));
});

test('a user requests access; an admin approves with an expiry; then revokes', async () => {
  const u = await makeUser(hub, 'subscriber@example.com');
  const uc = await signIn(u);
  let r = await uc.post('/auth/subscribe/ladwani', { note: 'family tree please' });
  assert.equal(r.status, 303);
  assert.equal((await hub.auth.service.getSubscription(u.id, 'LADWANI')).status, 'pending');
  assert.deepEqual((await uc.request('/auth/api/me')).json().features, [], 'pending grants nothing');

  const c = await signIn(admin);
  const panel = await c.request('/auth/admin');
  assert.match(panel.text, /family tree please/);
  r = await adminPost(c, `/auth/admin/users/${u.id}/subscriptions`, { feature: 'LADWANI', action: 'approve', expires_at: '2099-12-31' });
  assert.equal(r.status, 303);
  let me = (await uc.request('/auth/api/me')).json();
  assert.deepEqual(me.features, ['LADWANI']);
  assert.equal(me.subscriptions[0].expires_at, '2099-12-31 23:59:59');

  r = await adminPost(c, `/auth/admin/users/${u.id}/subscriptions`, { feature: 'LADWANI', action: 'revoke' });
  me = (await uc.request('/auth/api/me')).json();
  assert.deepEqual(me.features, []);
  const actions = (await hub.auth.audit.list({ userId: u.id })).map(a => a.action);
  for (const a of ['SUBSCRIPTION_REQUESTED', 'SUBSCRIPTION_APPROVED', 'SUBSCRIPTION_REVOKED']) assert.ok(actions.includes(a), a);
});

test('an expiry in the past is refused; an active row past expiry reads expired and is written back', async () => {
  const u = await makeUser(hub, 'expiring@example.com', { subs: { TASKLIST: { status: 'active', expires_at: '2001-01-01 00:00:00' } } });
  const c = await signIn(admin);
  const r = await adminPost(c, `/auth/admin/users/${u.id}/subscriptions`, { feature: 'EDUCATION', action: 'approve', expires_at: '2001-01-01' });
  assert.match(decodeURIComponent(r.location), /future/);
  const uc = await signIn(u);
  const me = (await uc.request('/auth/api/me')).json();
  assert.deepEqual(me.features, []);
  assert.equal(me.subscriptions[0].status, 'expired');
  assert.equal((await hub.auth.service.getSubscription(u.id, 'TASKLIST')).status, 'expired');
});

test('the payment hook activates a subscription once per reference', async () => {
  const u = await makeUser(hub, 'payer@example.com');
  assert.equal(await hub.auth.service.activateFromPayment({ userId: u.id, feature: 'MILK_DAIRY', provider: 'cashfree', reference: 'ord_1', expiresAt: '2099-01-31' }), true);
  assert.equal(await hub.auth.service.activateFromPayment({ userId: u.id, feature: 'MILK_DAIRY', provider: 'cashfree', reference: 'ord_1', expiresAt: '2099-01-31' }), false);
  const s = await hub.auth.service.getSubscription(u.id, 'MILK_DAIRY');
  assert.equal(s.source, 'payment');
  assert.equal(s.status, 'active');
});

test('the admin subscription screen and feature list never mention ATIP', async () => {
  const c = await signIn(admin);
  for (const path of ['/auth/admin', `/auth/admin/users/${user.id}`, '/auth/admin/audit', '/auth/account']) {
    const r = await c.request(path);
    assert.equal(r.status, 200, path);
    assert.doesNotMatch(r.text, /atip/i, path);
  }
});

test('a USER cannot reach admin actions by posting directly', async () => {
  const c = await signIn(user);
  const page = await c.request('/auth/account');
  const r = await c.request(`/auth/admin/users/${user.id}/subscriptions`, { method: 'POST', form: { _csrf: formToken(page.text), feature: 'LADWANI', action: 'approve' } });
  assert.equal(r.status, 403);
  assert.equal(await hub.auth.service.getSubscription(user.id, 'LADWANI'), null);
});
