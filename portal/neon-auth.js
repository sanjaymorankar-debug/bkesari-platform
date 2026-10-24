/* ============================================================
   Neon Auth (Managed Better Auth) for the Task Tracker.

   On when NEON_AUTH_BASE_URL is set (`neon deploy` writes it). Otherwise
   /tasks/ keeps its HTTP Basic login (TRACKER_USER / TRACKER_PASSWORD).

   An Express adapter over @neondatabase/auth/server, following that
   package's BUILDING-AN-ADAPTER.md ("Node-style frameworks"):
   - /api/auth/* is proxied to Neon Auth on this origin, so the session
     cookies are first-party; the toolkit does the cookie handling.
   - the body on that route is left raw, because the toolkit forwards it
     verbatim (express.json() must not see it first);
   - several Set-Cookie headers are written as an array, never joined.

   Who gets in. Neon Auth lets anyone create an account, and with email
   verification off (the branch default) an account proves nothing about
   the address it was made with. So a session alone is not enough here:
   the email must be on TRACKER_ALLOWED_EMAILS *and* verified. An unset
   list admits nobody. The sign-in page walks an unverified user through
   the emailed code.

   Email and password only: social sign-in would also need the OAuth
   callback exchange that processAuthMiddleware performs.
   ============================================================ */

const express = require('express');
// @neondatabase/auth/server, bundled by `npm run build:auth`. The package has a
// hard dependency on a React UI kit that would take a production install from
// ~11 MB to ~300 MB, so only the server toolkit ships, as one committed file.
const toolkit = require('./vendor/neon-auth-server.js');

const LOGIN_PATH = '/auth/sign-in';

function config() {
  return {
    baseUrl: process.env.NEON_AUTH_BASE_URL,
    cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET,
  };
}

function enabled() {
  return Boolean(process.env.NEON_AUTH_BASE_URL);
}

/** Lower-cased emails from TRACKER_ALLOWED_EMAILS (comma or whitespace separated). */
function allowedEmails() {
  return new Set(String(process.env.TRACKER_ALLOWED_EMAILS || '')
    .split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/**
 * The decision for one signed-in (or not) user. Pure, so it is tested
 * directly rather than through a live Neon Auth server.
 *   'signin'   no session
 *   'verify'   signed in, email not verified yet
 *   'denied'   verified, but not on TRACKER_ALLOWED_EMAILS
 *   'allow'
 */
function decide(user, allowed) {
  if (!user || !user.email) return 'signin';
  if (!user.emailVerified) return 'verify';
  if (!allowed.has(String(user.email).toLowerCase())) return 'denied';
  return 'allow';
}

/** A Fetch Request from an Express request (adapter guide, gotcha 1). */
function toFetchRequest(req, body) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const url = new URL(req.originalUrl || req.url, `${proto}://${req.headers.host || 'localhost'}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const init = { method: req.method, headers };
  if (body && body.length > 0 && !['GET', 'HEAD'].includes(req.method)) {
    init.body = body;
    init.duplex = 'half'; // undici refuses a body without it
  }
  return new Request(url, init);
}

/** Copy a Fetch Response onto Express, keeping each Set-Cookie separate (gotcha 2). */
async function writeFetchResponse(res, fetchRes) {
  res.status(fetchRes.status);
  for (const [name, value] of fetchRes.headers) {
    const lower = name.toLowerCase();
    // Express sets its own length/encoding for the buffered body below.
    if (lower === 'set-cookie' || lower === 'content-length' || lower === 'content-encoding' || lower === 'transfer-encoding') continue;
    res.setHeader(name, value);
  }
  const cookies = fetchRes.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.send(Buffer.from(await fetchRes.arrayBuffer()));
}

/**
 * The session for this request, plus any refreshed cookies to pass on.
 * `fresh` skips the toolkit's signed session cache (up to 5 minutes old) and
 * asks Neon Auth itself.
 */
async function getSession(req, { fresh = false } = {}) {
  const { handleAuthProxyRequest, NEON_AUTH_SESSION_DATA_COOKIE_NAME } = toolkit;
  const { baseUrl, cookieSecret } = config();
  const original = toFetchRequest(req);
  const headers = new Headers(original.headers);
  headers.delete('content-type');
  headers.delete('content-length');
  if (fresh && headers.has('cookie')) {
    headers.set('cookie', headers.get('cookie').split(/;\s*/)
      .filter((c) => !c.startsWith(`${NEON_AUTH_SESSION_DATA_COOKIE_NAME}=`)).join('; '));
  }
  const response = await handleAuthProxyRequest({
    request: new Request(original.url, { method: 'GET', headers }),
    path: 'get-session',
    baseUrl,
    cookieSecret,
  });
  const data = response.ok ? await response.json().catch(() => null) : null;
  return { user: data && data.user ? data.user : null, cookies: response.headers.getSetCookie() };
}

/**
 * Mounts /api/auth/* and returns the guard for /tasks. Must be called before
 * any body parser is registered on the app.
 */
function mount(app) {
  const { baseUrl, cookieSecret } = config();
  if (!cookieSecret || cookieSecret.length < 32) {
    throw new Error('NEON_AUTH_BASE_URL is set, so NEON_AUTH_COOKIE_SECRET must be too (32+ characters; `openssl rand -base64 32`).');
  }

  app.all('/api/auth/*', express.raw({ type: '*/*', limit: '1mb' }), async (req, res, next) => {
    try {
      const { handleAuthProxyRequest } = toolkit;
      const response = await handleAuthProxyRequest({
        request: toFetchRequest(req, Buffer.isBuffer(req.body) ? req.body : undefined),
        path: req.path.replace(/^\/api\/auth\//, ''),
        baseUrl,
        cookieSecret,
      });
      await writeFetchResponse(res, response);
    } catch (err) { next(err); }
  });

  return async function requireTrackerUser(req, res, next) {
    try {
      let { user, cookies } = await getSession(req);
      // A cached "not verified" can predate the verification -- the address
      // may have been confirmed in another browser -- so ask Neon Auth before
      // turning a verified user away. Costs a round trip for unverified users only.
      if (decide(user, allowedEmails()) === 'verify') ({ user, cookies } = await getSession(req, { fresh: true }));
      if (cookies.length) res.append('Set-Cookie', cookies);
      const verdict = decide(user, allowedEmails());
      if (verdict === 'allow') {
        req.trackerUser = { email: user.email, name: user.name || null };
        return next();
      }
      const isApi = req.originalUrl.startsWith('/tasks/api/');
      if (verdict === 'denied') {
        const message = `${user.email} is not on this tracker's access list (TRACKER_ALLOWED_EMAILS).`;
        return isApi ? res.status(403).json({ error: message })
          : res.redirect(302, `${LOGIN_PATH}?denied=1`);
      }
      if (isApi) {
        return res.status(401).json({
          error: verdict === 'verify' ? 'Verify your email address first' : 'Sign in required',
        });
      }
      res.redirect(302, verdict === 'verify' ? `${LOGIN_PATH}?verify=1` : LOGIN_PATH);
    } catch (err) { next(err); }
  };
}

module.exports = { enabled, mount, decide, allowedEmails, toFetchRequest, writeFetchResponse, LOGIN_PATH };
