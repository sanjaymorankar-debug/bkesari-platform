/**
 * The OpenID provider, for sites on another domain (agtci.com).
 *
 *   GET  /.well-known/openid-configuration   discovery
 *   GET  /oauth/jwks                          signing key
 *   GET  /oauth/authorize                     authorization code, PKCE S256 required
 *   POST /oauth/token                         code → id_token + access_token (server to server)
 *   GET  /oauth/userinfo                      claims, and "is the session still alive"
 *   GET  /oauth/logout                        RP-initiated logout (end_session_endpoint)
 *
 * No refresh tokens: an access token lives an hour and dies with the bkesari
 * session it came from, and the relying party re-runs the (silent) code flow.
 *
 * Every token is bound to the IdP session (`sid`). Logging out anywhere
 * revokes the session, and back-channel logout tells every relying party.
 */
const crypto = require('crypto');
const express = require('express');
const jwt = require('./jwt');
const { nowUtc, parseUtc, randomToken, sha256hex, uuid, escapeHtml } = require('./util');

const CODE_TTL = 60;
const ID_TOKEN_TTL = 600;
const ACCESS_TOKEN_TTL = 3600;
const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

function createOidc({ db, config, service, clients, audit, limiter, cookies, views, log = console }) {
  const router = express.Router();
  const key = config.signingKey;
  const issuer = config.issuer;

  /* ------------------------------------------------------------ discovery */

  router.get('/.well-known/openid-configuration', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      jwks_uri: `${issuer}/oauth/jwks`,
      end_session_endpoint: `${issuer}/oauth/logout`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'email', 'profile'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      claims_supported: ['sub', 'email', 'email_verified', 'name', 'sid', 'auth_time', 'nonce'],
      backchannel_logout_supported: true,
      backchannel_logout_session_supported: true,
    });
  });

  router.get('/oauth/jwks', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ keys: [key.jwk] });
  });

  /* ------------------------------------------------------------ authorize */

  function errorPage(res, req, text) {
    // Never redirect on a bad client or redirect_uri: that is the open-redirect hole.
    res.status(400).set('Content-Security-Policy', views.CSP).type('html')
      .send(views.layout({ ...views.pages.message({ title: 'Sign-in request refused', text, kind: 'error' }), req, resolved: req.bkAuth, env: config.tier }));
  }

  function redirectWith(res, redirectUri, params) {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
    res.redirect(302, u.toString());
  }

  router.get('/oauth/authorize', async (req, res, next) => {
    try {
      const q = req.query;
      const client = await clients.get(q.client_id);
      if (!client || client.kind !== 'oidc') return errorPage(res, req, 'Unknown application.');
      const redirectUri = String(q.redirect_uri || '');
      if (!client.redirect_uris.includes(redirectUri)) return errorPage(res, req, 'That return address is not registered for this application.');
      // Re-checked against the allow-list in case a row was edited by hand.
      try { clients.assertAllowedUri(redirectUri); } catch { return errorPage(res, req, 'That return address is not allowed.'); }

      const state = typeof q.state === 'string' ? q.state.slice(0, 500) : undefined;
      const fail = (error, description) => redirectWith(res, redirectUri, { error, error_description: description, state });
      if (q.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
      const scopes = String(q.scope || '').split(/\s+/).filter(Boolean);
      if (!scopes.includes('openid')) return fail('invalid_scope', 'The openid scope is required.');
      if (!state) return fail('invalid_request', 'state is required.');
      if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(q.code_challenge || ''))) {
        return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
      }
      const nonce = typeof q.nonce === 'string' ? q.nonce.slice(0, 255) : null;
      if (!nonce) return fail('invalid_request', 'nonce is required.');

      const resolved = req.bkAuth;
      if (!resolved) {
        if (q.prompt === 'none') return fail('login_required', 'Not signed in.');
        return res.redirect(302, `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`);
      }

      const code = randomToken(32);
      await db.run(`INSERT INTO auth_oauth_codes (code_hash, client_id, user_id, session_id, redirect_uri, code_challenge, nonce, scope, expires_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [sha256hex(code), client.client_id, resolved.user.id, resolved.session.id, redirectUri, String(q.code_challenge), nonce,
        scopes.filter(s => ['openid', 'email', 'profile'].includes(s)).join(' '), nowUtc(CODE_TTL), nowUtc()]);
      await audit.record({ action: 'OAUTH_CODE_ISSUED', actorId: resolved.user.id, subjectId: resolved.user.id, detail: { client: client.client_id, sid: resolved.session.id }, req });
      redirectWith(res, redirectUri, { code, state });
    } catch (err) { next(err); }
  });

  /* ------------------------------------------------------------ token */

  function tokenError(res, status, error, description) {
    res.status(status).set('Cache-Control', 'no-store').json({ error, error_description: description });
  }

  router.post('/oauth/token', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res, next) => {
    try {
      const client = await clients.authenticate(req, { kind: 'oidc' });
      if (!client) {
        res.set('WWW-Authenticate', 'Basic realm="bkesari"');
        return tokenError(res, 401, 'invalid_client', 'Client authentication failed.');
      }
      if (!limiter.hit(`token:${client.client_id}`, 120, 60_000).ok) return tokenError(res, 429, 'slow_down', 'Too many requests.');
      const b = req.body || {};
      if (b.grant_type !== 'authorization_code') return tokenError(res, 400, 'unsupported_grant_type', 'Only authorization_code.');
      const row = await db.get('SELECT * FROM auth_oauth_codes WHERE code_hash = ?', [sha256hex(b.code || '')]);
      const deny = async (why) => {
        await audit.record({ action: 'OAUTH_TOKEN_DENIED', subjectId: row ? row.user_id : null, detail: { client: client.client_id, why }, req });
        return tokenError(res, 400, 'invalid_grant', 'The code is invalid, expired or already used.');
      };
      if (!row || row.client_id !== client.client_id) return deny('unknown_code');
      if (row.used_at) {
        // A replayed code: end the session it was issued from (RFC 6749 §4.1.2).
        await service.revokeSession(row.session_id, { req });
        return deny('code_reuse');
      }
      if (parseUtc(row.expires_at) <= Date.now()) return deny('expired');
      if (b.redirect_uri !== row.redirect_uri) return deny('redirect_mismatch');
      const verifier = String(b.code_verifier || '');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return deny('bad_verifier');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== row.code_challenge) return deny('pkce_mismatch');
      const used = await db.run('UPDATE auth_oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL', [nowUtc(), row.code_hash]);
      if (!used.changes) return deny('code_race');

      const resolved = await service.resolveSessionId(row.session_id);
      if (!resolved || resolved.user.id !== row.user_id) return deny('session_ended');

      const now = Math.floor(Date.now() / 1000);
      const scopes = row.scope.split(' ');
      const idClaims = {
        iss: issuer, sub: resolved.user.id, aud: client.client_id, iat: now, exp: now + ID_TOKEN_TTL,
        auth_time: Math.floor(parseUtc(resolved.session.created_at) / 1000), nonce: row.nonce, sid: resolved.session.id,
      };
      if (scopes.includes('email')) Object.assign(idClaims, { email: resolved.user.email, email_verified: Boolean(resolved.user.email_verified_at) });
      if (scopes.includes('profile')) idClaims.name = resolved.user.name || null;
      const idToken = jwt.sign(idClaims, key);
      const accessToken = jwt.sign({
        iss: issuer, sub: resolved.user.id, aud: issuer, client_id: client.client_id, scope: row.scope,
        sid: resolved.session.id, iat: now, exp: now + ACCESS_TOKEN_TTL, jti: uuid(),
      }, key, { typ: 'at+jwt' });
      await audit.record({ action: 'OAUTH_TOKEN_ISSUED', actorId: resolved.user.id, subjectId: resolved.user.id, detail: { client: client.client_id, sid: resolved.session.id }, req });
      res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache').json({
        token_type: 'Bearer', access_token: accessToken, expires_in: ACCESS_TOKEN_TTL, id_token: idToken, scope: row.scope,
      });
    } catch (err) { next(err); }
  });

  /* ------------------------------------------------------------ userinfo */

  /** Verifies one of our access tokens and returns its live session, or null. */
  async function resolveAccessToken(token) {
    let payload;
    try {
      ({ payload } = jwt.verify(token, key.publicKey));
    } catch { return null; }
    if (payload.iss !== issuer || payload.aud !== issuer || !payload.sid || !payload.client_id) return null;
    if (!payload.exp || payload.exp * 1000 <= Date.now()) return null;
    const client = await clients.get(payload.client_id);
    if (!client) return null;
    const resolved = await service.resolveSessionId(payload.sid, { touch: true });
    if (!resolved || resolved.user.id !== payload.sub) return null;
    return { resolved, client, payload };
  }

  async function userinfo(req, res, next) {
    try {
      const [scheme, token] = String(req.headers.authorization || '').split(' ');
      const found = scheme === 'Bearer' && token ? await resolveAccessToken(token) : null;
      if (!found) {
        res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
        return res.status(401).set('Cache-Control', 'no-store').json({ error: 'invalid_token' });
      }
      const { resolved, client, payload } = found;
      const scopes = String(payload.scope || '').split(' ');
      const out = { sub: resolved.user.id, sid: resolved.session.id };
      if (scopes.includes('email')) Object.assign(out, { email: resolved.user.email, email_verified: Boolean(resolved.user.email_verified_at) });
      if (scopes.includes('profile')) out.name = resolved.user.name || null;
      // Only what this client's own feature needs: whether the user is
      // entitled to it, and the permissions within it.
      const feature = client.feature_code;
      if (feature) {
        const f = require('./rbac').featureByCode(feature);
        out.bkesari = {
          feature,
          entitled: resolved.evaluation.features.includes(feature),
          permissions: resolved.evaluation.permissions.filter(p => f && p.startsWith(`${f.prefix}.`)),
          subscription: resolved.evaluation.subscriptions.find(s => s.feature === feature) || null,
          mfa: resolved.mfa,
        };
      }
      res.set('Cache-Control', 'no-store').json(out);
    } catch (err) { next(err); }
  }
  router.get('/oauth/userinfo', userinfo);
  router.post('/oauth/userinfo', userinfo);

  /* ------------------------------------------------------------ logout */

  /**
   * Tells every relying party with a back-channel endpoint that a session
   * ended. Fire and forget: a relying party that misses this still finds out
   * at its next userinfo check.
   */
  async function notifyLogout({ sid, userId }) {
    let targets;
    try { targets = await clients.withBackchannel(); } catch (err) { log.error(`backchannel: ${err.message}`); return []; }
    const now = Math.floor(Date.now() / 1000);
    return Promise.all(targets.map(async (t) => {
      const token = jwt.sign({
        iss: issuer, aud: t.client_id, iat: now, exp: now + 120, jti: uuid(), sid, sub: userId,
        events: { [BACKCHANNEL_EVENT]: {} },
      }, key, { typ: 'logout+jwt' });
      try {
        const r = await fetch(t.backchannel_logout_uri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ logout_token: token }).toString(),
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
        if (!r.ok) log.error(`backchannel logout to ${t.client_id} answered ${r.status}`);
        return { client: t.client_id, status: r.status };
      } catch (err) {
        log.error(`backchannel logout to ${t.client_id} failed: ${err.message}`);
        return { client: t.client_id, error: err.message };
      }
    }));
  }

  /**
   * end_session_endpoint. With a valid id_token_hint the logout happens at
   * once (the hint proves which session the relying party means). Without
   * one, the visitor is asked to confirm, so a link on another site cannot
   * sign anyone out.
   */
  router.get('/oauth/logout', async (req, res, next) => {
    try {
      const q = req.query;
      let hint = null;
      if (q.id_token_hint) {
        try {
          const { payload } = jwt.verify(String(q.id_token_hint), key.publicKey);
          if (payload.iss === issuer && payload.sid) hint = payload; // expiry deliberately not checked
        } catch { hint = null; }
      }
      const client = hint ? await clients.get(hint.aud) : null;
      const postLogout = String(q.post_logout_redirect_uri || '');
      const target = client && postLogout && client.post_logout_redirect_uris.includes(postLogout) ? postLogout : null;

      if (!hint) {
        const page = views.pages.message({ title: 'Sign out?', text: 'Use the button below to sign out of bkesari.com.', kind: 'info', link: { href: '/auth/logout', label: 'Continue' } });
        return res.set('Content-Security-Policy', views.CSP).type('html').send(views.layout({ ...page, req, resolved: req.bkAuth, env: config.tier }));
      }

      const ended = new Set();
      if (await service.revokeSession(hint.sid, { req })) ended.add(hint.sid);
      const current = req.bkAuth;
      if (current && current.user.id === hint.sub && current.session.id !== hint.sid) {
        if (await service.revokeSession(current.session.id, { req })) ended.add(current.session.id);
      }
      if (current && current.user.id === hint.sub) cookies.clearSession(res);
      await audit.record({ action: 'OAUTH_LOGOUT', actorId: hint.sub, subjectId: hint.sub, detail: { client: hint.aud, sids: [...ended] }, req });
      for (const sid of ended) notifyLogout({ sid, userId: hint.sub });

      if (target) return redirectWith(res, target, { state: typeof q.state === 'string' ? q.state.slice(0, 500) : undefined });
      const page = views.pages.message({ title: 'Signed out', text: 'You are signed out of bkesari.com and agtci.com.', kind: 'ok', link: { href: '/', label: 'Home' } });
      res.set('Content-Security-Policy', views.CSP).type('html').send(views.layout({ ...page, req, resolved: null, env: config.tier }));
    } catch (err) { next(err); }
  });

  return { router, notifyLogout, resolveAccessToken, escapeHtml };
}

module.exports = { createOidc, BACKCHANNEL_EVENT };
