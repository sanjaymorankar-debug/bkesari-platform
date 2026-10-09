/**
 * "Continue with Google": OpenID Connect with Google as the provider,
 * authorization code + PKCE, state and nonce in a sealed cookie.
 *
 * The ID token is taken straight from Google's token endpoint over TLS, which
 * OpenID Connect Core §3.1.3.7 accepts in place of a signature check; its
 * issuer, audience, expiry and nonce are still verified.
 */
const crypto = require('crypto');
const { seal, unseal } = require('./state');
const { randomToken, parseCookies, serializeCookie, appendCookie } = require('./util');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const COOKIE = 'bk_google';

function createGoogle({ config, fetchImpl = (...a) => fetch(...a) }) {
  const redirectUri = `${config.publicUrl}/auth/google/callback`;

  /** Returns the URL to send the browser to, and sets the state cookie. */
  function start(res, { returnTo, consent }) {
    const state = randomToken(24);
    const nonce = randomToken(24);
    const verifier = randomToken(48);
    appendCookie(res, serializeCookie(COOKIE, seal(config.keys.state, { state, nonce, verifier, returnTo, consent: Boolean(consent) }, 600), {
      secure: config.secure, sameSite: 'Lax', path: '/auth/google', maxAge: 600,
    }));
    const u = new URL(AUTH_URL);
    u.search = new URLSearchParams({
      client_id: config.google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', prompt: 'select_account',
    }).toString();
    return u.toString();
  }

  /** Completes the flow. Returns { claims, returnTo, consent } or throws. */
  async function callback(req, res) {
    const sealed = unseal(config.keys.state, parseCookies(req.headers.cookie)[COOKIE]);
    appendCookie(res, serializeCookie(COOKIE, '', { secure: config.secure, path: '/auth/google', maxAge: 0 }));
    if (!sealed || !req.query.state || req.query.state !== sealed.state) throw new Error('Google sign-in expired or was not started here. Try again.');
    if (req.query.error) throw new Error('Google sign-in was cancelled.');
    const r = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code || ''), client_id: config.google.clientId, client_secret: config.google.clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: sealed.verifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error('Google did not accept the sign-in. Try again.');
    const body = await r.json();
    const parts = String(body.id_token || '').split('.');
    if (parts.length !== 3) throw new Error('Google returned no identity.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!ISSUERS.includes(claims.iss)) throw new Error('Unexpected issuer.');
    if (claims.aud !== config.google.clientId) throw new Error('Unexpected audience.');
    if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('Expired identity.');
    if (claims.nonce !== sealed.nonce) throw new Error('Nonce mismatch.');
    return {
      claims: { sub: claims.sub, email: claims.email, emailVerified: claims.email_verified === true || claims.email_verified === 'true', name: claims.name || null },
      returnTo: sealed.returnTo,
      consent: sealed.consent,
    };
  }

  return { start, callback, redirectUri };
}

module.exports = { createGoogle };
