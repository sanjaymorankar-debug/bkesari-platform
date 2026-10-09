/**
 * Cross-domain single sign-on for agtci.com: the OpenID Connect
 * authorization-code flow with PKCE against the real hub, a stand-in relying
 * party that receives back-channel logout, and single logout both ways.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { startHub, client, makeUser, login } = require('./helpers/auth-harness');

let hub, rp, rpBase, clientSecret;
const loggedOut = [];
const REDIRECT = 'http://localhost:4999/auth/callback';
const POST_LOGOUT = 'http://localhost:4999/';

test.before(async () => {
  // Stand-in for agtci.com's back-channel logout endpoint.
  rp = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { loggedOut.push(new URLSearchParams(body).get('logout_token')); res.end('ok'); });
  });
  await new Promise(r => rp.listen(0, '127.0.0.1', r));
  rpBase = `http://127.0.0.1:${rp.address().port}`;
  hub = await startHub();
  ({ secret: clientSecret } = await hub.auth.clients.register({
    clientId: 'agtci-dev', kind: 'oidc', tier: 'dev', feature: 'AGTCI',
    redirectUris: [REDIRECT], postLogoutRedirectUris: [POST_LOGOUT], backchannelLogoutUri: `${rpBase}/auth/backchannel-logout`,
  }));
});
test.after(async () => { await hub.close(); rp.closeAllConnections?.(); rp.close(); });
test.beforeEach(() => { hub.auth.limiter.clear(); loggedOut.length = 0; });

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeUrl({ challenge, state = 'st-' + Math.random(), nonce = 'n-' + Math.random(), redirect = REDIRECT, extra = {} }) {
  const q = new URLSearchParams({ response_type: 'code', client_id: 'agtci-dev', redirect_uri: redirect, scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', ...extra });
  return { url: `/auth/oauth/authorize?${q}`, state, nonce };
}

async function exchange(code, verifier, { secret = clientSecret, redirect = REDIRECT } = {}) {
  return client(hub.base).request('/auth/oauth/token', {
    method: 'POST',
    form: { grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier },
    headers: { authorization: 'Basic ' + Buffer.from(`agtci-dev:${secret}`).toString('base64') },
  });
}

async function verifyJwt(token) {
  const jwks = (await client(hub.base).request('/auth/oauth/jwks')).json();
  const [h, p, s] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  assert.ok(ok, 'signature verifies against the published JWKS');
  return { header, payload: JSON.parse(Buffer.from(p, 'base64url')) };
}

/** The whole relying-party login: returns tokens and the browser. */
async function rpLogin(browser) {
  const { verifier, challenge } = pkce();
  const { url, state, nonce } = authorizeUrl({ challenge });
  const r = await browser.request(url);
  assert.equal(r.status, 302);
  const back = new URL(r.location);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get('state'), state);
  const t = await exchange(back.searchParams.get('code'), verifier);
  assert.equal(t.status, 200, t.text);
  const tokens = t.json();
  const { payload } = await verifyJwt(tokens.id_token);
  assert.equal(payload.nonce, nonce);
  return { tokens, idClaims: payload };
}

test('discovery advertises PKCE, back-channel logout and the endpoints', async () => {
  const d = (await client(hub.base).request('/auth/.well-known/openid-configuration')).json();
  assert.equal(d.issuer, `${hub.auth.config.publicUrl}/auth`);
  assert.deepEqual(d.code_challenge_methods_supported, ['S256']);
  assert.equal(d.backchannel_logout_supported, true);
  assert.match(d.end_session_endpoint, /\/auth\/oauth\/logout$/);
});

test('not signed in on bkesari.com: authorize sends the browser to the login page, then on', async () => {
  await makeUser(hub, 'client@example.com', { subs: { AGTCI: 'active' } });
  const browser = client(hub.base);
  const { challenge } = pkce();
  const { url } = authorizeUrl({ challenge });
  const r = await browser.request(url);
  assert.equal(r.status, 302);
  assert.equal(r.location, `/auth/login?return_to=${encodeURIComponent(url)}`);
  const done = await browser.post('/auth/login', { email: 'client@example.com', password: require('./helpers/auth-harness').PASSWORD, return_to: url });
  assert.equal(done.status, 303);
  assert.equal(done.location, url, 'back to authorize after signing in');
});

test('already signed in on bkesari.com: SSO is silent, tokens are bound to the session', async () => {
  const user = await makeUser(hub, 'silent@example.com', { name: 'Silent', subs: { AGTCI: 'active' } });
  const browser = await login(hub, 'silent@example.com');
  const { tokens, idClaims } = await rpLogin(browser);
  assert.equal(idClaims.iss, `${hub.auth.config.publicUrl}/auth`);
  assert.equal(idClaims.aud, 'agtci-dev');
  assert.equal(idClaims.sub, user.id);
  assert.equal(idClaims.email, 'silent@example.com');
  assert.ok(idClaims.sid);
  assert.ok(idClaims.exp > Date.now() / 1000);

  const info = await client(hub.base).request('/auth/oauth/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(info.status, 200);
  const claims = info.json();
  assert.equal(claims.sub, user.id);
  assert.deepEqual(claims.bkesari, { feature: 'AGTCI', entitled: true, permissions: ['agtci.view_client_area'], subscription: { feature: 'AGTCI', status: 'active', expires_at: null }, mfa: false });
  assert.doesNotMatch(info.text, /ladwani|atip/i, 'only the client\'s own feature');
});

test('prompt=none while signed out answers login_required to the client', async () => {
  const { challenge } = pkce();
  const { url, state } = authorizeUrl({ challenge, extra: { prompt: 'none' } });
  const r = await client(hub.base).request(url);
  const back = new URL(r.location);
  assert.equal(back.searchParams.get('error'), 'login_required');
  assert.equal(back.searchParams.get('state'), state);
});

test('an unregistered redirect_uri is refused on the page, never redirected to', async () => {
  await makeUser(hub, 'redir@example.com');
  const browser = await login(hub, 'redir@example.com');
  for (const bad of ['https://evil.example/cb', 'https://gokesari.com/auth/callback', `${REDIRECT}/extra`, 'http://localhost:4999/auth/callback?x=1']) {
    const { challenge } = pkce();
    const r = await browser.request(authorizeUrl({ challenge, redirect: bad }).url);
    assert.equal(r.status, 400, bad);
    assert.equal(r.location, null, bad);
  }
  const r = await browser.request(`/auth/oauth/authorize?response_type=code&client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}`);
  assert.equal(r.status, 400);
});

test('PKCE is required, and a wrong verifier or a wrong secret gets nothing', async () => {
  await makeUser(hub, 'pkce@example.com');
  const browser = await login(hub, 'pkce@example.com');
  // No code_challenge: error back to the (registered) client.
  const noPkce = await browser.request(authorizeUrl({ challenge: '' }).url);
  assert.equal(new URL(noPkce.location).searchParams.get('error'), 'invalid_request');

  const { verifier, challenge } = pkce();
  let r = await browser.request(authorizeUrl({ challenge }).url);
  const code = new URL(r.location).searchParams.get('code');
  r = await exchange(code, verifier, { secret: 'wrong' });
  assert.equal(r.status, 401);
  r = await exchange(code, pkce().verifier);
  assert.equal(r.status, 400);
  assert.equal(r.json().error, 'invalid_grant');
});

test('a replayed code is refused and ends the session it came from', async () => {
  await makeUser(hub, 'replay@example.com');
  const browser = await login(hub, 'replay@example.com');
  const { verifier, challenge } = pkce();
  const r = await browser.request(authorizeUrl({ challenge }).url);
  const code = new URL(r.location).searchParams.get('code');
  assert.equal((await exchange(code, verifier)).status, 200);
  const again = await exchange(code, verifier);
  assert.equal(again.status, 400);
  assert.equal((await browser.request('/auth/api/me')).status, 401);
});

test('logout on bkesari.com: back-channel logout reaches agtci.com, and its tokens stop working', async () => {
  await makeUser(hub, 'slo1@example.com', { subs: { AGTCI: 'active' } });
  const browser = await login(hub, 'slo1@example.com');
  const { tokens, idClaims } = await rpLogin(browser);
  await browser.post('/auth/logout', {}, { csrfFrom: '/auth/account' });
  for (let i = 0; i < 50 && !loggedOut.length; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(loggedOut.length, 1, 'one back-channel call');
  const { header, payload } = await verifyJwt(loggedOut[0]);
  assert.equal(header.typ, 'logout+jwt');
  assert.equal(payload.sid, idClaims.sid);
  assert.equal(payload.aud, 'agtci-dev');
  assert.ok(payload.events['http://schemas.openid.net/event/backchannel-logout']);
  assert.equal(payload.nonce, undefined, 'a logout token never carries a nonce');
  const info = await client(hub.base).request('/auth/oauth/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
  assert.equal(info.status, 401);
});

test('logout on agtci.com (end_session with id_token_hint) ends the bkesari.com session too', async () => {
  await makeUser(hub, 'slo2@example.com', { subs: { AGTCI: 'active' } });
  const browser = await login(hub, 'slo2@example.com');
  const { tokens } = await rpLogin(browser);
  const q = new URLSearchParams({ id_token_hint: tokens.id_token, post_logout_redirect_uri: POST_LOGOUT, state: 'bye' });
  const r = await browser.request(`/auth/oauth/logout?${q}`);
  assert.equal(r.status, 302);
  assert.equal(r.location, `${POST_LOGOUT}?state=bye`);
  assert.equal((await browser.request('/auth/api/me')).status, 401, 'bkesari.com session ended');
  assert.equal(browser.jar.get('bk_sso'), undefined, 'cookie cleared');
});

test('end_session without a hint asks first, and an unregistered post-logout target is ignored', async () => {
  await makeUser(hub, 'slo3@example.com');
  const browser = await login(hub, 'slo3@example.com');
  let r = await browser.request(`/auth/oauth/logout?post_logout_redirect_uri=${encodeURIComponent('https://evil.example/')}`);
  assert.equal(r.status, 200);
  assert.equal((await browser.request('/auth/api/me')).status, 200, 'still signed in');
  const { tokens } = await rpLogin(browser);
  r = await browser.request(`/auth/oauth/logout?id_token_hint=${tokens.id_token}&post_logout_redirect_uri=${encodeURIComponent('https://evil.example/')}`);
  assert.equal(r.status, 200, 'signed out, but not sent to an unregistered address');
  assert.equal(r.location, null);
});

test('userinfo says entitled: false to a signed-in user without the AGTCI feature', async () => {
  await makeUser(hub, 'noagtci@example.com');
  const browser = await login(hub, 'noagtci@example.com');
  const { tokens } = await rpLogin(browser);
  const info = (await client(hub.base).request('/auth/oauth/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
  assert.equal(info.bkesari.entitled, false);
  assert.deepEqual(info.bkesari.permissions, []);
});
