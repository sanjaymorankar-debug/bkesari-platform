'use strict';

const fs = require('fs');
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
 * Both sit behind the hub's own gate for the 'ladwani' project: sign-in,
 * access, and the signed X-Bkesari-Token that LadWani signs the user in with.
 *
 * LadWani's settings carry a LADWANI_ prefix so they cannot collide with the
 * hub's: LADWANI_DATABASE_URL (required for the API) and, optionally,
 * LADWANI_JWT_SECRET. Without the latter, LadWani's session secret is derived
 * from HUB_TOKEN_PRIVATE_KEY, so the hub needs no second secret of its own.
 */

const BASE = '/ladwani';
const PLACEHOLDER = '_';
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
 * LadWani's session secret: LADWANI_JWT_SECRET when set, otherwise derived from
 * the hub's signing key, so it is as stable and as secret as that key.
 */
function sessionSecret(env, keys) {
  if (env.LADWANI_JWT_SECRET) return env.LADWANI_JWT_SECRET;
  const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  return crypto.createHmac('sha256', pem).update('bkesari-hub/ladwani-session/v1').digest('hex');
}

/**
 * Starts LadWani's API in this process and resolves to its Express app.
 * `loadApi` returns LadWani's createApi(); tests pass their own.
 */
async function startApi({ env, keys, loadApi }) {
  // LadWani reads these through its own env() helper (ladwani/apps/api/src/common/env.ts).
  env.LADWANI_JWT_SECRET = sessionSecret(env, keys);
  env.LADWANI_HUB_JWKS = JSON.stringify(keys.jwks);
  const createApi = loadApi();
  const nest = await createApi();
  await nest.init();
  return nest.getHttpAdapter().getInstance();
}

const sendPlain = (res, status, text) => res.status(status).type('text/plain').set('Cache-Control', 'no-store').send(text);

/**
 * Mounts LadWani at /ladwani/ when its static export is present. Returns what
 * it mounted, for the startup log: null when the export is missing (the tab
 * then keeps its "not on this tier yet" page), otherwise { api } where api is
 * a promise of 'ready' or the reason the API is off.
 *
 * Mount BEFORE the hub's body parsers: the API reads the request body itself.
 */
function mount(app, {
  gate,
  keys,
  env = process.env,
  log = console,
  webDir = DEFAULT_WEB_DIR,
  loadApi = () => require(DEFAULT_API_ENTRY).createApi,
} = {}) {
  if (!isFile(path.join(webDir, 'index.html'))) return null;

  let api = null;
  let apiProblem = null;
  const apiReady = env.LADWANI_DATABASE_URL
    ? startApi({ env, keys, loadApi }).then(
      (handler) => { api = handler; return 'ready'; },
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
    // Whatever the browser sent under this name is forged: only the gate may set it.
    delete req.headers['x-bkesari-token'];

    // The build's own JS and CSS carry no one's data, and a page loads dozens
    // of them; asking Neon Auth about each would slow every page for nothing.
    if (req.path.startsWith('/_next/static/')) return serveStatic(req, res);

    gate(req, res, async (err) => {
      if (err) return next(err);
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        await apiReady;
        if (!api) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'LadWani is not available', reason: apiProblem });
        return api(req, res, next);
      }
      return serveStatic(req, res);
    });
  });

  function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendPlain(res, 405, 'Method not allowed');
    const file = resolveStatic(webDir, req.path);
    if (!file) {
      const notFound = path.join(webDir, '404.html');
      return isFile(notFound) ? res.status(404).sendFile(notFound) : sendPlain(res, 404, 'Not found');
    }
    const immutable = req.path.startsWith('/_next/static/');
    res.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'private, no-cache');
    return res.sendFile(file);
  }

  return { api: apiReady };
}

module.exports = { BASE, PLACEHOLDER, resolveStatic, sessionSecret, mount };
