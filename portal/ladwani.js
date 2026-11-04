'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * LadWani at /ladwani/, served by this process: no website, no Node.js process
 * and no proxy of its own, which a Hostinger Business plan has no room for.
 *
 *   - The web app is a static export (ladwani/apps/web/out, built with
 *     NEXT_OUTPUT=export and BASE_PATH=/ladwani by `npm run build:hostinger`).
 *     Every page is a client component, so the files are served as they are.
 *     Each [param] page exists once, built for the placeholder "_"; any id is
 *     answered with that page, which reads the real id from the address bar.
 *   - The API is LadWani's NestJS app (ladwani/apps/api), initialised here
 *     without listen() and mounted at /ladwani/api/v1.
 *
 * LadWani signs its own people in (its users table, in its own database; its
 * session cookie lw_sid on Path=/ladwani). The hub puts no gate in front of it
 * and forwards nothing about who anyone is: since 3 Nov 2026 there is no
 * shared bkesari ID. The one thing the hub tells LadWani is the visitor's
 * address as the hub saw it (VISITOR_HEADER, trust-proxy aware), so LadWani's
 * rate limits count per visitor rather than per proxy.
 *
 * LadWani's settings carry a LADWANI_ prefix so they cannot collide with the
 * hub's: LADWANI_DATABASE_URL (required for the API) and LADWANI_JWT_SECRET.
 * Without the latter a secret is derived from HUB_AUTH_SECRET (or the older
 * HUB_TOKEN_PRIVATE_KEY), so a tier needs no extra setting; set it to keep
 * LadWani's sessions independent of the hub's key material.
 */

const BASE = '/ladwani';
// Names the visitor to LadWani's rate limits (its VisitorThrottlerGuard): the
// client address as the hub saw it, so each visitor gets their own budget
// whatever proxies stand in front.
const VISITOR_HEADER = 'x-bkesari-visitor';
const PLACEHOLDER = '_';
// Worker threads for Prisma's query engine (a tokio runtime, which reads
// TOKIO_WORKER_THREADS). Left alone it starts one per CPU the server shows, and
// a shared host shows all of its cores. Hostinger counts every thread against
// the account's process limit, so an uncapped engine starved Education's PHP
// workers on 2026-10-26. LadWani's traffic needs no more than this.
const ENGINE_THREADS = 2;
const ROOT = path.join(__dirname, '..', 'ladwani');
const DEFAULT_WEB_DIR = path.join(ROOT, 'apps', 'web', 'out');
const DEFAULT_API_ENTRY = path.join(ROOT, 'apps', 'api', 'dist', 'main.js');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/**
 * The file in `webDir` that answers `urlPath` (relative to /ladwani), or null.
 *
 * Walks the path one segment at a time; a segment with no folder of its own
 * falls back to the "_" folder at that level, which is how /family/7/fees/
 * finds family/_/fees/index.html. A folder answers with its index.html. Any
 * segment that is empty after decoding, "." or "..", or carries a slash or a
 * NUL, is refused rather than interpreted.
 */
function resolveStatic(webDir, urlPath) {
  let segments;
  try {
    segments = String(urlPath || '/').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  let at = webDir;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '.' || seg === '..' || /[\\/\0]/.test(seg)) return null;
    const last = i === segments.length - 1;
    const own = path.join(at, seg);
    if (isDir(own) || (last && isFile(own))) { at = own; continue; }
    const shell = path.join(at, PLACEHOLDER);
    // Only a segment that names a folder is an id; "app.js" under a [param]
    // folder is a missing file, not a page for the id "app.js".
    if (isDir(shell) && !(last && path.extname(seg))) { at = shell; continue; }
    return null;
  }
  if (isDir(at)) at = path.join(at, 'index.html');
  return isFile(at) ? at : null;
}

/**
 * LadWani's session secret: LADWANI_JWT_SECRET when set, otherwise derived
 * from the hub's secret, otherwise made at start-up (sessions then end on a
 * restart; fine for one local process, never for a tier).
 */
function sessionSecret(env, log = console) {
  if (env.LADWANI_JWT_SECRET) return env.LADWANI_JWT_SECRET;
  const base = env.HUB_AUTH_SECRET || env.HUB_TOKEN_PRIVATE_KEY;
  if (base) return crypto.createHmac('sha256', base).update('bkesari-hub/ladwani-session/v2').digest('hex');
  log.warn('LADWANI_JWT_SECRET is not set: LadWani sessions will not survive a restart.');
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Starts LadWani's API in this process and resolves to its Express app.
 * `loadApi` returns LadWani's createApi(); tests pass their own.
 */
async function startApi({ env, loadApi, log }) {
  // LadWani reads these through its own env() helper (ladwani/apps/api/src/common/env.ts).
  env.LADWANI_JWT_SECRET = sessionSecret(env, log);
  env.LADWANI_VISITOR_HEADER = VISITOR_HEADER;
  if (!env.LADWANI_COOKIE_PATH) env.LADWANI_COOKIE_PATH = BASE;
  // Read by the engine when it starts, so set before LadWani loads it; a value
  // set on the site wins. The engine aborts the whole process (the hub with it)
  // on anything but a whole number above 0, so such a value stops only the API.
  if (!env.TOKIO_WORKER_THREADS) env.TOKIO_WORKER_THREADS = String(ENGINE_THREADS);
  else if (!/^[1-9][0-9]*$/.test(env.TOKIO_WORKER_THREADS)) {
    throw new Error(`TOKIO_WORKER_THREADS must be a whole number above 0 or unset, not ${JSON.stringify(env.TOKIO_WORKER_THREADS)}`);
  }
  const createApi = loadApi();
  const nest = await createApi();
  await nest.init();
  return nest.getHttpAdapter().getInstance();
}

/** What the startup log says once the API is up: the engine's threads against the CPUs the server shows. */
function readyState(env) {
  return `ready (database engine: ${env.TOKIO_WORKER_THREADS} worker threads; the server shows ${os.availableParallelism()} CPUs)`;
}

const sendPlain = (res, status, text) => res.status(status).type('text/plain').set('Cache-Control', 'no-store').send(text);

/**
 * Mounts LadWani at /ladwani/ when its static export is present. Returns what
 * it mounted, for the startup log: null when the export is missing (the tab
 * then keeps its "not on this tier yet" page), otherwise { api } where api is
 * a promise of 'ready (…)' (readyState) or the reason the API is off.
 *
 * Mount BEFORE the hub's body parsers: the API reads the request body itself.
 */
function mount(app, {
  env = process.env,
  log = console,
  webDir = DEFAULT_WEB_DIR,
  loadApi = () => require(DEFAULT_API_ENTRY).createApi,
} = {}) {
  if (!isFile(path.join(webDir, 'index.html'))) return null;

  let api = null;
  let apiProblem = null;
  const apiReady = env.LADWANI_DATABASE_URL
    ? startApi({ env, loadApi, log }).then(
      (handler) => { api = handler; return readyState(env); },
      (err) => { apiProblem = `LadWani's API did not start: ${err.message}`; log.error(apiProblem); return apiProblem; },
    )
    : Promise.resolve((apiProblem = 'LADWANI_DATABASE_URL is not set'));

  // /ladwani -> /ladwani/: the export is built with trailing slashes. Checked
  // on the exact path, since Express's routing would also match /ladwani/.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path !== BASE) return next();
    return res.redirect(301, `${BASE}/${req.url.slice(BASE.length)}`);
  });

  app.use(BASE, (req, res, next) => {
    // Whatever the browser sent under these names is forged: only the hub may
    // set the visitor header, and the old hub token is never honoured again.
    delete req.headers['x-bkesari-token'];
    delete req.headers[VISITOR_HEADER];

    if (req.path === '/api' || req.path.startsWith('/api/')) {
      return apiReady.then(() => {
        if (!api) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'LadWani is not available', reason: apiProblem });
        req.headers[VISITOR_HEADER] = `ip:${req.ip}`;
        return api(req, res, next);
      }, next);
    }
    return serveStatic(req, res);
  });

  function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendPlain(res, 405, 'Method not allowed');
    const file = resolveStatic(webDir, req.path);
    if (!file) {
      // The app's own 404 page, except for a missing build asset.
      const notFound = path.join(webDir, '404.html');
      return !req.path.startsWith('/_next/') && isFile(notFound) ? res.status(404).sendFile(notFound) : sendPlain(res, 404, 'Not found');
    }
    const immutable = req.path.startsWith('/_next/static/');
    res.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'private, no-cache');
    return res.sendFile(file);
  }

  return { api: apiReady };
}

module.exports = { BASE, PLACEHOLDER, VISITOR_HEADER, ENGINE_THREADS, resolveStatic, sessionSecret, mount };
