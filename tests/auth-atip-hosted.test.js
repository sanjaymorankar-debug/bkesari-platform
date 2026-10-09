/**
 * The hosted, interactive ATIP (ATIP_ORIGIN) behind the hub's owner gate:
 * only the owner is forwarded, and the request reaches ATIP intact.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startHub, client, makeUser, login, OWNER_EMAIL } = require('./helpers/auth-harness');

let hub, upstream;
const seen = [];
test.before(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, body }); res.end('ATIP app'); });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  hub = await startHub({ ATIP_ORIGIN: `http://127.0.0.1:${upstream.address().port}` });
});
test.after(async () => { await hub.close(); upstream.closeAllConnections?.(); upstream.close(); });

test('non-owners never reach the hosted ATIP', async () => {
  await makeUser(hub, 'admin@example.com', { roles: ['ADMIN'] });
  const admin = await login(hub, 'admin@example.com');
  for (const c of [client(hub.base), admin]) {
    for (const [method, path] of [['GET', '/ATIP/'], ['GET', '/atip/api/portfolio'], ['POST', '/ATIP/api/orders/1/confirm']]) {
      const r = await c.request(path, { method, json: method === 'POST' ? { qty: 1 } : undefined });
      assert.equal(r.status, 404, `${method} ${path}`);
    }
  }
  assert.equal(seen.length, 0, 'nothing was forwarded');
});

test('the owner is forwarded with the prefix stripped and the body intact', async () => {
  const owner = await makeUser(hub, OWNER_EMAIL, { roles: ['SUPER_ADMIN'], mfa: true });
  const c = await login(hub, OWNER_EMAIL, { user: owner });
  let r = await c.request('/ATIP/api/positions?x=1');
  assert.equal(r.status, 200);
  assert.equal(r.text, 'ATIP app');
  r = await c.request('/ATIP/api/orders', { method: 'POST', json: { symbol: 'ACME' } });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.map(s => [s.method, s.url]), [['GET', '/api/positions?x=1'], ['POST', '/api/orders']]);
  assert.deepEqual(JSON.parse(seen[1].body), { symbol: 'ACME' });
  const log = await hub.auth.audit.list({ action: 'ATIP_ACCESS', includeOwnerOnly: true });
  assert.ok(log.length >= 2);
});
