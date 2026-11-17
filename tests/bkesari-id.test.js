'use strict';

/**
 * The bkesari ID's pieces that need no database (D-039,
 * docs/design/bkesari-id.md): Google ID-token verification against a JWKS,
 * the signed X-Bkesari-* identity headers, the next-path guard, the app
 * schemes, the mobile hand-off code, and the IST formatting the pages use.
 *
 * Google is played by a key pair made here: the tests sign their own ID
 * tokens and serve the public half as a JWKS through a fake fetch.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { verifyIdToken, createJwks, googleConfig, ownerEmails, safeNext, appSchemes, createBkesariId } = require('../portal/bkesari-id.js');
const { identityHeaders, verifyIdentityHeaders, ist, IDENTITY_HEADERS } = require('../portal/access.js');

const CLIENT = 'test-client.apps.googleusercontent.com';

function googleKeys(kid = 'k1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

function sign(key, claims, header = {}) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}

function claimsFor(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com', aud: CLIENT, azp: CLIENT, sub: '1234567890', email: 'Asha.Patil@Example.com',
    email_verified: true, name: 'Asha Patil', nonce: 'nonce-abc', iat: now - 5, exp: now + 3600, ...over,
  };
}

function jwksFetch(keys, counter = { n: 0 }) {
  return async (url) => {
    counter.n += 1;
    return { ok: true, status: 200, headers: new Headers({ 'cache-control': 'public, max-age=600' }), json: async () => ({ keys: keys.map((k) => k.jwk) }) };
  };
}

test('a Google ID token is accepted only with Google\'s signature, issuer, audience, expiry, nonce and a confirmed email', async () => {
  const k = googleKeys();
  const keyFor = createJwks({ fetchImpl: jwksFetch([k]) });
  const check = (token, nonce = 'nonce-abc') => verifyIdToken(token, { keyFor, clientId: CLIENT, nonce });

  const ok = await check(sign(k, claimsFor()));
  assert.equal(ok.sub, '1234567890');
  assert.equal((await check(sign(k, claimsFor({ iss: 'accounts.google.com' })))).sub, '1234567890', 'both of Google\'s issuer spellings');
  assert.equal((await check(sign(k, claimsFor({ email_verified: 'true' })))).sub, '1234567890', 'the string form Google once used');

  const refused = async (token, reason, nonce) => assert.rejects(check(token, nonce), (e) => e.message === reason, reason);
  await refused(sign(k, claimsFor({ iss: 'https://evil.example' })), 'issuer');
  await refused(sign(k, claimsFor({ aud: 'someone-else.apps.googleusercontent.com' })), 'audience');
  await refused(sign(k, claimsFor({ aud: [CLIENT, 'other'], azp: 'other' })), 'audience');
  await refused(sign(k, claimsFor({ exp: Math.floor(Date.now() / 1000) - 120 })), 'expired');
  await refused(sign(k, claimsFor({ iat: Math.floor(Date.now() / 1000) + 600 })), 'issued in the future');
  await refused(sign(k, claimsFor({ nonce: 'replayed' })), 'nonce');
  await refused(sign(k, claimsFor()), 'nonce', '');
  await refused(sign(k, claimsFor({ email_verified: false })), 'unverified');
  await refused(sign(k, claimsFor({ email_verified: undefined })), 'unverified');
  await refused(sign(k, claimsFor({ email: 'not-an-email' })), 'email');
  await refused(sign(k, claimsFor(), { alg: 'HS256' }), 'algorithm');
  await refused(sign(k, claimsFor(), { alg: 'none' }), 'algorithm');
  await refused('a.b', 'malformed');
  await refused('not json.at all.x', 'malformed');

  // Signed by a key that is not Google's, under Google's kid.
  const impostor = googleKeys('k1');
  await refused(sign(impostor, claimsFor()), 'signature');
  // A token whose claims were changed after signing.
  const [h, , s] = sign(k, claimsFor()).split('.');
  await refused(`${h}.${Buffer.from(JSON.stringify(claimsFor({ email: 'admin@bkesari.com' }))).toString('base64url')}.${s}`, 'signature');
  // A kid Google never published.
  await refused(sign(googleKeys('unknown-kid'), claimsFor()), 'unknown key');
});

test('Google\'s keys are cached as its Cache-Control says; an unknown kid refetches at most once a minute', async () => {
  const k1 = googleKeys('k1');
  const counter = { n: 0 };
  let t = 1_000_000;
  let published = [k1];
  const fetchImpl = async () => { counter.n += 1; return { ok: true, status: 200, headers: new Headers({ 'cache-control': 'max-age=600' }), json: async () => ({ keys: published.map((k) => k.jwk) }) }; };
  const keyFor = createJwks({ fetchImpl, now: () => t });
  assert.ok(await keyFor('k1'));
  assert.ok(await keyFor('k1'));
  assert.equal(counter.n, 1, 'cached');
  const k2 = googleKeys('k2');
  published = [k1, k2];
  t += 30 * 1000;
  assert.equal(await keyFor('k2'), null, 'within a minute of the last fetch: not refetched');
  assert.equal(counter.n, 1);
  t += 31 * 1000;
  assert.ok(await keyFor('k2'), 'a minute later, Google\'s rotated key is fetched');
  assert.equal(counter.n, 2);
  t += 601 * 1000;
  await keyFor('k1');
  assert.equal(counter.n, 3, 'expired by max-age: refetched');
  const broken = createJwks({ fetchImpl: async () => ({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) }) });
  await assert.rejects(broken('k1'), /JWKS answered 500/);
});

test('the identity headers: signed for one project, 60 seconds, every field covered; forged or stale ones are refused', () => {
  const secret = 'proxy-secret-0123456789abcdef-0123456789';
  const now = Date.UTC(2026, 10, 17, 18, 0, 0);
  const h = identityHeaders(secret, { project: 'edu', userId: 42, email: 'Asha@Example.com', role: 'teacher', name: 'आशा पाटील', now });
  assert.equal(h['x-bkesari-email'], 'asha@example.com');
  assert.equal(h['x-bkesari-role'], 'teacher');
  assert.equal(Buffer.from(h['x-bkesari-name'], 'base64url').toString('utf8'), 'आशा पाटील', 'a name in any script, as base64url');
  assert.deepEqual(verifyIdentityHeaders(secret, h, 'edu', now + 59 * 1000), { userId: 42, email: 'asha@example.com', role: 'teacher', name: 'आशा पाटील', project: 'edu' });

  assert.equal(verifyIdentityHeaders(secret, h, 'ladwani', now), null, 'signed for Education, not LadWani');
  assert.equal(verifyIdentityHeaders(secret, h, 'edu', now + 61 * 1000), null, 'stale');
  assert.equal(verifyIdentityHeaders(secret, h, 'edu', now - 61 * 1000), null, 'from the future');
  assert.equal(verifyIdentityHeaders('another-secret-0123456789abcdef-01234', h, 'edu', now), null, 'another secret');
  assert.equal(verifyIdentityHeaders('', h, 'edu', now), null, 'no secret: nobody is believed');
  for (const [field, value] of [['x-bkesari-role', 'school_admin'], ['x-bkesari-user', '1'], ['x-bkesari-email', 'owner@bkesari.com'],
    ['x-bkesari-name', Buffer.from('Someone').toString('base64url')], ['x-bkesari-ts', String(Number(h['x-bkesari-ts']) + 1)], ['x-bkesari-sig', `${h['x-bkesari-sig'].slice(0, -2)}AA`]]) {
    assert.equal(verifyIdentityHeaders(secret, { ...h, [field]: value }, 'edu', now), null, `${field} changed`);
  }
  assert.equal(verifyIdentityHeaders(secret, { ...h, 'x-bkesari-sig': undefined }, 'edu', now), null, 'no signature');
  assert.equal(identityHeaders('', { project: 'edu', userId: 1, email: 'a@b.c', role: 'x' }), null, 'nothing is signed without HUB_PROXY_SECRET');
  for (const name of Object.keys(h)) assert.ok(IDENTITY_HEADERS.includes(name), `${name} is one the gate strips from the client`);
  assert.ok(IDENTITY_HEADERS.includes('x-bkesari-project-state'));
});

test('after sign-in, only a path on this site: never another host, a protocol-relative URL or a backslash trick', () => {
  for (const ok of ['/', '/tasklist/', '/ladwani/tree?x=1', '/access/request?project=edu']) assert.equal(safeNext(ok), ok);
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/\\/evil', 'javascript:alert(1)', 'tasklist', '', '/a b', `/${'x'.repeat(600)}`]) {
    assert.equal(safeNext(bad), '/', bad);
  }
});

test('configuration: Google is off until both halves are set; owners and app schemes from the environment', () => {
  assert.equal(googleConfig({}), null);
  assert.equal(googleConfig({ GOOGLE_CLIENT_ID: 'x' }), null);
  assert.deepEqual(googleConfig({ GOOGLE_CLIENT_ID: ' id ', GOOGLE_CLIENT_SECRET: 's' }), { clientId: 'id', clientSecret: 's' });
  assert.deepEqual(googleConfig({ AUTH_GOOGLE_ID: 'gid', AUTH_GOOGLE_SECRET: 'gs' }), { clientId: 'gid', clientSecret: 'gs' }, 'GoKesari\'s names');
  assert.deepEqual([...ownerEmails({})], ['agtcipl@gmail.com']);
  assert.deepEqual([...ownerEmails({ HUB_OWNER_EMAILS: 'A@x.com, b@y.com' })], ['a@x.com', 'b@y.com']);
  const s = appSchemes({ MOBILE_APP_SCHEMES: 'com.example.app, BAD SCHEME, javascript' });
  assert.ok(s.has('in.bkesari.app') && s.has('com.bkesari.ladwani') && s.has('com.example.app'));
  assert.ok(!s.has('BAD') && !s.has('javascript:'));
});

test('the mobile hand-off code: two minutes, one user, only with the verifier whose challenge it was made for', () => {
  let t = Date.UTC(2026, 10, 17, 12, 0, 0);
  const id = createBkesariId({ db: {}, env: {}, secret: 'mobile-secret-0123456789abcdef-0123456789', log: { error() {} }, now: () => t });
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = id.createMobileCode(7, challenge);
  assert.equal(id.redeemMobileCode(code, verifier), 7);
  assert.equal(id.redeemMobileCode(code, crypto.randomBytes(48).toString('base64url')), null, 'another verifier');
  assert.equal(id.redeemMobileCode(code.replace(/^7\./, '8.'), verifier), null, 'another user');
  assert.equal(id.redeemMobileCode(code, 'short'), null);
  assert.equal(id.redeemMobileCode('7.1.x', verifier), null);
  const other = createBkesariId({ db: {}, env: {}, secret: 'another-secret-0123456789abcdef-0123456789', log: { error() {} }, now: () => t });
  assert.equal(other.redeemMobileCode(code, verifier), null, 'another server\'s secret');
  t += 2 * 60 * 1000 + 1;
  assert.equal(id.redeemMobileCode(code, verifier), null, 'expired after two minutes');
});

test('times on the pages are IST, whatever the column type', () => {
  assert.equal(ist('2026-11-17 17:38:00'), '17 Nov 2026, 11:08 PM IST');
  assert.equal(ist('2026-11-17 17:38:00.123+00'), '17 Nov 2026, 11:08 PM IST');
  assert.equal(ist('2026-11-17T17:38:00Z'), '17 Nov 2026, 11:08 PM IST');
  assert.equal(ist(new Date(Date.UTC(2026, 10, 17, 4, 0))), '17 Nov 2026, 09:30 AM IST');
  assert.equal(ist(null), '');
  assert.equal(ist('garbage'), '');
});
