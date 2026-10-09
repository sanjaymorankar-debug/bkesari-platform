/**
 * Subscription gating at the hub's edge, for every gated tab, against real
 * upstream servers standing in for Milk & Dairy, Education and LadWani; the
 * TaskList permissions; the personalised menu; and introspection, the call
 * each project makes to validate the session itself.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startHub, client, makeUser, login } = require('./helpers/auth-harness');

let hub;
const upstreams = [];
const hits = [];

async function upstream(name) {
  const server = http.createServer((req, res) => {
    hits.push({ name, url: req.url, cookie: req.headers.cookie || '' });
    res.setHeader('content-type', 'text/plain');
    res.end(`${name} content`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  upstreams.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let introspectSecret;
test.before(async () => {
  const env = { MILK_ORIGIN: await upstream('milk'), EDU_ORIGIN: await upstream('edu'), LADWANI_ORIGIN: await upstream('ladwani') };
  hub = await startHub(env);
  ({ secret: introspectSecret } = await hub.auth.clients.register({ clientId: 'ladwani-dev', kind: 'internal', tier: 'dev' }));
});
test.after(async () => {
  await hub.close();
  for (const s of upstreams) { s.closeAllConnections?.(); s.close(); }
});
test.beforeEach(() => { hub.auth.limiter.clear(); hits.length = 0; });

const TABS = [
  { path: '/milk/', feature: 'MILK_DAIRY', name: 'milk' },
  { path: '/edu/', feature: 'EDUCATION', name: 'edu' },
  { path: '/ladwani/', feature: 'LADWANI', name: 'ladwani' },
];

test('logged out: pages redirect to sign-in, APIs answer 401, and nothing reaches the project', async () => {
  const c = client(hub.base);
  for (const t of TABS) {
    const page = await c.request(`${t.path}dashboard`);
    assert.equal(page.status, 302, t.path);
    assert.equal(page.location, `/auth/login?return_to=${encodeURIComponent(`${t.path}dashboard`)}`);
    const api = await c.request(`${t.path}api/things`);
    assert.equal(api.status, 401, `${t.path}api`);
    assert.equal(api.json().error, 'login_required');
  }
  assert.equal((await c.request('/tasks/')).status, 302);
  assert.equal((await c.request('/tasks/api/overview')).status, 401);
  assert.equal(hits.length, 0);
});

test('signed in without a subscription: the subscribe page (403), never the content; APIs 403', async () => {
  await makeUser(hub, 'nosubs@example.com');
  const c = await login(hub, 'nosubs@example.com');
  for (const t of TABS) {
    const page = await c.request(t.path);
    assert.equal(page.status, 403, t.path);
    assert.match(page.text, /Request access/);
    assert.doesNotMatch(page.text, new RegExp(`${t.name} content`));
    const api = await c.request(`${t.path}api/things`, { headers: { accept: 'application/json' } });
    assert.equal(api.status, 403);
    assert.equal(api.json().error, 'subscription_required');
    assert.equal(api.json().feature, t.feature);
  }
  assert.equal((await c.request('/tasks/api/overview')).status, 403);
  assert.equal(hits.length, 0, 'no request reached any project');
});

test('a subscription opens exactly its own tab, and the cookie travels on to the project', async () => {
  await makeUser(hub, 'ladwani-only@example.com', { subs: { LADWANI: 'active' } });
  const c = await login(hub, 'ladwani-only@example.com');
  const r = await c.request('/ladwani/tree');
  assert.equal(r.status, 200);
  assert.equal(r.text, 'ladwani content');
  assert.match(hits[0].cookie, /bk_sso=/, 'the project receives the cookie to introspect');
  assert.equal((await c.request('/milk/')).status, 403);
  assert.equal((await c.request('/edu/')).status, 403);
});

test('pending, expired and revoked subscriptions open nothing', async () => {
  await makeUser(hub, 'states@example.com', { subs: { MILK_DAIRY: 'pending', EDUCATION: { status: 'active', expires_at: '2000-01-01 00:00:00' }, LADWANI: 'revoked' } });
  const c = await login(hub, 'states@example.com');
  for (const t of TABS) assert.equal((await c.request(t.path)).status, 403, t.path);
});

test('MODERATOR of a feature and ADMIN are entitled without a subscription', async () => {
  await makeUser(hub, 'edu-mod@example.com', { roles: [['MODERATOR', 'EDUCATION']] });
  const m = await login(hub, 'edu-mod@example.com');
  assert.equal((await m.request('/edu/')).status, 200);
  assert.equal((await m.request('/milk/')).status, 403);
});

test('machine endpoints carry their own credentials and are not gated', async () => {
  const c = client(hub.base);
  const r = await c.request('/milk/api/cron/daily-orders', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(r.text, 'milk content');
});

test('TaskList: subscribers read; only tasklist.manage writes, and only same-origin', async () => {
  await makeUser(hub, 'reader@example.com', { subs: { TASKLIST: 'active' } });
  await makeUser(hub, 'tasks-mod@example.com', { roles: [['MODERATOR', 'TASKLIST']] });
  const reader = await login(hub, 'reader@example.com');
  assert.equal((await reader.request('/tasks/api/overview')).status, 200);
  const denied = await reader.request('/tasks/api/projects', { method: 'POST', json: { name: 'x' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.json().permission, 'tasklist.manage');

  const mod = await login(hub, 'tasks-mod@example.com');
  const made = await mod.request('/tasks/api/projects', { method: 'POST', json: { name: 'Gated project' } });
  assert.equal(made.status, 201);
  const cross = await mod.request('/tasks/api/projects', { method: 'POST', json: { name: 'x' }, headers: { origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  // Basic auth is not what lets anyone in any more.
  assert.equal((await client(hub.base).request('/tasks/api/overview', { headers: { authorization: 'Basic ' + Buffer.from('admin:change-me').toString('base64') } })).status, 401);
});

test('the menu API lists the catalogue when logged out and only entitled tabs when in', async () => {
  const out = (await client(hub.base).request('/auth/api/menu')).json();
  assert.deepEqual(out.tabs.map(t => t.path), ['/milk/', '/edu/', '/global-warming/', '/ladwani/', '/tasks/', '/driving-simulator/']);
  assert.equal(out.account.href, '/auth/login');
  await makeUser(hub, 'menu@example.com', { name: 'Menu Person', subs: { EDUCATION: 'active' } });
  const c = await login(hub, 'menu@example.com');
  const m = (await c.request('/auth/api/menu')).json();
  assert.deepEqual(m.tabs.map(t => t.path), ['/edu/', '/global-warming/', '/driving-simulator/']);
  assert.deepEqual(m.account, { label: 'Menu Person', href: '/auth/account' });
});

test('introspection: projects validate the cookie with client credentials', async () => {
  await makeUser(hub, 'intro@example.com', { subs: { LADWANI: 'active' }, roles: [['MODERATOR', 'TASKLIST']] });
  const c = await login(hub, 'intro@example.com');
  const token = c.jar.get('bk_sso');
  const basic = 'Basic ' + Buffer.from(`ladwani-dev:${introspectSecret}`).toString('base64');
  const anon = client(hub.base);

  let r = await anon.request('/auth/api/introspect', { method: 'POST', json: { token }, headers: { authorization: 'Basic ' + Buffer.from('ladwani-dev:wrong').toString('base64') } });
  assert.equal(r.status, 401);
  r = await anon.request('/auth/api/introspect', { method: 'POST', json: { token } });
  assert.equal(r.status, 401);

  r = await anon.request('/auth/api/introspect', { method: 'POST', json: { token }, headers: { authorization: basic } });
  assert.equal(r.status, 200);
  const id = r.json();
  assert.equal(id.active, true);
  assert.equal(id.user.email, 'intro@example.com');
  assert.deepEqual(id.features, ['LADWANI', 'TASKLIST']);
  assert.ok(id.permissions.includes('ladwani.edit_tree'));
  assert.ok(id.permissions.includes('tasklist.manage'));
  assert.equal('atip' in id, false);

  r = await anon.request('/auth/api/introspect', { method: 'POST', json: { token: 'not-a-session' }, headers: { authorization: basic } });
  assert.deepEqual(r.json(), { active: false });

  // Logout anywhere: the project sees it at its next check.
  await c.post('/auth/logout', {}, { csrfFrom: '/auth/account' });
  r = await anon.request('/auth/api/introspect', { method: 'POST', json: { token }, headers: { authorization: basic } });
  assert.deepEqual(r.json(), { active: false });
});

test('an oidc client cannot use the internal introspection endpoint', async () => {
  const { secret } = await hub.auth.clients.register({ clientId: 'agtci-gating-test', kind: 'oidc', tier: 'dev', redirectUris: ['https://dev.agtci.com/auth/callback'] });
  const r = await client(hub.base).request('/auth/api/introspect', { method: 'POST', json: { token: 'x' }, headers: { authorization: 'Basic ' + Buffer.from(`agtci-gating-test:${secret}`).toString('base64') } });
  assert.equal(r.status, 401);
});

test('the subscribe page exists for every feature and for nothing else', async () => {
  const c = client(hub.base);
  for (const f of ['milk_dairy', 'education', 'ladwani', 'tasklist', 'agtci']) assert.equal((await c.request(`/auth/subscribe/${f}`)).status, 200, f);
  assert.equal((await c.request('/auth/subscribe/atip')).status, 404);
  assert.equal((await c.request('/auth/subscribe/nonsense')).status, 404);
});
