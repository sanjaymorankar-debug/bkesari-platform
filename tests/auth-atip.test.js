/**
 * ATIP is owner-only. For every other account, and for logged-out
 * requests, every ATIP route and API answers 404 — the same as a path that
 * does not exist — and ATIP appears in no menu and no API response.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startHub, client, makeUser, login, OWNER_EMAIL } = require('./helpers/auth-harness');

let hub;
const as = {};
let owner;
test.before(async () => {
  hub = await startHub();
  owner = await makeUser(hub, OWNER_EMAIL, { roles: ['SUPER_ADMIN'], mfa: true, name: 'Owner' });
  const everything = { MILK_DAIRY: 'active', EDUCATION: 'active', LADWANI: 'active', TASKLIST: 'active', AGTCI: 'active' };
  const user = await makeUser(hub, 'user@example.com', { subs: everything });
  const mod = await makeUser(hub, 'mod@example.com', { roles: [['MODERATOR', 'LADWANI'], ['MODERATOR', 'TASKLIST']], subs: everything });
  const admin = await makeUser(hub, 'admin@example.com', { roles: ['ADMIN'], mfa: true });
  // An ADMIN that also holds the owner's role but not the owner's email.
  const impostor = await makeUser(hub, 'second-super@example.com', { roles: ['SUPER_ADMIN', 'ADMIN'], mfa: true });
  as['logged out'] = client(hub.base);
  as.USER = await login(hub, user.email);
  as.MODERATOR = await login(hub, mod.email);
  as.ADMIN = await login(hub, admin.email, { user: admin });
  as['SUPER_ADMIN without the owner email'] = await login(hub, impostor.email, { user: impostor });
  as.owner = await login(hub, owner.email, { user: owner });
  // Something for the viewer to show.
  const r = await client(hub.base).request('/atip/api/snapshot', {
    method: 'POST', json: { html: '<html><head></head><body><h1>ATIP dashboard</h1></body></html>', trade_date: '2026-10-09' },
    headers: { authorization: 'Bearer publish-token-for-tests' },
  });
  assert.equal(r.status, 200, 'the ATIP machine can still publish');
});
test.after(async () => { await hub.close(); });

const ATIP_ROUTES = [
  ['GET', '/atip/'], ['GET', '/ATIP/'], ['GET', '/atip'], ['GET', '/ATIP'], ['GET', '/Atip/'],
  ['GET', '/atip/api/snapshot'], ['POST', '/atip/api/snapshot'], ['POST', '/ATIP/api/snapshot'],
  ['GET', '/atip/anything/else'], ['DELETE', '/atip/api/orders/1'],
];
const NON_OWNERS = ['logged out', 'USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN without the owner email'];

test('every ATIP route answers non-owners exactly like a path that does not exist', async () => {
  for (const who of NON_OWNERS) {
    for (const [method, path] of ATIP_ROUTES) {
      const json = method === 'POST' ? { html: '<html></html>' } : undefined;
      const r = await as[who].request(path, { method, json });
      // The same request to a path that has never existed, for comparison.
      const twin = path.replace(/atip/i, 'zzzz');
      const baseline = await as[who].request(twin, { method, json });
      assert.equal(r.status, 404, `${who} ${method} ${path}`);
      assert.equal(baseline.status, 404, `${who} ${method} ${twin}`);
      assert.equal(r.text, baseline.text.replace(twin, path), `${who} ${method} ${path}: same body as a missing path`);
      assert.equal(r.headers.get('www-authenticate'), null, `${who} ${method} ${path}: no login prompt`);
    }
  }
});

test('a wrong publish token is a 404 too, not a 401', async () => {
  const r = await client(hub.base).request('/atip/api/snapshot', { method: 'POST', json: { html: '<html></html>' }, headers: { authorization: 'Bearer wrong' } });
  assert.equal(r.status, 404);
});

test('no menu, account page or API response mentions ATIP to a non-owner', async () => {
  for (const who of NON_OWNERS) {
    const paths = ['/auth/api/menu', '/', '/auth/login', '/auth/privacy', '/shared/menu.js'];
    if (who !== 'logged out') paths.push('/auth/api/me', '/auth/account', '/auth/subscribe/ladwani');
    if (who === 'ADMIN' || who === 'SUPER_ADMIN without the owner email') paths.push('/auth/admin', '/auth/admin/audit', `/auth/admin/users/${owner.id}`);
    for (const p of paths) {
      const r = await as[who].request(p);
      assert.ok([200, 302, 401].includes(r.status), `${who} ${p}: ${r.status}`);
      assert.doesNotMatch(r.text, /atip/i, `${who} sees ATIP in ${p}`);
    }
  }
});

test('the owner, with TOTP on the session, sees and opens ATIP; each access is audited', async () => {
  const menu = (await as.owner.request('/auth/api/menu')).json();
  assert.ok(menu.tabs.some(t => t.path === '/atip/'));
  assert.equal((await as.owner.request('/auth/api/me')).json().atip, true);
  const r = await as.owner.request('/atip/');
  assert.equal(r.status, 200);
  assert.match(r.text, /ATIP dashboard/);
  assert.match(r.text, /Read-only view/);
  assert.match(r.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.match(r.text, /href="\/atip\/"[^>]*aria-current="page"/, 'the bar shows the ATIP tab as current');
  const log = await hub.auth.audit.list({ action: 'ATIP_ACCESS', includeOwnerOnly: true });
  assert.ok(log.some(a => a.actor_user_id === owner.id));
});

test('the owner without TOTP on this session is asked for a code, and gets nothing else', async () => {
  const c = client(hub.base);
  const { token } = await hub.auth.service.createSession(owner, { mfa: false });
  c.jar.set('bk_sso', token);
  const r = await c.request('/atip/');
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/auth\/step-up\?return_to=/);
  assert.equal((await c.request('/atip/api/snapshot', { method: 'POST', json: {} })).status, 404);
  assert.doesNotMatch((await c.request('/auth/api/menu')).text, /atip/i);
  assert.equal('atip' in (await c.request('/auth/api/me')).json(), false);
});

test('the owner is the owner only while AUTH_OWNER_EMAIL says so', async () => {
  const resolved = await hub.auth.resolve({ headers: { cookie: `bk_sso=${as.owner.jar.get('bk_sso')}` } });
  assert.equal(resolved.atip, true);
  const rbac = require('../portal/auth/rbac');
  assert.equal(rbac.isAtipOwner(resolved, 'someone-else@example.com'), false);
});

test('owner-only audit events are hidden from admins', async () => {
  const r = await as.ADMIN.request('/auth/admin/audit');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /ATIP_/);
  const ownerView = await as.owner.request('/auth/admin/audit');
  assert.match(ownerView.text, /ATIP_ACCESS/);
});
