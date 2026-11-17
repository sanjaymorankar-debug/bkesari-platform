/**
 * The bkesari app's Google sign-in, pure parts (bkesari/www/js/auth-core.js):
 * PKCE verifier and S256 challenge, the start and finish URLs, the
 * `in.bkesari.app://auth-callback` link, the allowed-scheme check and the
 * pending sign-in. The hub side is docs/design/bkesari-id.md section 1 ("Mobile").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac, randomBytes, timingSafeEqual, webcrypto } = require('node:crypto');

const Auth = require('../bkesari/www/js/auth-core.js');

const SITE = 'https://bkesari.com';
const SCHEME = 'in.bkesari.app';
/** The hub's side of the check, as in GoKesari's src/server/mobile-auth.ts (challengeForVerifier). */
const hubChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
}

test('base64url matches Node for every length', () => {
  for (let length = 0; length <= 70; length++) {
    const bytes = randomBytes(length);
    assert.equal(Auth.base64url(new Uint8Array(bytes)), bytes.toString('base64url'), `length ${length}`);
  }
});

test('the fallback SHA-256 matches Node, across the padding boundaries', () => {
  const inputs = [Buffer.alloc(0), Buffer.from('abc')];
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) inputs.push(randomBytes(length));
  for (const input of inputs) {
    const ours = Buffer.from(Auth.sha256(new Uint8Array(input))).toString('hex');
    assert.equal(ours, createHash('sha256').update(input).digest('hex'), `length ${input.length}`);
  }
});

test('the verifier is 32 random bytes as 43 base64url characters', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const verifier = Auth.createVerifier(webcrypto);
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    seen.add(verifier);
  }
  assert.equal(seen.size, 50, 'never repeats');
  let asked = 0;
  const fixed = Auth.createVerifier({ getRandomValues: (bytes) => { asked = bytes.length; bytes.fill(0xff); return bytes; } });
  assert.equal(asked, 32);
  assert.equal(fixed, Buffer.alloc(32, 0xff).toString('base64url'));
  assert.throws(() => Auth.createVerifier(undefined), /random/);
  assert.throws(() => Auth.createVerifier({}), /random/);
});

test('the challenge is S256 of the verifier, with SubtleCrypto or without it (RFC 7636, appendix B)', async () => {
  const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const rfcChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.equal(await Auth.challengeFor(rfcVerifier, webcrypto.subtle), rfcChallenge);
  assert.equal(await Auth.challengeFor(rfcVerifier, undefined), rfcChallenge, 'no SubtleCrypto (not a secure context)');
  const broken = { digest: () => Promise.reject(new Error('NotSupportedError')) };
  assert.equal(await Auth.challengeFor(rfcVerifier, broken), rfcChallenge, 'SubtleCrypto that fails');

  for (let i = 0; i < 20; i++) {
    const verifier = Auth.createVerifier(webcrypto);
    const challenge = await Auth.challengeFor(verifier, webcrypto.subtle);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, hubChallenge(verifier), 'the hub computes the same challenge');
  }
});

test('the challenge refuses a verifier RFC 7636 does not allow', async () => {
  for (const bad of [undefined, 42, '', 'short', 'a'.repeat(42), 'a'.repeat(129), `${'a'.repeat(42)} `, `${'a'.repeat(42)}+`]) {
    await assert.rejects(Auth.challengeFor(bad, webcrypto.subtle), /verifier/, String(bad));
  }
});

test('only the hub-accepted scheme is allowed', () => {
  assert.deepEqual(Auth.HUB_SCHEMES, ['in.bkesari.app']);
  assert.equal(Auth.isAllowedScheme('in.bkesari.app'), true);
  for (const bad of ['IN.BKESARI.APP', 'in.bkesari.app.evil', 'com.bkesari.ladwani', 'https', '', undefined, null]) {
    assert.equal(Auth.isAllowedScheme(bad), false, String(bad));
  }
});

test('the start URL is the hub contract: /mobile-auth/start?app=<scheme>&challenge=<S256>', async () => {
  const challenge = await Auth.challengeFor(Auth.createVerifier(webcrypto), webcrypto.subtle);
  const url = Auth.startUrl(SITE, SCHEME, challenge);
  assert.equal(url, `https://bkesari.com/mobile-auth/start?app=in.bkesari.app&challenge=${challenge}`);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('app'), SCHEME);
  assert.equal(parsed.searchParams.get('challenge'), challenge);
  assert.equal(Auth.startUrl('https://test.bkesari.com', SCHEME, challenge).startsWith('https://test.bkesari.com/mobile-auth/start?'), true);

  assert.throws(() => Auth.startUrl(SITE, 'com.bkesari.ladwani', challenge), /scheme/);
  assert.throws(() => Auth.startUrl(SITE, SCHEME, 'plain'), /challenge/);
  assert.throws(() => Auth.startUrl(SITE, SCHEME, `${challenge}x`), /challenge/);
  for (const site of ['http://bkesari.com', 'https://bkesari.com/', 'https://bkesari.com/x', 'bkesari.com', 'https://localhost', '']) {
    assert.throws(() => Auth.startUrl(site, SCHEME, challenge), /https origin/, site);
  }
});

test('the callback link: our code, and nothing else', () => {
  const code = '42.1763400000000.Zm9vYmFyYmF6';
  assert.deepEqual(Auth.parseCallback(`in.bkesari.app://auth-callback?code=${code}`, SCHEME), { code });
  assert.deepEqual(Auth.parseCallback(`in.bkesari.app://auth-callback/?code=${code}`, SCHEME), { code });
  assert.deepEqual(Auth.parseCallback(`IN.BKESARI.APP://Auth-Callback?code=${code}`, SCHEME), { code }, 'scheme and host ignore case');
  assert.deepEqual(Auth.parseCallback(`in.bkesari.app://auth-callback?code=${encodeURIComponent(code)}#x`, SCHEME), { code });
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback?code=a%2Eb%7Ec', SCHEME), { code: 'a.b~c' });
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback?state=1&code=abc', SCHEME), { code: 'abc' });

  // Not ours: another scheme, host or path, a look-alike host, or not a link at all.
  for (const url of [
    `com.bkesari.ladwani://auth-callback?code=${code}`,
    `https://bkesari.com/auth-callback?code=${code}`,
    `in.bkesari.app://other?code=${code}`,
    `in.bkesari.app://auth-callbackx?code=${code}`,
    `in.bkesari.app://auth-callback.evil.com?code=${code}`,
    `in.bkesari.app://auth-callback/more?code=${code}`,
    `in.bkesari.app:auth-callback?code=${code}`,
    `x-in.bkesari.app://auth-callback?code=${code}`,
    '',
    undefined,
  ]) {
    assert.equal(Auth.parseCallback(url, SCHEME), null, String(url));
  }
  assert.equal(Auth.parseCallback(`in.bkesari.app://auth-callback?code=${code}`, 'evil'), null, 'unknown configured scheme');

  // Ours, but without a usable code.
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback', SCHEME), { error: 'missing_code' });
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback?code=', SCHEME), { error: 'missing_code' });
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback?code=a%20b', SCHEME), { error: 'missing_code' });
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback?code=a%0Ab', SCHEME), { error: 'missing_code' });
  assert.deepEqual(Auth.parseCallback(`in.bkesari.app://auth-callback?code=${'a'.repeat(2049)}`, SCHEME), { error: 'missing_code' });
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback?error=access_denied', SCHEME), { error: 'access_denied' });
  assert.deepEqual(Auth.parseCallback('in.bkesari.app://auth-callback?error=%3Cb%3E%20x', SCHEME), { error: 'missing_code' });
});

test('the finish URL carries the code and the verifier to /mobile-auth/finish', () => {
  const verifier = Auth.createVerifier(webcrypto);
  const url = Auth.finishUrl(SITE, '42.1763400000000.mac_-', verifier);
  assert.equal(url, `https://bkesari.com/mobile-auth/finish?code=42.1763400000000.mac_-&verifier=${verifier}`);
  const odd = new URL(Auth.finishUrl(SITE, 'a&b=c/d', verifier));
  assert.equal(odd.pathname, '/mobile-auth/finish');
  assert.equal(odd.searchParams.get('code'), 'a&b=c/d', 'the code is escaped');
  assert.equal(odd.searchParams.get('verifier'), verifier);
  assert.throws(() => Auth.finishUrl(SITE, '', verifier), /code/);
  assert.throws(() => Auth.finishUrl(SITE, 'a b', verifier), /code/);
  assert.throws(() => Auth.finishUrl(SITE, 'abc', 'short'), /verifier/);
  assert.throws(() => Auth.finishUrl('http://bkesari.com', 'abc', verifier), /https origin/);
});

test('the app links only to pages of the hub', () => {
  assert.equal(Auth.siteUrl(SITE, '/'), 'https://bkesari.com/');
  assert.equal(Auth.siteUrl(SITE, '/access/request'), 'https://bkesari.com/access/request');
  assert.equal(Auth.siteUrl(SITE, '/account'), 'https://bkesari.com/account');
  assert.equal(Auth.siteUrl(SITE, '/auth/sign-in?next=%2F'), 'https://bkesari.com/auth/sign-in?next=%2F');
  for (const bad of ['', 'account', '//evil.com/', '/\\evil.com', ' /account', '/a b', 'https://evil.com/', undefined]) {
    assert.throws(() => Auth.siteUrl(SITE, bad), /path/, String(bad));
  }
});

test('the pending sign-in is kept until the link comes back, used once, and expires', () => {
  const store = memoryStorage();
  const verifier = Auth.createVerifier(webcrypto);
  const t0 = 1_763_400_000_000;

  Auth.savePending(store, verifier, t0);
  assert.equal(Auth.takePending(store, t0 + 60_000), verifier);
  assert.equal(Auth.takePending(store, t0 + 60_000), null, 'used once');

  Auth.savePending(store, verifier, t0);
  assert.equal(Auth.takePending(store, t0 + Auth.PENDING_TTL_MS + 1), null, 'expired');
  assert.equal(store.getItem(Auth.PENDING_KEY), null, 'and forgotten');

  Auth.savePending(store, verifier, t0 + 5 * 60_000);
  assert.equal(Auth.takePending(store, t0), null, 'saved in the future (clock moved back)');

  const second = Auth.createVerifier(webcrypto);
  Auth.savePending(store, verifier, t0);
  Auth.savePending(store, second, t0 + 1);
  assert.equal(Auth.takePending(store, t0 + 2), second, 'a new sign-in replaces the one before');

  assert.equal(Auth.takePending(store, t0), null, 'nothing saved');
  for (const raw of ['not json', '{}', '{"v":"short","at":1}', JSON.stringify({ v: verifier }), 'null']) {
    store.setItem(Auth.PENDING_KEY, raw);
    assert.equal(Auth.takePending(store, t0), null, raw);
  }
  assert.throws(() => Auth.savePending(store, 'short', t0), /verifier/);
});

test('end to end against a hub that binds the code to the challenge (GoKesari mobile-auth.ts)', async () => {
  // The hub's half, as in GoKesari's createMobileAuthCode / redeemMobileAuthCode.
  const secret = randomBytes(32);
  const mac = (user, expires, challenge) =>
    createHmac('sha256', secret).update(`mobile-auth-code:${user}.${expires}.${challenge}`).digest('base64url');
  const issue = (user, challenge, now) => `${user}.${now + 120_000}.${mac(user, now + 120_000, challenge)}`;
  const redeem = (code, verifier, now) => {
    const [user, expires, given] = code.split('.');
    const expected = Buffer.from(mac(user, expires, hubChallenge(verifier)));
    if (expected.length !== Buffer.from(given).length || !timingSafeEqual(expected, Buffer.from(given))) return null;
    return Number(expires) > now ? user : null;
  };

  const store = memoryStorage();
  const now = Date.now();
  // App: start.
  const verifier = Auth.createVerifier(webcrypto);
  const challenge = await Auth.challengeFor(verifier, webcrypto.subtle);
  Auth.savePending(store, verifier, now);
  const start = new URL(Auth.startUrl(SITE, SCHEME, challenge));
  assert.equal(Auth.isAllowedScheme(start.searchParams.get('app')), true);
  // Hub: Google done, hand the code to the app.
  const code = issue('42', start.searchParams.get('challenge'), now);
  const link = `${start.searchParams.get('app')}://auth-callback?code=${encodeURIComponent(code)}`;
  // App: the link comes back; the WebView opens finish.
  const callback = Auth.parseCallback(link, SCHEME);
  const finish = new URL(Auth.finishUrl(SITE, callback.code, Auth.takePending(store, now + 30_000)));
  // Hub: finish.
  assert.equal(redeem(finish.searchParams.get('code'), finish.searchParams.get('verifier'), now + 30_000), '42');
  assert.equal(redeem(code, Auth.createVerifier(webcrypto), now), null, 'another app that caught the link cannot use it');
  assert.equal(redeem(code, verifier, now + 120_001), null, 'the code lasts two minutes');
});
