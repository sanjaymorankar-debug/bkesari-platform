'use strict';

/* ============================================================
   The bkesari ID (decision D-039, docs/design/bkesari-id.md).

   One account per person, in the hub's `users` table, signed in once at
   bkesari.com:
     - Continue with Google: OpenID Connect, authorization code + PKCE
       (S256), state and nonce; the ID token's signature is checked against
       Google's published keys (JWKS), then iss, aud, exp, nonce and
       email_verified. The account is found by google_sub, else by email only
       when that account's email is confirmed (GoKesari's
       allowDangerousEmailAccountLinking: false, and D-035), else created.
     - the email code, and the built-in administrators' username + password
       (D-036), both through portal/project-auth.js, which also gives the
       session (bk_sid, Path=/, HttpOnly, Secure, SameSite=Lax, the token kept
       only as a SHA-256), CSRF, rate limits, lockout and the sign-in audit.
     - the mobile apps: Google runs in the system browser (/mobile-auth/start
       and /complete), which hands the app a two-minute code bound to a PKCE
       challenge; the app's WebView trades it at /mobile-auth/finish for its
       own session (GoKesari's src/server/mobile-auth.ts).

   Roles: 'owner' for the built-in administrators (ATIP, and the top role in
   every project), 'admin' for a confirmed address on HUB_OWNER_EMAILS
   (decides access requests), else 'member'.
   ============================================================ */

const crypto = require('crypto');
const { createProjectAuth, normalizeEmail, AuthError } = require('./project-auth');
const builtin = require('./builtin-admins');

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const STATE_SECONDS = 10 * 60;
const HTTP_TIMEOUT_MS = 10000;
const CLOCK_SKEW_MS = 60 * 1000;
const MOBILE_CODE_MS = 2 * 60 * 1000;
const MOBILE_COOKIE = 'bk_mobile_auth';
const GOOGLE_COOKIE = 'bk_google';
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
// App URL schemes allowed to receive a sign-in code (the mobile apps' ids).
const DEFAULT_APP_SCHEMES = ['in.bkesari.app', 'com.bkesari.ladwani', 'com.bkesari.education', 'com.bkesari.tasklist'];

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');

function sameText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a || '').length > 0;
}

/** GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (GoKesari's AUTH_GOOGLE_ID/_SECRET names also read). Either blank: off. */
function googleConfig(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || env.AUTH_GOOGLE_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || env.AUTH_GOOGLE_SECRET || '').trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function ownerEmails(env = process.env) {
  return new Set(String(env.HUB_OWNER_EMAILS || 'agtcipl@gmail.com')
    .split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));
}

function appSchemes(env = process.env) {
  const extra = String(env.MOBILE_APP_SCHEMES || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return new Set([...DEFAULT_APP_SCHEMES, ...extra].filter((s) => /^[a-z][a-z0-9+.-]{2,60}$/.test(s)));
}

/** A same-site path to land on after sign-in, or '/'. */
function safeNext(value, fallback = '/') {
  const n = String(value || '');
  return /^\/(?![/\\])/.test(n) && !/[\s\\]/.test(n) && n.length <= 500 ? n : fallback;
}

/**
 * Where "Continue with Google" leads in this browser, or null to hide it.
 * Google refuses sign-in inside an app's WebView, so: in the bkesari app
 * (its user agent ends in "bkesariApp/<version> (android|ios)") the button
 * opens the app's own start screen, which runs Google in the system browser
 * (/mobile-auth/start); in another app's WebView (the older project shells,
 * Facebook's or Instagram's in-app browser) there is no button and the email
 * code is the way in; anywhere else, the hub's own flow.
 */
function googleEntry(userAgent, next) {
  const ua = String(userAgent || '');
  const app = /\bbkesariApp\/[\d.]+ \((android|ios)\)/i.exec(ua);
  if (app) return app[1].toLowerCase() === 'ios' ? 'capacitor://localhost/?google=1' : 'https://localhost/?google=1';
  if (/; wv\)/.test(ua) || /\b(FBAN|FBAV|FB_IAB|Instagram)\b/.test(ua) || (/\b(iPhone|iPad|iPod)\b/.test(ua) && !/\bSafari\//.test(ua))) return null;
  return `/auth/google/start?next=${encodeURIComponent(safeNext(next))}`;
}

/**
 * Google's signing keys, fetched from its JWKS and kept for as long as its
 * Cache-Control says (at most a day). An unknown kid refetches, at most once a minute.
 */
function createJwks({ fetchImpl, url = GOOGLE_JWKS, now = () => Date.now() }) {
  let keys = new Map();
  let expires = 0;
  let lastFetch = 0;
  async function refresh() {
    lastFetch = now();
    const r = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`Google JWKS answered ${r.status}`);
    const body = await r.json();
    const next = new Map();
    for (const jwk of (body && body.keys) || []) {
      if (jwk && jwk.kid && jwk.kty === 'RSA') next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    }
    if (!next.size) throw new Error('Google JWKS had no RSA keys');
    const cc = typeof r.headers?.get === 'function' ? String(r.headers.get('cache-control') || '') : '';
    const maxAge = Math.min(Number((/max-age=(\d+)/.exec(cc) || [])[1]) || 3600, 86400);
    keys = next;
    expires = now() + maxAge * 1000;
  }
  return async function keyFor(kid) {
    if (!keys.size || now() > expires) await refresh();
    if (!keys.has(kid) && now() - lastFetch > 60 * 1000) await refresh();
    return keys.get(kid) || null;
  };
}

/**
 * The verified claims of a Google ID token, or throws with a short reason:
 * RS256 signature by a key from Google's JWKS, issuer, audience, expiry,
 * nonce and a confirmed email.
 */
async function verifyIdToken(idToken, { keyFor, clientId, nonce, now = Date.now() }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('malformed');
  let header; let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new Error('malformed'); }
  if (!header || header.alg !== 'RS256' || !header.kid) throw new Error('algorithm');
  const key = await keyFor(header.kid);
  if (!key) throw new Error('unknown key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('signature');
  if (!claims || !GOOGLE_ISSUERS.has(claims.iss)) throw new Error('issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId) || (aud.length > 1 && claims.azp !== clientId)) throw new Error('audience');
  if (!(Number(claims.exp) * 1000 > now - CLOCK_SKEW_MS)) throw new Error('expired');
  if (Number(claims.iat) * 1000 > now + CLOCK_SKEW_MS) throw new Error('issued in the future');
  if (!nonce || !sameText(claims.nonce, nonce)) throw new Error('nonce');
  if (!(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('unverified');
  if (!normalizeEmail(claims.email) || !claims.sub) throw new Error('email');
  return claims;
}

/**
 * @param db      the hub database (hub_schema.sql applied)
 * @param env     process.env-like (GOOGLE_CLIENT_ID/SECRET, HUB_OWNER_EMAILS, MOBILE_APP_SCHEMES, BUILTIN_ADMIN_PASSWORD_HASH)
 * @param secret  HMAC secret (32+ chars): codes, the state cookies, mobile codes
 * @param fetch   fetch for Google (tests pass a fake)
 */
function createBkesariId({ db, env = process.env, secret, notify = {}, tier = () => 'prod', log = console, fetch: fetchImpl, now = () => Date.now() } = {}) {
  const google = googleConfig(env);
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const keyFor = createJwks({ fetchImpl: doFetch, now });
  const owners = ownerEmails(env);
  const schemes = appSchemes(env);
  const key = secret || crypto.randomBytes(32).toString('hex');

  const auth = createProjectAuth({
    db, key: 'bkesari', name: 'bkesari', base: '/account', cookie: 'bk_sid', cookiePath: '/', prefix: 'hub_',
    tables: { users: 'users', sessions: 'hub_sessions', resets: 'hub_password_resets', otp: 'hub_otp_codes', audit: 'hub_auth_audit_log', limits: 'hub_rate_limits' },
    allowSignUp: true, allowPasswordSignUp: false, methods: ['otp', 'password'],
    codeNote: 'This is your bkesari ID: one sign-in for every bkesari project.',
    notify, tier, log, secret: crypto.createHash('sha256').update(`bkesari-id|${key}`).digest('hex'),
    builtinAdmins: { role: 'owner', env },
    accountLinks: [{ label: 'My projects', href: '/account' }],
  });

  const mac = (purpose, v) => crypto.createHmac('sha256', key).update(`${purpose}|${v}`).digest('base64url');
  const plainLocal = auth.plainLocal;
  const origin = (req) => `${plainLocal(req) ? 'http' : 'https'}://${req.headers.host}`;
  const redirectUri = (req) => `${origin(req)}/auth/google/callback`;

  /** The signed-in person (with `role` resolved), or null. */
  async function currentUser(req) {
    const s = await auth.currentSession(req);
    if (!s) return null;
    const u = s.user;
    const email = String(u.email || '').toLowerCase();
    let role = u.role === 'owner' ? 'owner' : 'member';
    if (role !== 'owner' && u.email_verified && owners.has(email)) role = 'admin';
    return { ...u, id: Number(u.id), email, role, csrf: s.csrf, sessionId: s.sessionId };
  }

  function setState(req, res, name, value, path) {
    const payload = b64u(JSON.stringify(value));
    auth.setCookie(req, res, `${name}=${payload}.${mac(name, payload)}`, { maxAge: STATE_SECONDS, path });
  }
  function readState(req, name) {
    const raw = auth.readCookie(req, name);
    if (!raw) return null;
    const [payload, sig, extra] = raw.split('.');
    if (!payload || !sig || extra !== undefined || !sameText(sig, mac(name, payload))) return null;
    let v;
    try { v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    return v && typeof v === 'object' && Number(v.t) + STATE_SECONDS * 1000 > now() ? v : null;
  }
  const clearState = (req, res, name, path) => auth.setCookie(req, res, `${name}=`, { maxAge: 0, path });

  /** Finds, links or makes the account for a verified Google identity. Throws AuthError(code). */
  async function googleAccount(req, claims) {
    const email = normalizeEmail(claims.email);
    if (builtin.isReservedEmail(email)) throw new AuthError(403, 'builtin', 'This account signs in with its username and password.');
    const picture = typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture.slice(0, 500) : null;
    const nm = String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || '').trim().slice(0, 120) || null;
    const out = await db.tx(async (q) => {
      let user = await q.get('SELECT * FROM users WHERE google_sub = $1 FOR UPDATE', [String(claims.sub)]);
      if (!user) {
        user = await q.get('SELECT * FROM users WHERE lower(email) = $1 FOR UPDATE', [email]);
        if (user) {
          // No automatic linking to an account whose email nobody has confirmed (D-035, D-039).
          if (!user.email_verified) throw new AuthError(403, 'unconfirmed', 'An account with this email exists but its email is not confirmed.');
          if (user.google_sub && user.google_sub !== String(claims.sub)) throw new AuthError(409, 'conflict', 'This email belongs to another Google account.');
          user = await q.get(`UPDATE users SET google_sub = $2, picture = COALESCE(picture, $3), name = COALESCE(name, $4)
            WHERE id = $1 RETURNING *`, [user.id, String(claims.sub), picture, nm]);
          return { user, linked: true };
        }
        const fresh = await q.get(`INSERT INTO users (email, name, picture, google_sub, email_verified) VALUES ($1,$2,$3,$4,TRUE)
          ON CONFLICT DO NOTHING RETURNING *`, [email, nm, picture, String(claims.sub)]);
        if (!fresh) throw new AuthError(409, 'retry', 'Please try again.');
        return { user: fresh, created: true };
      }
      if (picture && user.picture !== picture) user = await q.get('UPDATE users SET picture = $2 WHERE id = $1 RETURNING *', [user.id, picture]);
      return { user };
    });
    if (out.user.status !== 'active') throw new AuthError(403, 'status', 'This account is suspended.');
    if (out.created) await auth.audit(out.user.id, email, 'sign-up', 'google', req);
    if (out.linked) await auth.audit(out.user.id, email, 'google-linked', 'confirmed email', req);
    return out.user;
  }

  /* ---------- pages for the mobile hand-off (system browser) ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function browserPage(res, { status = 200, title, message, continueUrl }) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
${continueUrl ? `<meta http-equiv="refresh" content="0;url=${esc(continueUrl)}">` : ''}
<title>${esc(title)} — bkesari</title><link rel="stylesheet" href="/kesari-ui/1.0.0/kesari.css"></head>
<body><main class="k-main k-main--narrow"><div class="k-card"><h1>${esc(title)}</h1><p>${esc(message)}</p>
${continueUrl ? `<p><a class="k-btn k-btn--brand" href="${esc(continueUrl)}">Return to the app</a></p>` : ''}</div></main></body></html>`);
  }

  function createMobileCode(userId, challenge) {
    const expires = String(now() + MOBILE_CODE_MS);
    return `${userId}.${expires}.${mac('mobile-auth-code', `${userId}.${expires}.${challenge}`)}`;
  }
  function redeemMobileCode(code, verifier) {
    if (!VERIFIER.test(String(verifier || ''))) return null;
    const parts = String(code || '').split('.');
    if (parts.length !== 3) return null;
    const [userId, expires, sig] = parts;
    if (!/^\d{1,15}$/.test(userId) || !/^\d{1,15}$/.test(expires)) return null;
    if (!sameText(sig, mac('mobile-auth-code', `${userId}.${expires}.${sha256b64u(verifier)}`))) return null;
    return Number(expires) > now() ? Number(userId) : null;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function mount(app) {
    auth.mount(app, '/account/api/auth');
    app.get('/account/sign-in', (req, res) => res.redirect(302, `/auth/sign-in${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`));

    app.get('/auth/google/start', wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!google) return res.status(404).type('text/plain').send('Google sign-in is not set up on this site.');
      try { await auth.limit(`google:start:${auth.clientIp(req)}`, 30, 15 * 60); } catch (err) {
        if (err instanceof AuthError) return res.redirect(302, '/auth/sign-in?error=google_rate_limited');
        throw err;
      }
      const st = { s: b64u(crypto.randomBytes(32)), n: b64u(crypto.randomBytes(24)), v: b64u(crypto.randomBytes(32)), next: safeNext(req.query.next), t: now() };
      setState(req, res, GOOGLE_COOKIE, st, '/auth/google');
      const url = new URL(GOOGLE_AUTHORIZE);
      url.search = new URLSearchParams({
        client_id: google.clientId, redirect_uri: redirectUri(req), response_type: 'code', scope: 'openid email profile',
        state: st.s, nonce: st.n, code_challenge: sha256b64u(st.v), code_challenge_method: 'S256', prompt: 'select_account',
      }).toString();
      res.redirect(302, url.toString());
    }));

    app.get('/auth/google/callback', wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!google) return res.status(404).type('text/plain').send('Google sign-in is not set up on this site.');
      const st = readState(req, GOOGLE_COOKIE);
      clearState(req, res, GOOGLE_COOKIE, '/auth/google'); // single use, whatever happens
      const back = (code) => (st && st.next === '/mobile-auth/complete'
        // Started by the app: the failure goes back to it, not to the hub's page in the system browser.
        ? res.redirect(302, `/mobile-auth/complete?error=${code}`)
        : res.redirect(302, `/auth/sign-in?error=google_${code}${st && st.next !== '/' ? `&next=${encodeURIComponent(st.next)}` : ''}`));
      if (req.query.error) return back('cancelled');
      try { await auth.limit(`google:callback:${auth.clientIp(req)}`, 30, 15 * 60); } catch (err) {
        if (err instanceof AuthError) return back('rate_limited');
        throw err;
      }
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!st || !code || !sameText(req.query.state, st.s)) return back('state');
      let claims;
      try {
        const r = await doFetch(GOOGLE_TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ code, client_id: google.clientId, client_secret: google.clientSecret,
            redirect_uri: redirectUri(req), grant_type: 'authorization_code', code_verifier: st.v }).toString(),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok || !data || typeof data.id_token !== 'string') throw new Error(`token endpoint answered ${r.status}${data && data.error ? ` (${data.error})` : ''}`);
        claims = await verifyIdToken(data.id_token, { keyFor, clientId: google.clientId, nonce: st.n, now: now() });
      } catch (err) {
        log.error('bkesari: Google sign-in refused:', err.message);
        await auth.audit(null, null, 'sign-in-refused', `google: ${err.message}`.slice(0, 200), req);
        return back(err.message === 'unverified' ? 'unverified' : 'failed');
      }
      let user;
      try { user = await googleAccount(req, claims); } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        await auth.audit(null, normalizeEmail(claims.email), 'sign-in-refused', `google: ${err.code}`, req);
        return back(err.code);
      }
      // A different person's session in this browser ends first.
      const prior = await auth.currentSession(req);
      if (prior && Number(prior.user.id) !== Number(user.id)) await db.run('DELETE FROM hub_sessions WHERE id = $1', [prior.sessionId]);
      await auth.startSession(req, res, user, 'google');
      res.redirect(302, st.next);
    }));

    /* ---------- mobile apps ---------- */
    app.get('/mobile-auth/start', wrap(async (req, res) => {
      const challenge = String(req.query.challenge || '');
      const appScheme = String(req.query.app || '');
      if (!CHALLENGE.test(challenge) || !schemes.has(appScheme)) {
        return browserPage(res, { status: 400, title: 'Sign-in link not valid', message: 'Go back to the bkesari app and tap Continue with Google again.' });
      }
      if (!google) {
        return browserPage(res, { status: 503, title: 'Google sign-in is unavailable', message: 'Go back to the bkesari app and sign in with a code sent to your email instead.' });
      }
      setState(req, res, MOBILE_COOKIE, { app: appScheme, c: challenge, t: now() }, '/mobile-auth');
      res.redirect(302, '/auth/google/start?next=%2Fmobile-auth%2Fcomplete');
    }));

    app.get('/mobile-auth/complete', wrap(async (req, res) => {
      const st = readState(req, MOBILE_COOKIE);
      if (!st || !schemes.has(st.app) || !CHALLENGE.test(String(st.c || ''))) {
        return browserPage(res, { status: 400, title: 'This sign-in has expired', message: 'Go back to the bkesari app and tap Continue with Google again.' });
      }
      const failed = /^[a-z_]{1,30}$/.test(String(req.query.error || '')) ? String(req.query.error) : '';
      const user = failed ? null : await currentUser(req);
      clearState(req, res, MOBILE_COOKIE, '/mobile-auth');
      if (!user) {
        // The app shows the reason and offers to try again.
        return browserPage(res, { title: 'Sign-in did not finish', message: 'Returning you to the bkesari app…', continueUrl: `${st.app}://auth-callback?error=${encodeURIComponent(failed || 'signin')}` });
      }
      const code = createMobileCode(user.id, st.c);
      await auth.audit(user.id, user.email, 'mobile-code', st.app, req);
      browserPage(res, { title: "You're signed in", message: 'Returning you to the bkesari app…', continueUrl: `${st.app}://auth-callback?code=${encodeURIComponent(code)}` });
    }));

    app.get('/mobile-auth/finish', wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try { await auth.limit(`mobile:finish:${auth.clientIp(req)}`, 30, 15 * 60); } catch (err) {
        if (err instanceof AuthError) return res.redirect(302, '/auth/sign-in?error=google_rate_limited');
        throw err;
      }
      const userId = redeemMobileCode(req.query.code, req.query.verifier);
      const user = userId ? await db.get("SELECT * FROM users WHERE id = $1 AND status = 'active'", [userId]) : null;
      if (!user) return res.redirect(302, '/auth/sign-in?error=google_failed');
      const prior = await auth.currentSession(req);
      if (prior) await db.run('DELETE FROM hub_sessions WHERE id = $1', [prior.sessionId]);
      await auth.startSession(req, res, user, 'mobile google');
      res.redirect(302, '/');
    }));
  }

  return { auth, mount, currentUser, googleEnabled: Boolean(google), googleEntry: (req, next) => (google ? googleEntry(req.headers['user-agent'], next) : null), ownerEmails: owners, createMobileCode, redeemMobileCode, safeNext };
}

module.exports = { createBkesariId, verifyIdToken, createJwks, googleConfig, ownerEmails, safeNext, appSchemes, googleEntry, GOOGLE_JWKS, GOOGLE_TOKEN };
