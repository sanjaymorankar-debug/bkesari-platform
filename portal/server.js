const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const createDb = require('./db');
// The Kesari app shell (header + footer), shared with every browser page.
const menu = require('./public/shared/menu.js');
// Serves the projects that live in their own apps under their own tab paths.
const proxy = require('./proxy');
const ladwani = require('./ladwani');
// Neon services, each on only when `neon deploy` has supplied its variables.
const storage = require('./storage');
const realtime = require('./realtime');
// The hub's own pages and its admin; TaskList with its own accounts.
const { createHub } = require('./hub');
const { createTaskList } = require('./tasklist');
const { createNotifier } = require('./notify');
const pages = require('./hub-pages');

/* ============================================================
   bkesari.com
     /                 home: the project tiles (portal/hub.js)
     /about /contact /privacy /terms /auth/sign-in   hub pages
     /admin            the hub's own admin login and editor
     /tasklist/        TaskList, with its OWN accounts (portal/tasklist.js);
                       /tasks/ redirects there
     /ladwani/         LadWani, in this process, with its OWN accounts
     /edu/             Education, proxied, with its OWN accounts;
                       /education/ redirects there
     /ATIP/            read-only ATIP snapshot, the owner's only
     /environment/ /driving-simulator/   static pages
     /styleguide/      the Kesari style guide, dev and test only

   Since 3 Nov 2026 there is no shared sign-in: each project signs its own
   people in, in its own database, with its own cookie (tl_sid on /tasklist,
   lw_sid on /ladwani, edu_sid on /edu). The hub forwards nothing about who
   anyone is to any project.
   ============================================================ */

// UTC "YYYY-MM-DD HH:MM:SS", stored in PostgreSQL TIMESTAMP columns and read back as
// the same text (see the type parsers in db.js).
function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function same(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// HTTP Basic auth from two env vars. When they are unset, `failClosed`
// decides between letting everyone in (local use) and refusing everyone.
function basicAuth(userVar, passVar, realm, failClosed) {
  return (req, res, next) => {
    const user = process.env[userVar];
    const pass = process.env[passVar];
    if (!user || !pass) {
      if (!failClosed) return next();
      return res.status(503).send(`${realm} is not configured: set ${userVar} and ${passVar} on the server.`);
    }
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const i = decoded.indexOf(':');
      if (i >= 0 && same(decoded.slice(0, i), user) & same(decoded.slice(i + 1), pass)) return next();
    }
    res.set('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    res.status(401).send('Login required');
  };
}

/* ---------- ATIP read-only viewer ----------
   Served at both /atip/ (the path the menu links) and /ATIP/; every route below
   names both spellings.

   The ATIP machine pushes its rendered dashboard page here (see ATIP-DEV's
   publish_snapshot.py). This server never talks back to it. The page is served
   with a CSP that forbids network calls, and the order controls are hidden, so
   the hosted copy is view-only.

   If ATIP is instead hosted as the full interactive app, /ATIP/ is proxied to
   that server and this viewer is bypassed -- see ATIP-DEV/docs/HOSTED_DEPLOYMENT.md,
   which also lists the controls that exposure requires. */
const ATIP_READONLY_CSS = `<style id="bk-readonly">
  .acts,#pendBox,#modalBg,#brokerBanner,#brokerBanner2,button[onclick^="deleteRule"]{display:none!important}
  /* The shared menu takes the sticky slot above this, so the banner scrolls. */
  #bk-banner{position:static;z-index:9000;background:#1e293b;color:#e2e8f0;border-bottom:1px solid #334155;
    font:13px system-ui,sans-serif;padding:8px 14px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between}
  #bk-banner a{color:#93c5fd;text-decoration:none}
  #bk-banner b{color:#fbbf24}
</style>`;
const ATIP_CSP = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * Which tier this process is serving, for the menu's badge.
 *
 * APP_ENV wins when set; otherwise it is read from the Host header, so one
 * deployment artifact serves dev, test and production unchanged.
 */
function currentEnv(req) {
  const host = String((req && req.headers && req.headers.host) || '').split(':')[0];
  return menu.resolveEnv(host, process.env.APP_ENV);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

/**
 * Express's `trust proxy`, from TRUST_PROXY. Default "loopback": Hostinger's
 * front end reaches the app over loopback and appends the visitor's address
 * to X-Forwarded-For, which is what the rate limits must count. A direct
 * caller is not loopback, so it cannot forge the header.
 */
function trustProxySetting(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'loopback';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * Security headers. The hub's own pages and TaskList get a strict CSP (no
 * inline scripts, nothing from other origins). LadWani's static export and
 * Education carry inline scripts of their own, and the ATIP viewer sets its own
 * policy, so those get the rest of the set but not this CSP.
 */
function securityHeaders() {
  const realtimeOrigin = (() => { try { return new URL(process.env.NEON_REALTIME_URL).origin.replace(/^http/, 'ws'); } catch { return ''; } })();
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self'", `connect-src 'self'${realtimeOrigin ? ` ${realtimeOrigin}` : ''}`, "manifest-src 'self'", "worker-src 'self'",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join('; ');
  return (req, res, next) => {
    const https = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    });
    // No includeSubDomains: dev.bkesari.com has no working certificate yet.
    if (https) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (/^\/(ladwani|edu|atip)(\/|$)/i.test(req.path)) res.set('X-Frame-Options', 'SAMEORIGIN');
    else res.set({ 'Content-Security-Policy': csp, 'X-Frame-Options': 'DENY' });
    next();
  };
}

/**
 * The Neon Function `report`, as a call the server makes: null when it is not
 * configured. Unreachable, too slow or failing is a 502 with a plain message.
 */
function reportFunction(env) {
  if (!env.NEON_FUNCTION_REPORT_BASE_URL || !env.ORIGIN_SECRET) return null;
  return async () => {
    const r = await fetch(env.NEON_FUNCTION_REPORT_BASE_URL, { headers: { 'x-secret': env.ORIGIN_SECRET }, redirect: 'manual', signal: AbortSignal.timeout(15000) })
      .catch((err) => { console.error('report function did not answer:', err.message); throw Object.assign(new Error('The report function did not answer'), { status: 502 }); });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body) throw Object.assign(new Error((body && body.error) || `The report function answered ${r.status}`), { status: 502 });
    return body;
  };
}

/** A per-project secret: <PREFIX>_AUTH_SECRET, else derived from the hub's key material, else random. */
function projectSecret(prefix) {
  const own = process.env[`${prefix}_AUTH_SECRET`];
  if (own && own.length >= 32) return own;
  const base = process.env.HUB_AUTH_SECRET || process.env.HUB_TOKEN_PRIVATE_KEY;
  return base ? crypto.createHash('sha256').update(`${prefix.toLowerCase()}|${base}`).digest('hex') : undefined;
}

// The whole site as an Express app, given an open database (db.js). Split
// from main() so tests can drive it against a database of their own.
//
// `extra.hubDb` holds the hub's own tables and `extra.atipDb` the ATIP
// snapshots; each defaults to `db` (TaskList's), so one database still runs the
// whole site (tests, local).
function createApp(db, extra = {}) {
  const hubDb = extra.hubDb || db;
  const atipDb = extra.atipDb || db;
  const env = extra.env || process.env;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting(env.TRUST_PROXY));

  // Keep every tier but production out of search indexes. dev.bkesari.com and
  // test.bkesari.com carry the same real-looking content as production, so
  // without this they compete with it in search results and expose work in
  // progress. Driven by the tier rather than hard-coded, so one build still
  // serves all three and production is left untouched.
  //
  // First, so it also covers the proxied projects below. The tier is also
  // stated outright in a header (`curl -I https://dev.bkesari.com`), which
  // scripts/smoke-dev.sh checks.
  app.use((req, res, next) => {
    const tier = currentEnv(req);
    res.set('X-Bkesari-Env', tier);
    if (tier !== 'prod') res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use(securityHeaders());

  // LadWani runs in this process (portal/ladwani.js) when its build is here:
  // main() asks for it, tests pass their own options. It signs its own people
  // in; the hub adds nothing. BEFORE THE BODY PARSERS: its API reads the body.
  const ladwaniTab = extra.ladwani ? ladwani.mount(app, { ...extra.ladwani }) : null;

  // The projects that live in their own apps, each under its own tab path.
  // Off until its origin is set, in which case its tab keeps falling through
  // to the "not on this tier yet" page further down.
  //
  // BEFORE THE BODY PARSERS, and that is not a style choice: express.json()
  // consumes the request stream, and the forwarded request still carries the
  // original Content-Length — so the app waits for bytes that never arrive and
  // the visitor hangs until the proxy timeout hands them a 502. Every POST
  // into a proxied project would do it. tests/proxy.test.js shows both
  // orders on a copy; tests/server.test.js fails if this one moves.
  //
  // /education/ is the address people are given; Education itself answers at
  // /edu/ (its APP_URL on Hostinger), so the longer name redirects there.
  app.get(['/education', '/education/*'], (req, res) => {
    res.redirect(301, req.originalUrl.replace(/^\/education/i, '/edu'));
  });
  const proxied = proxy.mount(app, {
    env: ladwaniTab ? { ...env, LADWANI_ORIGIN: '' } : env,
    // The bar for the proxy's own error page. Takes the request so the tier
    // badge comes from the same place every other page gets it.
    renderMenu: (pathname, req) => menu.renderHtml({ pathname, env: currentEnv(req), lang: pages.langOf(req) }),
  });

  const notifyHub = extra.notify ? extra.notify('HUB') : createNotifier('HUB', env);
  const hub = createHub({ db: hubDb, env, envName: currentEnv, notify: notifyHub, log: extra.log || console });

  const tasklist = createTaskList({
    db, tier: currentEnv, log: extra.log || console,
    notify: extra.notify ? extra.notify('TASKLIST') : createNotifier('TASKLIST', env),
    secret: projectSecret('TASKLIST'),
    realtime,
    // Neon Function `report` (functions/report.ts): last-seven-days figures
    // computed next to the database. Server to function only; the browser
    // never sees the function URL or ORIGIN_SECRET.
    report: reportFunction(env),
  });

  // The ATIP snapshot is a full HTML page, so its route gets a larger limit.
  // Both spellings are listed on every ATIP route below: Express's routing is
  // case-insensitive by default, but that is a default someone can flip, and
  // uploaders may be configured with either /atip/api/snapshot or /ATIP/api/snapshot.
  app.use(['/atip/api/snapshot', '/ATIP/api/snapshot'], express.json({ limit: '15mb' }));

  // TaskList and the hub parse their own bodies, route by route.
  tasklist.mount(app);
  hub.mount(app);

  // ATIP belongs to the owner: the hub admin with the owner role. Without a
  // hub admin session, ATIP_USER/ATIP_PASSWORD (HTTP Basic) still opens it
  // when set; otherwise visitors get a plain 404.
  const atipBasic = basicAuth('ATIP_USER', 'ATIP_PASSWORD', 'bkesari ATIP', true);
  const atipOwner = wrap(async (req, res, next) => {
    if (await hub.isOwner(req)) return next();
    if (env.ATIP_USER && env.ATIP_PASSWORD) return atipBasic(req, res, next);
    res.status(404).type('text/plain').send('Not found');
  });

  // The renamed page. 301 so links and bookmarks to /global-warming keep working.
  app.get(['/global-warming', '/global-warming/*'], (req, res) => {
    res.redirect(301, req.path.replace(/^\/global-warming/i, '/environment') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
  });

  // ATIP decides who it is for before anything else, so even the slash
  // redirect gives nothing away: a non-owner gets the same 404 as for /ATIP/.
  app.get(['/atip', '/ATIP'], atipOwner, (req, res, next) => {
    if (req.path.endsWith('/')) return next();
    res.redirect(302, req.path + '/');
  });

  // Upload from the ATIP machine: bearer token, not the viewer login.
  app.post(['/atip/api/snapshot', '/ATIP/api/snapshot'], wrap(async (req, res) => {
    const token = env.ATIP_PUBLISH_TOKEN;
    const [scheme, given] = (req.headers.authorization || '').split(' ');
    if (!token) return res.status(503).json({ error: 'ATIP_PUBLISH_TOKEN is not set on the server' });
    if (scheme !== 'Bearer' || !given || !same(given, token)) return res.status(401).json({ error: 'Invalid token' });
    const { html, trade_date, generated_at } = req.body || {};
    if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) return res.status(400).json({ error: 'html is required' });
    const now = nowUtc();
    // One statement: store the new page and drop every older one.
    await atipDb.run(`WITH latest AS (
        INSERT INTO atip_snapshots (html, trade_date, generated_at, received_at) VALUES ($1,$2,$3,$4) RETURNING id)
      DELETE FROM atip_snapshots WHERE id < (SELECT id FROM latest)`,
      [html, cleanText(trade_date, 20), cleanText(generated_at, 40), now]);
    // Neon Object Storage keeps every snapshot the database just pruned. The
    // upload has already succeeded, so a storage failure is reported, not fatal.
    const result = { ok: true, received_at: now };
    if (storage.enabled()) {
      try {
        result.archived = await storage.archiveSnapshot({ html, tradeDate: cleanText(trade_date, 20), receivedAt: now });
      } catch (err) {
        console.error('ATIP snapshot archive failed:', err.message);
        result.archive_error = 'The snapshot was saved, but archiving it to object storage failed';
      }
    }
    res.json(result);
  }));

  // The archive, newest first, each with a one-hour download link. Same login
  // as the viewer.
  app.get(['/atip/api/archive', '/ATIP/api/archive'], atipOwner, wrap(async (req, res) => {
    if (!storage.enabled()) return res.status(404).json({ error: 'Object storage is not configured' });
    res.set('Cache-Control', 'no-store');
    res.json({ bucket: storage.BUCKET, snapshots: await storage.listSnapshots() });
  }));

  app.get(['/ATIP/', '/atip/'], atipOwner, wrap(async (req, res) => {
    res.set('Content-Security-Policy', ATIP_CSP);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    const snap = await atipDb.get('SELECT html, trade_date, generated_at, received_at FROM atip_snapshots ORDER BY id DESC LIMIT 1');
    if (!snap) {
      return res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATIP</title>
        <body style="font:15px system-ui;background:#0f172a;color:#e2e8f0;min-height:100vh;margin:0">
        ${menu.renderHtml({ pathname: '/ATIP/', env: currentEnv(req), isOwner: true })}
        <div style="display:grid;place-items:center;padding:64px 16px;text-align:center">
        <div><h1 style="margin:0 0 8px">ATIP</h1><p>No dashboard snapshot has been published yet.</p></div></div>`);
    }
    const ageMin = Math.round((Date.now() - Date.parse(snap.received_at.replace(' ', 'T') + 'Z')) / 60000);
    const age = ageMin < 1 ? 'just now' : ageMin < 120 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} h ago`;
    const banner = `<div id="bk-banner"><span><a href="/">← bkesari</a> &nbsp; <b>Read-only view</b> · trade date ${escapeHtml(snap.trade_date)} · built ${escapeHtml((snap.generated_at || '').slice(0, 16))} IST · uploaded ${age}</span><span>Orders can only be placed on the ATIP machine.</span></div>`;
    // Rendered here rather than by the browser script: this page's CSP allows
    // inline scripts but not 'self', so an external <script> would be blocked.
    const top = menu.renderHtml({ pathname: '/ATIP/', env: currentEnv(req), isOwner: true }) + banner;
    // The stylesheet that hides the order controls goes in the head, after the
    // page's own styles. A page may have no </head> at all (it is optional in
    // HTML), and then the controls would show: put it at the top instead.
    const hasHead = /<\/head>/i.test(snap.html);
    let html = hasHead ? snap.html.replace(/<\/head>/i, `${ATIP_READONLY_CSS}</head>`) : snap.html;
    const lead = (hasHead ? '' : ATIP_READONLY_CSS) + top;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, m => m + lead) : lead + html;
    res.type('html').send(html);
  }));

  const notFoundPage = (req, res) => {
    const lang = pages.langOf(req);
    if (/\/api\//.test(req.path) || /\bjson\b/.test(req.headers.accept || '')) return res.status(404).json({ error: 'Not found' });
    return res.status(404).set({ 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-cache' }).type('html').send(pages.layout({
      req, lang, env: currentEnv(req), title: `${pages.t(lang, 'nf.title')} — bkesari`, body: pages.notFound({ lang }),
    }));
  };

  // The style guide is for the people building the projects: dev and test only.
  app.use((req, res, next) => (/^\/styleguide(\/|$)/i.test(req.path) && currentEnv(req) === 'prod' ? notFoundPage(req, res) : next()));

  const PUBLIC = path.join(__dirname, 'public');
  app.use(express.static(PUBLIC, {
    extensions: ['html'],
    index: ['index.html'],
    // The service workers must be re-checked on every visit, or a fix to one
    // could take a day to reach phones that installed the app. The pinned
    // design system never changes under the same version, so it caches for a year.
    setHeaders: (res, file) => {
      if (file.endsWith(`${path.sep}sw.js`)) res.set('Cache-Control', 'no-cache');
      if (file.endsWith('.webmanifest')) res.type('application/manifest+json');
      if (file.includes(`${path.sep}kesari-ui${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  // A tab whose destination is not deployed on this tier yet. Answer with a
  // short page carrying the shell, so navigation continues instead of
  // dead-ending on a bare 404 while the estate is still being assembled.
  //
  // Registered after express.static on purpose: the moment real files exist for
  // a tab — or an app is put behind its path — static or that route wins and
  // this stops firing for it, with nothing to remember to remove.
  app.get(menu.TABS.map((tab) => tab.path), (req, res) => {
    const tab = menu.TABS.find((t) => t.path === req.path) || { name: 'This project' };
    const lang = pages.langOf(req);
    res.status(404).set('X-Robots-Tag', 'noindex').type('html').send(pages.layout({
      req, lang, env: currentEnv(req), title: `${tab.name} — bkesari`,
      body: pages.notOnTier({ lang, name: tab.name, path: req.path }),
    }));
  });

  // Anything else: the branded 404 for people, JSON for programs.
  app.use(notFoundPage);

  // Last: any error nothing above answered. Express's own handler sends the
  // stack trace whenever NODE_ENV is not "production" (locally, in CI, and on
  // any host that does not set it), and a malformed JSON body reached it on
  // every path. Answer with the status and a plain message: JSON for an API
  // or a JSON request, the branded 500 page for a person.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number(err.status || err.statusCode) >= 400 ? Number(err.status || err.statusCode) : 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Server error'
      : err.type === 'entity.parse.failed' ? 'The request body is not valid JSON'
      : err.type === 'entity.too.large' ? 'The request body is too large'
      : 'Bad request';
    const wantsHtml = req.method === 'GET' && !/\/api\//.test(req.path) && /text\/html/.test(req.headers.accept || '');
    if (wantsHtml && status >= 500) {
      const lang = pages.langOf(req);
      return res.status(status).type('html').send(pages.layout({ req, lang, env: currentEnv(req), title: `${pages.t(lang, 'err.title')} — bkesari`, body: pages.serverError({ lang }) }));
    }
    res.status(status).json({ error: message });
  });

  return { app, proxied, ladwaniTab, hub, tasklist };
}

/**
 * One database per project (blueprint A-05). TASKLIST_DATABASE_URL and
 * ATIP_DATABASE_URL name them; DATABASE_URL is the hub's own (tiles, contact
 * messages, hub admins). With neither set, DATABASE_URL carries everything.
 */
async function openDatabases() {
  const split = (prefix, schemaFile) => {
    const url = process.env[`${prefix}_DATABASE_URL`];
    if (!url) return null;
    return createDb({
      schemaFiles: [schemaFile],
      env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: process.env[`${prefix}_DATABASE_URL_UNPOOLED`] || '' },
    });
  };
  const tasklist = await split('TASKLIST', 'tasklist_schema.sql');
  const atip = await split('ATIP', 'atip_schema.sql');
  const hubFiles = ['hub_schema.sql', ...(tasklist ? [] : ['tasklist_schema.sql']), ...(atip ? [] : ['atip_schema.sql'])];
  const hubDb = await createDb({ schemaFiles: hubFiles });
  return { db: tasklist || hubDb, extra: { hubDb, atipDb: atip || hubDb } };
}

// Listens first and connects to the database after. Hostinger's Node.js hosting
// gives an app 3 seconds to call listen(), and a suspended Neon compute can take
// longer than that to answer; until the database is ready every request gets a
// 503 "starting" instead of a refused connection.
async function main() {
  const port = process.env.PORT || 3000;
  let handler = null;
  const server = http.createServer((req, res) => {
    if (handler) return handler(req, res);
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' });
    res.end('Starting, try again in a moment.');
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, resolve));
  console.log(`bkesari portal listening on port ${port}, connecting to the database`);
  const { db, extra } = await openDatabases();
  const { app, proxied, ladwaniTab, hub } = createApp(db, { ...extra, ladwani: {} });
  await hub.bootstrapAdmin().catch((err) => console.error('Hub admin bootstrap failed:', err.message));
  handler = app;
  console.log(`bkesari portal running at http://localhost:${port}`);
  console.log(`TaskList at http://localhost:${port}/tasklist/ (its own accounts, cookie tl_sid)`);
  console.log(`Neon: realtime ${realtime.enabled() ? 'on' : 'off'}, ` +
    `object storage ${storage.enabled() ? 'on' : 'off'}, ` +
    `report function ${process.env.NEON_FUNCTION_REPORT_BASE_URL && process.env.ORIGIN_SECRET ? 'on' : 'off'}`);
  for (const route of proxied) console.log(`${route.path} -> ${route.target}`);
  if (ladwaniTab) {
    console.log(`${ladwani.BASE}/ -> in this process`);
    ladwaniTab.api.then((state) => console.log(`LadWani API: ${state}`));
  }
  if (!proxied.length && !ladwaniTab) {
    console.log('No project origins set (EDU_ORIGIN, LADWANI_ORIGIN);');
    console.log('those tabs will show the "not on this tier yet" page.');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { createApp, main, trustProxySetting, securityHeaders, reportFunction };
