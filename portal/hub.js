'use strict';

/* ============================================================
   The hub: bkesari.com's own pages and its admin.

   Since 3 Nov 2026 the hub signs NO end users in. Each project (LadWani,
   Education, TaskList) owns its accounts in its own database; the hub only
   points people to them. What the hub keeps:

     /                     home: hero, the project tiles, announcement
     /about /privacy /terms   prose pages
     /contact              form -> hub_contact_messages (spam-protected)
     /auth/sign-in         "Choose a project to sign in" (the old shared
                           sign-in's address, kept so links and bookmarks land
                           somewhere useful); /auth/* and the old access pages
                           redirect here
     /admin                the hub's separate admin login (hub_admin_* tables,
                           no sign-up) and the editor for tiles, the
                           announcement and the contact inbox

   The admin's session cookie is hub_admin_sid on Path=/ — the one cookie the
   hub sets for everything under it, because the owner's ATIP viewer (/ATIP/)
   is behind it too. No project reads it. Alongside it goes k_admin=1, a
   readable hint (no secret, grants nothing) that tells the shell's project
   switcher to list ATIP.
   ============================================================ */

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createProjectAuth, normalizeEmail, normalizeMobile } = require('./project-auth');
const pages = require('./hub-pages');
const { escapeHtml } = require('./public/shared/menu.js');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const TILE_STATUSES = ['live', 'beta', 'soon', 'private'];
const ANNOUNCE_KINDS = ['info', 'warning', 'success', 'brand'];
const CONTACT_MIN_SECONDS = 3;
const CONTACT_MAX_AGE_SECONDS = 2 * 60 * 60;
const rowId = (v) => (/^\d{1,15}$/.test(String(v ?? '')) ? Number(v) : 0);

/** The owner's address(es): the first admin is created with the owner role. */
function ownerEmails(env = process.env) {
  return new Set(String(env.HUB_OWNER_EMAILS || 'agtcipl@gmail.com')
    .split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));
}

function hubSecret(env, log) {
  if (env.HUB_AUTH_SECRET && env.HUB_AUTH_SECRET.length >= 32) return env.HUB_AUTH_SECRET;
  if (env.HUB_TOKEN_PRIVATE_KEY) return crypto.createHash('sha256').update(`hub-auth|${env.HUB_TOKEN_PRIVATE_KEY}`).digest('hex');
  log.warn('HUB_AUTH_SECRET is not set: using a secret made at start-up (contact forms and codes do not survive a restart).');
  return crypto.randomBytes(32).toString('hex');
}

/**
 * @param db       the hub database (hub_schema.sql applied)
 * @param envName  (req) => 'dev' | 'test' | 'prod'
 * @param notify   { sms?, mail? } (notify.js) for admin password resets
 */
function createHub({ db, env = process.env, log = console, envName = () => 'prod', notify = {} } = {}) {
  const secret = hubSecret(env, log);
  const admin = createProjectAuth({
    db, key: 'hub-admin', name: 'bkesari hub admin', base: '/admin', cookie: 'hub_admin_sid', cookiePath: '/',
    prefix: 'hub_admin_', allowSignUp: false, methods: ['password'], notify, tier: envName, log,
    secret: crypto.createHash('sha256').update(`admin|${secret}`).digest('hex'),
    accountLinks: [{ label: 'Hub admin', href: '/admin' }],
    hooks: {
      afterSignIn: (req, res, user, { setCookie }) => setCookie(`k_admin=${user.role === 'owner' ? 1 : 0}`, { httpOnly: false, path: '/', maxAge: 30 * 86400 }),
      afterSignOut: (req, res, { setCookie }) => setCookie('k_admin=', { httpOnly: false, path: '/', maxAge: 0 }),
    },
  });

  /** Creates the first admin from HUB_ADMIN_EMAIL + HUB_ADMIN_PASSWORD(_HASH) when there is none. */
  async function bootstrapAdmin() {
    const email = normalizeEmail(env.HUB_ADMIN_EMAIL);
    if (!email) return null;
    const any = await db.get('SELECT id FROM hub_admin_users LIMIT 1');
    if (any) return null;
    let hash = env.HUB_ADMIN_PASSWORD_HASH || null;
    if (!hash && env.HUB_ADMIN_PASSWORD) hash = await bcrypt.hash(env.HUB_ADMIN_PASSWORD, 11);
    if (!hash) { log.warn('HUB_ADMIN_EMAIL is set but neither HUB_ADMIN_PASSWORD_HASH nor HUB_ADMIN_PASSWORD: no admin created.'); return null; }
    const role = ownerEmails(env).has(email) ? 'owner' : 'editor';
    const row = await db.get(`INSERT INTO hub_admin_users (email, name, password_hash, role, email_verified)
      VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT DO NOTHING RETURNING id`, [email, 'Hub admin', hash, role]);
    if (row) log.log(`Hub admin ${email} created (${role}). Remove HUB_ADMIN_PASSWORD from the environment now.`);
    return row;
  }

  /* ---------- tiles and the announcement, cached briefly ---------- */
  let cache = { at: 0, tiles: null, announcement: null };
  async function content() {
    if (cache.tiles && Date.now() - cache.at < 30_000) return cache;
    const tiles = await db.all('SELECT * FROM hub_tiles WHERE visible ORDER BY sort_order, key');
    const announcement = await db.get(`SELECT * FROM hub_announcements WHERE active
      AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) ORDER BY id DESC LIMIT 1`);
    cache = { at: Date.now(), tiles, announcement };
    return cache;
  }
  const invalidate = () => { cache = { at: 0, tiles: null, announcement: null }; };

  /** Is this request the owner's (hub admin with the owner role)? For ATIP. */
  async function isOwner(req) {
    const s = await admin.currentSession(req);
    return Boolean(s && s.user.role === 'owner');
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function send(req, res, { title, description, body, status = 200, isOwner: owner = false, scripts, pathname }) {
    const lang = pages.langOf(req);
    res.status(status).set({ 'Cache-Control': 'no-cache', Vary: 'Cookie, Accept-Language' }).type('html')
      .send(pages.layout({ req, lang, env: envName(req), title, description, body: body(lang), isOwner: owner, scripts, pathname }));
  }

  const page = (titleKey, render, opts = {}) => wrap(async (req, res) => {
    const lang = pages.langOf(req);
    const data = opts.data ? await opts.data(req) : {};
    send(req, res, {
      title: `${pages.t(lang, titleKey)}${titleKey === 'home.title' ? '' : ' — bkesari'}`,
      body: (l) => render({ lang: l, ...data }),
      isOwner: await isOwner(req),
    });
  });

  /* ---------- contact form: CSRF (double submit), honeypot, fill time, rate limit ---------- */
  const sign = (v) => crypto.createHmac('sha256', secret).update(`contact|${v}`).digest('base64url');
  function contactTokens(req, res) {
    let csrf = admin.readCookie(req, 'hub_csrf');
    if (!csrf || !/^[A-Za-z0-9_-]{20,64}$/.test(csrf)) {
      csrf = crypto.randomBytes(24).toString('base64url');
      admin.setCookie(req, res, `hub_csrf=${csrf}`, { path: '/contact', maxAge: CONTACT_MAX_AGE_SECONDS });
    }
    const now = String(Date.now());
    return { csrf, stamp: `${now}.${sign(now)}` };
  }

  function readContact(body) {
    const b = body || {};
    const values = {
      name: String(b.name || '').trim().slice(0, 120),
      email: String(b.email || '').trim().slice(0, 254),
      mobile: String(b.mobile || '').trim().slice(0, 15),
      topic: pages.TOPICS.includes(b.topic) ? b.topic : 'general',
      message: String(b.message || '').trim().slice(0, 4000),
      consent: b.consent === 'yes',
    };
    const errors = {};
    if (!values.name) errors.name = 'contact.err.name';
    if (!values.email && !values.mobile) errors.email = 'contact.err.reach';
    if (values.email && !normalizeEmail(values.email)) errors.email = 'contact.err.email';
    if (values.mobile && !normalizeMobile(values.mobile)) errors.mobile = 'contact.err.mobile';
    if (values.message.length < 10) errors.message = 'contact.err.message';
    if (!values.consent) errors.consent = 'contact.err.consent';
    return { values, errors };
  }

  function mount(app) {
    // Old shared sign-in and access pages: everyone lands on the chooser.
    app.get(['/auth', '/auth/*', '/access/request', '/access', '/access/*'], (req, res, next) => {
      if (req.path === '/auth/sign-in') return next();
      res.redirect(301, '/auth/sign-in');
    });
    app.get(['/admin/access', '/admin/access/*'], (req, res) => res.redirect(301, '/admin'));
    app.all(['/hub/api/me', '/hub/api/access-requests', '/hub/api/admin/*'], (req, res) =>
      res.status(410).json({ error: 'The shared bkesari ID has been retired. Each project now has its own sign-in.', chooser: '/auth/sign-in' }));
    // The old key set: nothing verifies hub tokens any more.
    app.get('/.well-known/jwks.json', (req, res) => res.status(410).json({ keys: [], note: 'retired 3 Nov 2026' }));

    app.get('/', page('home.title', pages.home, { data: () => content() }));
    app.get('/about', page('about.title', pages.about, { data: () => content() }));
    app.get('/privacy', page('privacy.title', pages.privacy));
    app.get('/terms', page('terms.title', pages.terms));
    app.get('/auth/sign-in', page('chooser.title', pages.chooser));

    app.get('/contact', wrap(async (req, res) => {
      const lang = pages.langOf(req);
      const sent = req.query.sent === '1';
      const tokens = contactTokens(req, res);
      send(req, res, { title: `${pages.t(lang, 'contact.title')} — bkesari`, body: (l) => pages.contact({ lang: l, ...tokens, sent }), isOwner: await isOwner(req) });
    }));

    app.post('/contact', express.urlencoded({ extended: false, limit: '20kb' }), wrap(async (req, res) => {
      const lang = pages.langOf(req);
      const b = req.body || {};
      const again = (extra, status = 400) => {
        const tokens = contactTokens(req, res);
        send(req, res, { status, title: `${pages.t(lang, 'contact.title')} — bkesari`, body: (l) => pages.contact({ lang: l, ...tokens, ...extra }) });
      };
      // Cross-site posts and expired or forged forms: show the form again, nothing stored.
      const origin = req.headers.origin;
      let sameOrigin = true;
      if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
      const cookie = admin.readCookie(req, 'hub_csrf');
      const [at, mac] = String(b.stamp || '').split('.');
      const age = (Date.now() - Number(at)) / 1000;
      const stampOk = Boolean(at && mac) && safeEqual(sign(at), mac);
      if (!sameOrigin || !cookie || !safeEqual(cookie, b.csrf) || !stampOk || !(age >= 0 && age <= CONTACT_MAX_AGE_SECONDS)) {
        return again({ formError: 'contact.err.expired', values: readContact(b).values }, 403);
      }
      // A filled hidden field or an inhumanly fast submit: answer as if sent, store nothing.
      if (b.website || age < CONTACT_MIN_SECONDS) return res.redirect(303, '/contact?sent=1');
      const { values, errors } = readContact(b);
      if (Object.keys(errors).length) return again({ values, errors, formError: 'contact.err.form' });
      const ip = String(req.ip || '').slice(0, 45);
      try { await admin.limit(`contact:ip:${ip}`, 5, 60 * 60); } catch (err) {
        if (err.status === 429) return again({ values, formError: 'contact.err.limit' }, 429);
        throw err;
      }
      await db.run(`INSERT INTO hub_contact_messages (name, email, mobile, topic, message, lang, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [values.name, normalizeEmail(values.email), normalizeMobile(values.mobile), values.topic, values.message, lang, ip]);
      res.redirect(303, '/contact?sent=1');
    }));

    /* ---------- admin ---------- */
    admin.mount(app, '/admin/api/auth');
    app.get(['/admin', '/admin/'], wrap(async (req, res) => {
      const s = await admin.currentSession(req);
      const lang = pages.langOf(req);
      res.set('X-Robots-Tag', 'noindex');
      if (!s) {
        return send(req, res, {
          title: `${pages.t(lang, 'admin.title')} — bkesari`, pathname: '/admin', scripts: ['/shared/admin.js'],
          body: (l) => `<div class="k-main--narrow"><h1>${pages.t(l, 'admin.h1')}</h1><p class="k-muted">${pages.t(l, 'admin.signInLead')}</p>
<form class="k-card hub-form" data-admin-signin novalidate>
<div class="k-field"><label class="k-label" for="a-email">${pages.t(l, 'admin.email')}</label><input class="k-input" id="a-email" type="email" autocomplete="username" required aria-describedby="a-err"></div>
<div class="k-field"><label class="k-label" for="a-pass">${pages.t(l, 'admin.password')}</label><input class="k-input" id="a-pass" type="password" autocomplete="current-password" required aria-describedby="a-err"></div>
<p class="k-error" id="a-err" role="alert"></p>
<button class="k-btn k-btn--brand k-btn--block" type="submit">${pages.t(l, 'admin.signIn')}</button></form></div>`,
        });
      }
      send(req, res, {
        title: `${pages.t(lang, 'admin.title')} — bkesari`, pathname: '/admin', isOwner: s.user.role === 'owner', scripts: ['/shared/admin.js'],
        body: () => `<div class="hub-admin" data-admin-app><h1>Hub admin</h1><p class="k-muted">Signed in as ${escapeHtml(s.user.email || '')} (${escapeHtml(s.user.role)}).</p>
<div class="hub-admin-grid" id="admin-root"><div class="k-skel k-skel--card"></div><div class="k-skel k-skel--card"></div></div></div>`,
      });
    }));

    const api = express.Router();
    api.use(express.json({ limit: '100kb' }), (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    api.use(admin.requireUser, admin.csrfGuard);

    api.get('/state', wrap(async (req, res) => {
      const tiles = await db.all('SELECT * FROM hub_tiles ORDER BY sort_order, key');
      const announcement = await db.get('SELECT * FROM hub_announcements ORDER BY id DESC LIMIT 1');
      const messages = await db.all(`SELECT id, name, email, mobile, topic, message, lang, status, created_at
        FROM hub_contact_messages ORDER BY id DESC LIMIT 100`);
      res.json({ user: admin.publicUser(req.user), csrf: req.session.csrf, tiles, announcement, messages, statuses: TILE_STATUSES, kinds: ANNOUNCE_KINDS });
    }));

    api.put('/tiles', wrap(async (req, res) => {
      const list = Array.isArray((req.body || {}).tiles) ? req.body.tiles : null;
      if (!list || list.length > 30) return res.status(400).json({ error: 'Send { tiles: [...] }' });
      const clean = [];
      for (const x of list) {
        const key = String(x.key || '');
        const name = String(x.name || '').trim().slice(0, 80);
        const href = String(x.href || '').trim().slice(0, 200);
        const benefit = String(x.benefit_en || '').trim().slice(0, 200);
        if (!/^[a-z_-]{1,40}$/.test(key) || !name || !benefit) return res.status(400).json({ error: `Tile ${key || '?'}: name and English text are required` });
        if (!/^\/[^/\\]/.test(href) && !/^https:\/\/[^\s"<>]+$/.test(href) && href !== '/') return res.status(400).json({ error: `Tile ${key}: the link must start with / or https://` });
        if (!TILE_STATUSES.includes(x.status)) return res.status(400).json({ error: `Tile ${key}: unknown status` });
        clean.push({ key, name, href, benefit_en: benefit,
          benefit_mr: String(x.benefit_mr || '').trim().slice(0, 200) || null, benefit_hi: String(x.benefit_hi || '').trim().slice(0, 200) || null,
          status: x.status, sort_order: Number.isInteger(Number(x.sort_order)) ? Number(x.sort_order) : 0, visible: x.visible !== false, external: Boolean(x.external) });
      }
      await db.tx(async (q) => {
        for (const x of clean) {
          await q.run(`UPDATE hub_tiles SET name=$2, href=$3, benefit_en=$4, benefit_mr=$5, benefit_hi=$6, status=$7, sort_order=$8, visible=$9, external=$10,
            updated_at=now(), updated_by=$11 WHERE key=$1`,
          [x.key, x.name, x.href, x.benefit_en, x.benefit_mr, x.benefit_hi, x.status, x.sort_order, x.visible, x.external, req.user.email]);
        }
      });
      await admin.audit(req.user.id, req.user.email, 'tiles-saved', clean.map((x) => x.key).join(','), req);
      invalidate();
      res.json({ ok: true });
    }));

    api.put('/announcement', wrap(async (req, res) => {
      const b = req.body || {};
      const message = String(b.message_en || '').trim().slice(0, 300);
      const active = Boolean(b.active) && Boolean(message);
      const kind = ANNOUNCE_KINDS.includes(b.kind) ? b.kind : 'info';
      const link = String(b.link || '').trim();
      if (link && !/^\/[^/\\]/.test(link) && !/^https:\/\/[^\s"<>]+$/.test(link)) return res.status(400).json({ error: 'The link must start with / or https://' });
      const when = (v) => (v ? new Date(v) : null);
      const starts = when(b.starts_at); const ends = when(b.ends_at);
      if ((starts && Number.isNaN(starts.getTime())) || (ends && Number.isNaN(ends.getTime()))) return res.status(400).json({ error: 'Invalid date' });
      await db.tx(async (q) => {
        await q.run('UPDATE hub_announcements SET active = FALSE WHERE active');
        if (message) {
          await q.run(`INSERT INTO hub_announcements (message_en, message_mr, message_hi, kind, link, active, starts_at, ends_at, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [message, String(b.message_mr || '').trim().slice(0, 300) || null, String(b.message_hi || '').trim().slice(0, 300) || null,
            kind, link || null, active, starts, ends, req.user.email]);
        }
      });
      await admin.audit(req.user.id, req.user.email, 'announcement-saved', active ? message.slice(0, 80) : 'off', req);
      invalidate();
      res.json({ ok: true });
    }));

    api.post('/messages/:id', wrap(async (req, res) => {
      const status = ['new', 'read', 'closed'].includes((req.body || {}).status) ? req.body.status : null;
      if (!status) return res.status(400).json({ error: 'status must be new, read or closed' });
      const r = await db.get('UPDATE hub_contact_messages SET status = $1 WHERE id = $2 RETURNING id', [status, rowId(req.params.id)]);
      if (!r) return res.status(404).json({ error: 'No such message' });
      res.json({ ok: true });
    }));

    api.use((req, res) => res.status(404).json({ error: 'Not found' }));
    api.use((err, req, res, next) => {
      if (err instanceof admin.AuthError) return res.status(err.status).json({ error: err.message, code: err.code });
      return next(err);
    });
    app.use('/admin/api', api);
  }

  return { mount, admin, isOwner, bootstrapAdmin, content, invalidate };
}

module.exports = { createHub, ownerEmails, TILE_STATUSES };
