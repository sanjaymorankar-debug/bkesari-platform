/** The hub's signed token, with no database: what an app would check. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHub, signToken, verifyToken, ownerEmails, TOKEN_TTL_SECONDS } = require('../portal/hub.js');

const quiet = { warn() {}, error() {}, log() {} };
const hub = createHub({ db: {}, getUser: async () => null, env: {}, log: quiet });
const claims = { sub: 'u1', email: 'a@example.com', role: 'member', project: 'ladwani', aud: 'ladwani' };

test('a token verifies against the published key set and carries user, email and role', () => {
  const t = signToken(hub.keys, claims);
  const c = verifyToken(hub.keys.jwks, t, { audience: 'ladwani' });
  assert.equal(c.sub, 'u1'); assert.equal(c.email, 'a@example.com'); assert.equal(c.role, 'member');
  assert.equal(c.exp - c.iat, TOKEN_TTL_SECONDS);
});

test('a token is short-lived', () => {
  const t = signToken(hub.keys, claims, { now: Date.now() });
  assert.throws(() => verifyToken(hub.keys.jwks, t, { now: Date.now() + 61_000 }), /expired/);
});

test("one project's token does not open another project", () => {
  const t = signToken(hub.keys, claims);
  assert.throws(() => verifyToken(hub.keys.jwks, t, { audience: 'edu' }), /another project/);
});

test('a tampered or foreign-key token is refused', () => {
  const t = signToken(hub.keys, claims);
  const [h, p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...claims, role: 'admin', iat: 1, exp: 9e9 })).toString('base64url');
  assert.throws(() => verifyToken(hub.keys.jwks, `${h}.${forged}.${s}`), /bad signature/);
  const other = createHub({ db: {}, getUser: async () => null, env: {}, log: quiet });
  assert.throws(() => verifyToken(hub.keys.jwks, signToken(other.keys, claims)), /unknown key|bad signature/);
});

test('the owner list defaults to agtcipl@gmail.com and is configurable', () => {
  assert.deepEqual([...ownerEmails({})], ['agtcipl@gmail.com']);
  assert.deepEqual([...ownerEmails({ HUB_OWNER_EMAILS: 'A@x.com, b@x.com' })], ['a@x.com', 'b@x.com']);
});
