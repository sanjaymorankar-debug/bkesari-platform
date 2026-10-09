/**
 * The /auth pages and JSON endpoints.
 *
 *   /auth/login, /signup, /verify, /forgot, /reset, /logout, /privacy
 *   /auth/account, /step-up, /subscribe/<feature>
 *   /auth/google/start, /google/callback
 *   /auth/admin/...                    admin.js
 *   /auth/oauth/..., /.well-known/...  oidc.js
 *   /auth/api/me, /api/menu            for the browser
 *   /auth/api/introspect               for bkesari projects (client credentials)
 */
const express = require('express');
const rbac = require('./rbac');
const passwords = require('./passwords');
const { toIdentity } = require('./identity');
const { tabsFor, accountFor } = require('./menu-tabs');
const { normalizeEmail } = require('./util');

function safeReturn(value, fallback = '/') {
  const s = String(value || '');
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || /[\r\n\t\0]/.test(s) || s.length > 2000) return fallback;
  if (/^\/auth\/(logout|login|signup)/.test(s)) return fallback;
  return s;
}

function createRoutes(ctx) {
  const { config, service, csrf, limiter, views, cookies, resolve, oidc, admin, google, audit } = ctx;
  const router = express.Router();
  const { AuthError } = service;

  router.use(async (req, res, next) => {
    try {
      req.bkAuth = await resolve(req);
      res.set('Cache-Control', 'no-store');
      res.set('X-Frame-Options', 'DENY');
      res.set('Referrer-Policy', 'same-origin');
      next();
    } catch (err) { next(err); }
  });

  function page(req, res, built, status = 200) {
    res.status(status).set('Content-Security-Policy', views.CSP).type('html')
      .send(views.layout({ ...built, req, resolved: req.bkAuth, env: config.tier }));
  }

  function limited(res, retryAfter) {
    res.set('Retry-After', String(retryAfter));
    return res.status(429);
  }

  /** Ends any current session in this browser and starts a new one. */
  async function finishLogin(req, res, user, { mfa, method, returnTo }) {
    if (req.bkAuth) await service.revokeSession(req.bkAuth.session.id, { req });
    const { token } = await service.createSession(user, { mfa, req, method });
    cookies.setSession(res, token);
    res.redirect(303, safeReturn(returnTo));
  }

  /* ------------------------------------------------------------ login */

  router.get('/', (req, res) => res.redirect(302, req.bkAuth ? '/auth/account' : '/auth/login'));

  router.get('/login', (req, res) => {
    const returnTo = safeReturn(req.query.return_to, '');
    if (req.bkAuth && returnTo) return res.redirect(302, returnTo);
    page(req, res, views.pages.login({ csrf: csrf.token(req, res), returnTo, google: Boolean(config.google), info: req.query.info }));
  });

  router.post('/login', csrf.check, async (req, res, next) => {
    const { email, password, return_to: rt } = req.body || {};
    const returnTo = safeReturn(rt, '');
    const show = (error, status) => page(req, res, views.pages.login({ csrf: csrf.token(req, res), returnTo, error, email, google: Boolean(config.google) }), status);
    const byIp = limiter.hit(`login:ip:${req.ip}`, 30, 10 * 60_000);
    const byEmail = limiter.hit(`login:email:${normalizeEmail(email)}`, 10, 10 * 60_000);
    if (!byIp.ok || !byEmail.ok) {
      limited(res, Math.max(byIp.retryAfter, byEmail.retryAfter));
      return show('Too many attempts. Wait a few minutes and try again.', 429);
    }
    try {
      const result = await service.passwordLogin({ email, password, req });
      if (result.mfa) return page(req, res, views.pages.mfa({ csrf: csrf.token(req, res), returnTo, pending: result.mfa }));
      await finishLogin(req, res, result.user, { mfa: false, method: 'password', returnTo });
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === 'unverified') await service.resendVerification(email);
        return show(err.message, err.status);
      }
      next(err);
    }
  });

  router.post('/login/mfa', csrf.check, async (req, res, next) => {
    const { pending, code, return_to: rt } = req.body || {};
    const returnTo = safeReturn(rt, '');
    if (!limiter.hit(`mfa:ip:${req.ip}`, 20, 10 * 60_000).ok) {
      limited(res, 600);
      return page(req, res, views.pages.mfa({ csrf: csrf.token(req, res), returnTo, pending, error: 'Too many attempts. Wait and try again.' }), 429);
    }
    try {
      const { user } = await service.completeMfaLogin({ pending, code, req });
      await finishLogin(req, res, user, { mfa: true, method: 'password+totp', returnTo });
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === 'mfa_expired') return page(req, res, views.pages.login({ csrf: csrf.token(req, res), returnTo, error: err.message, google: Boolean(config.google) }), 401);
        return page(req, res, views.pages.mfa({ csrf: csrf.token(req, res), returnTo, pending, error: err.message }), err.status);
      }
      next(err);
    }
  });

  /* ------------------------------------------------------------ sign up */

  router.get('/signup', (req, res) => {
    page(req, res, views.pages.signup({ csrf: csrf.token(req, res), returnTo: safeReturn(req.query.return_to, ''), google: Boolean(config.google), minLength: passwords.MIN_LENGTH }));
  });

  router.post('/signup', csrf.check, async (req, res, next) => {
    const b = req.body || {};
    const returnTo = safeReturn(b.return_to, '');
    const show = (error, status) => page(req, res, views.pages.signup({ csrf: csrf.token(req, res), returnTo, error, values: b, google: Boolean(config.google), minLength: passwords.MIN_LENGTH }), status);
    const byIp = limiter.hit(`signup:ip:${req.ip}`, 10, 60 * 60_000);
    if (!byIp.ok) { limited(res, byIp.retryAfter); return show('Too many sign-ups from here. Try again later.', 429); }
    try {
      await service.signup({ email: b.email, name: b.name, password: b.password, consent: b.consent === '1' || b.consent === 'on', req });
      page(req, res, views.pages.checkEmail({ email: normalizeEmail(b.email) }));
    } catch (err) {
      if (err instanceof AuthError) return show(err.message, 400);
      next(err);
    }
  });

  router.get('/verify', async (req, res, next) => {
    try {
      const user = await service.verifyEmail(String(req.query.token || ''), { req });
      if (!user) return page(req, res, views.pages.message({ title: 'Link not valid', text: 'That link has expired or was already used. Sign in and we will send a new one.', kind: 'error', link: { href: '/auth/login', label: 'Sign in' } }), 400);
      page(req, res, views.pages.message({ title: 'Email confirmed', text: 'Your email address is confirmed. You can sign in now.', kind: 'ok', link: { href: '/auth/login', label: 'Sign in' } }));
    } catch (err) { next(err); }
  });

  /* ------------------------------------------------------------ password reset */

  router.get('/forgot', (req, res) => page(req, res, views.pages.forgot({ csrf: csrf.token(req, res) })));

  router.post('/forgot', csrf.check, async (req, res, next) => {
    const email = normalizeEmail((req.body || {}).email);
    const byIp = limiter.hit(`forgot:ip:${req.ip}`, 10, 60 * 60_000);
    const byEmail = limiter.hit(`forgot:email:${email}`, 3, 60 * 60_000);
    try {
      // Same answer either way; only the mail differs.
      if (byIp.ok && byEmail.ok) await service.requestPasswordReset(email, { req });
      page(req, res, views.pages.forgot({ csrf: csrf.token(req, res), sent: true }));
    } catch (err) { next(err); }
  });

  router.get('/reset', (req, res) => {
    page(req, res, views.pages.reset({ csrf: csrf.token(req, res), token: String(req.query.token || ''), minLength: passwords.MIN_LENGTH }));
  });

  router.post('/reset', csrf.check, async (req, res, next) => {
    const { token, password } = req.body || {};
    try {
      const { userId, endedSessions } = await service.resetPassword({ token, password, req });
      for (const sid of endedSessions) oidc.notifyLogout({ sid, userId });
      cookies.clearSession(res);
      page(req, res, views.pages.message({ title: 'Password changed', text: 'Your password is changed and every browser has been signed out.', kind: 'ok', link: { href: '/auth/login', label: 'Sign in' } }));
    } catch (err) {
      if (err instanceof AuthError) return page(req, res, views.pages.reset({ csrf: csrf.token(req, res), token, error: err.message, minLength: passwords.MIN_LENGTH }), 400);
      next(err);
    }
  });

  /* ------------------------------------------------------------ logout */

  router.get('/logout', (req, res) => {
    const token = csrf.token(req, res);
    page(req, res, {
      title: 'Sign out',
      body: `<h1>Sign out</h1><div class="card"><p>Sign out of bkesari.com and agtci.com in this browser?</p>
<form method="post" action="/auth/logout"><input type="hidden" name="_csrf" value="${token}"><button type="submit">Sign out</button></form></div>`,
    });
  });

  router.post('/logout', csrf.check, async (req, res, next) => {
    try {
      const r = req.bkAuth;
      if (r) {
        await service.revokeSession(r.session.id, { req });
        oidc.notifyLogout({ sid: r.session.id, userId: r.user.id });
      }
      cookies.clearSession(res);
      res.redirect(303, safeReturn((req.body || {}).return_to, '/'));
    } catch (err) { next(err); }
  });

  /* ------------------------------------------------------------ account */

  function requireLogin(req, res, next) {
    if (req.bkAuth) return next();
    if (req.method !== 'GET') return res.status(401).type('text').send('Sign in first.');
    res.redirect(302, `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`);
  }

  async function accountPage(req, res, extra = {}, status = 200) {
    const sessions = await service.activeSessions(req.bkAuth.user.id);
    const user = await service.findUserById(req.bkAuth.user.id);
    page(req, res, views.pages.account({ csrf: csrf.token(req, res), resolved: { ...req.bkAuth, user }, sessions, info: req.query.info, error: req.query.error, ...extra }), status);
  }

  router.get('/account', requireLogin, async (req, res, next) => {
    try { await accountPage(req, res); } catch (err) { next(err); }
  });

  router.post('/account/mfa/begin', requireLogin, csrf.check, async (req, res, next) => {
    try {
      const enrolment = await service.beginTotpEnrollment(req.bkAuth.user);
      await accountPage(req, res, { enrolment });
    } catch (err) {
      if (err instanceof AuthError) return accountPage(req, res, { error: err.message }, err.status);
      next(err);
    }
  });

  router.post('/account/mfa/confirm', requireLogin, csrf.check, async (req, res, next) => {
    try {
      await service.confirmTotpEnrollment(req.bkAuth.user, (req.body || {}).code, { req });
      await service.markSessionMfa(req.bkAuth.session.id);
      res.redirect(303, '/auth/account?info=' + encodeURIComponent('Two-step sign-in is on.'));
    } catch (err) {
      if (err instanceof AuthError) return res.redirect(303, '/auth/account?error=' + encodeURIComponent(err.message) + '#mfa');
      next(err);
    }
  });

  router.get('/step-up', requireLogin, async (req, res, next) => {
    try {
      const returnTo = safeReturn(req.query.return_to, '/auth/account');
      if (req.bkAuth.mfa) return res.redirect(302, returnTo);
      const user = await service.findUserById(req.bkAuth.user.id);
      page(req, res, views.pages.stepUp({ csrf: csrf.token(req, res), returnTo, enrolled: Boolean(user.totp_enabled_at) }));
    } catch (err) { next(err); }
  });

  router.post('/step-up', requireLogin, csrf.check, async (req, res, next) => {
    const returnTo = safeReturn((req.body || {}).return_to, '/auth/account');
    if (!limiter.hit(`mfa:ip:${req.ip}`, 20, 10 * 60_000).ok) {
      limited(res, 600);
      return page(req, res, views.pages.stepUp({ csrf: csrf.token(req, res), returnTo, enrolled: true, error: 'Too many attempts. Wait and try again.' }), 429);
    }
    try {
      await service.stepUp(req.bkAuth, (req.body || {}).code, { req });
      res.redirect(303, returnTo);
    } catch (err) {
      if (err instanceof AuthError) return page(req, res, views.pages.stepUp({ csrf: csrf.token(req, res), returnTo, enrolled: true, error: err.message }), err.status);
      next(err);
    }
  });

  /* ------------------------------------------------------------ subscriptions */

  function featureParam(req) {
    const code = String(req.params.feature || '').toUpperCase();
    return rbac.FEATURE_CODES.includes(code) ? rbac.featureByCode(code) : null;
  }

  async function renderSubscribe(req, res, feature, resolved, status = 403, info = null) {
    const sub = resolved ? await service.getSubscription(resolved.user.id, feature.code) : null;
    res.status(status).set('Content-Security-Policy', views.CSP).set('Cache-Control', 'private, no-store').type('html')
      .send(views.layout({
        ...views.pages.subscribe({ csrf: csrf.token(req, res), feature, resolved, status: sub ? rbac.effectiveStatus(sub) : null, info }),
        req, resolved, env: config.tier,
      }));
  }

  router.get('/subscribe/:feature', async (req, res, next) => {
    try {
      const feature = featureParam(req);
      if (!feature) return next(); // ends in the hub's ordinary 404, for 'atip' too
      const r = req.bkAuth;
      if (r && r.evaluation.features.includes(feature.code) && feature.tab) return res.redirect(302, feature.tab);
      await renderSubscribe(req, res, feature, r, 200, req.query.info);
    } catch (err) { next(err); }
  });

  router.post('/subscribe/:feature', requireLogin, csrf.check, async (req, res, next) => {
    try {
      const feature = featureParam(req);
      if (!feature) return next();
      await service.requestAccess({ user: req.bkAuth.user, feature: feature.code, note: (req.body || {}).note, req });
      res.redirect(303, `/auth/subscribe/${feature.code.toLowerCase()}?info=${encodeURIComponent('Request sent.')}`);
    } catch (err) { next(err); }
  });

  /* ------------------------------------------------------------ privacy */

  router.get('/privacy', (req, res) => page(req, res, views.pages.privacy({ version: config.privacyVersion })));

  /* ------------------------------------------------------------ Google */

  router.post('/google/start', csrf.check, (req, res, next) => {
    if (!config.google) return next();
    const b = req.body || {};
    res.redirect(303, google.start(res, { returnTo: safeReturn(b.return_to, ''), consent: b.consent === '1' || b.consent === 'on' }));
  });

  router.get('/google/callback', async (req, res, next) => {
    if (!config.google) return next();
    try {
      const { claims, returnTo, consent } = await google.callback(req, res);
      const result = await service.googleLogin({ ...claims, consent, req });
      if (result.mfa) return page(req, res, views.pages.mfa({ csrf: csrf.token(req, res), returnTo, pending: result.mfa }));
      await finishLogin(req, res, result.user, { mfa: false, method: 'google', returnTo });
    } catch (err) {
      const text = err instanceof AuthError || err instanceof Error ? err.message : 'Google sign-in failed.';
      page(req, res, views.pages.login({ csrf: csrf.token(req, res), returnTo: '', error: text, google: true }), 400);
    }
  });

  /* ------------------------------------------------------------ JSON */

  router.get('/api/me', (req, res) => {
    if (!req.bkAuth) return res.status(401).json({ active: false });
    res.json(toIdentity(req.bkAuth));
  });

  router.get('/api/menu', (req, res) => {
    res.set('Cache-Control', 'private, no-store').set('Vary', 'Cookie');
    res.json({ tabs: tabsFor(req.bkAuth), account: accountFor(req.bkAuth) });
  });

  /**
   * For bkesari projects: "who is behind this cookie, and what may they do?"
   * Client credentials of kind `internal` only. Body: { "token": "<cookie value>" }.
   */
  router.post('/api/introspect', express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      const client = await ctx.clients.authenticate(req, { kind: 'internal' });
      if (!client) return res.status(401).set('WWW-Authenticate', 'Basic realm="bkesari"').json({ error: 'invalid_client' });
      if (!limiter.hit(`introspect:${client.client_id}`, 3000, 60_000).ok) return res.status(429).json({ error: 'slow_down' });
      const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
      const resolved = token ? await service.resolveToken(token, { touch: true }) : null;
      res.set('Cache-Control', 'no-store').json(toIdentity(resolved));
    } catch (err) { next(err); }
  });

  router.use(oidc.router);
  router.use('/admin', express.urlencoded({ extended: false, limit: '50kb' }), admin);

  router.use((err, req, res, next) => {
    ctx.log.error(err);
    if (res.headersSent) return next(err);
    page(req, res, views.pages.message({ title: 'Something went wrong', text: 'Please try again in a moment.', kind: 'error' }), 500);
  });

  return { router, renderSubscribe, safeReturn, audit };
}

module.exports = { createRoutes, safeReturn };
