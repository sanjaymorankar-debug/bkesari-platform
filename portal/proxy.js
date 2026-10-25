/**
 * Serves another project under one of the hub's tab paths.
 *
 * The menu's tabs are paths, not hostnames — `/edu/`, `/ladwani/` —
 * but each of those projects is its own application on its own Hostinger site.
 * This is what joins the two: the hub forwards those paths to the app behind
 * them, so one origin serves the whole estate and the same link works on dev,
 * test and production.
 *
 * Each route is off until it has an origin: its variable, or, when that is
 * unset and APP_ENV names a tier, the tier's entry in TIER_ORIGINS below. A
 * tab with neither keeps falling through to the hub's "not on this tier yet"
 * page, so with no APP_ENV this file changes nothing until a tier is configured.
 *
 * THE PREFIX IS FORWARDED UNCHANGED, UNLESS A TAB ASKS OTHERWISE.
 * `/ladwani/orders` is forwarded as `/ladwani/orders`, and the app behind it serves
 * itself under that prefix (a Next.js `basePath`). Stripping it there would
 * make the app emit `/_next/...` asset URLs the hub does not serve, and the
 * apps would collide with each other at the root.
 *
 * A tab marked `strip` is the other case: the prefix is removed before the
 * request is forwarded, so the app answers at its own root. That is for
 * Laravel, where the two halves of the job pull in opposite directions —
 * routes are matched against the request path, so a prefix the app does not
 * know about is a 404 on every page, while `public/` is served by the web
 * server at the origin's root, so `/edu/build/app.js` has nowhere to come
 * from unless the prefix comes off. The prefix goes back on in the app's
 * OUTPUT instead, via `URL::forceRootUrl()`. See DEPLOY.md Part 7.
 *
 * So a stripping tab depends on the app to emit prefixed URLs itself:
 * `autoRewrite` repairs the host in a Location header but never the path, and
 * an app that redirects to a bare `/dashboard` lands on the hub, not the tab.
 *
 * MOUNT THIS BEFORE ANY BODY PARSER. express.json() consumes the request
 * stream, and what follows is worse than an empty body: the forwarded request
 * still carries the original Content-Length, so the app waits for bytes that
 * will never arrive, and the visitor sits there until the proxy timeout fires
 * and hands them a 502. Verified, not guessed — tests/proxy.test.js covers
 * both orders, and tests/server.test.js fails if server.js moves it.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * The tabs that a separate application can serve, and the environment variable
 * that points each one at its origin. Every other tab is the hub's own: `/`,
 * `/tasks/`, `/atip/`, and the two static pages.
 */
const PROXIED_TABS = [
  // `strip`: Laravel matches routes against the request path and serves
  // `public/` from the origin's root, so it cannot own the prefix the way a
  // Next.js app does. It puts the prefix back on its own output instead.
  { key: 'edu', path: '/edu/', env: 'EDU_ORIGIN', name: 'Education', strip: true },
  { key: 'ladwani', path: '/ladwani/', env: 'LADWANI_ORIGIN', name: 'LadWani' },
];

/**
 * Where each tier's projects live on Hostinger, used when the tab's variable is
 * unset. These are public addresses, not secrets, so they belong in the code
 * rather than in a full-replace environment set that has to carry every secret
 * just to add one URL. Keyed by APP_ENV only: a local run without APP_ENV gets
 * no defaults and keeps the "not on this tier yet" page.
 *
 * LadWani has none: the hub serves it itself (portal/ladwani.js). An explicit
 * LADWANI_ORIGIN still proxies it, for running it as a separate app locally.
 */
const TIER_ORIGINS = {
  dev: { edu: 'https://devedu.bkesari.com' },
  test: { edu: 'https://testedu.bkesari.com' },
  prod: { edu: 'https://edu.bkesari.com' },
};

function tierOf(appEnv) {
  const v = String(appEnv || '').trim().toLowerCase();
  if (v === 'dev' || v === 'development') return 'dev';
  if (v === 'test' || v === 'staging') return 'test';
  if (v === 'prod' || v === 'production') return 'prod';
  return null;
}

/**
 * Reads one origin, or explains why it cannot be used.
 *
 * Strict on purpose. A proxy target is the one setting here that could turn
 * the hub into something it should not be, so anything but a bare http(s)
 * origin is refused rather than interpreted:
 *
 *   - a path (`https://host/app`) would be prepended to every forwarded
 *     request, giving `/app/ladwani/...`, which is not what anyone meant;
 *   - a query or fragment is meaningless for an origin and signals a mistake;
 *   - embedded credentials would end up in logs and error pages.
 */
function parseOrigin(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return { ok: false, reason: 'is empty' };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `is not a URL: ${JSON.stringify(raw)}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `must be http:// or https://, got ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'must not contain a username or password' };
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return {
      ok: false,
      reason: `must be an origin with no path, got a path of ${JSON.stringify(url.pathname)}. `
        + 'The hub forwards the tab prefix unchanged, so the target cannot add one.',
    };
  }
  if (url.search || url.hash) {
    return { ok: false, reason: 'must not contain a query string or fragment' };
  }
  return { ok: true, origin: url.origin };
}

/**
 * Which tabs are configured, from a given environment. Returns the usable
 * routes and the problems, rather than throwing: one mistyped origin should
 * take out its own tab, not the whole hub.
 */
function readRoutes(env) {
  const routes = [];
  const problems = [];
  const defaults = TIER_ORIGINS[tierOf(env.APP_ENV)] || {};
  for (const tab of PROXIED_TABS) {
    const set = env[tab.env];
    const value = set === undefined || String(set).trim() === '' ? defaults[tab.key] : set;
    if (value === undefined) continue;
    const parsed = parseOrigin(value);
    if (parsed.ok) {
      routes.push({ ...tab, target: parsed.origin, base: tab.path.replace(/\/$/, '') });
    } else {
      problems.push({ ...tab, problem: `${tab.env} ${parsed.reason}` });
    }
  }
  return { routes, problems };
}

/**
 * True when this request belongs to `route`.
 *
 * Matches the tab's path with and without its trailing slash, because a
 * Next.js app with `basePath: '/ladwani'` serves its home page at `/ladwani` and
 * redirects `/ladwani/` to it. Were only `/ladwani/` forwarded, `/ladwani` would fall
 * through to the hub's placeholder while the app sat there working.
 *
 * The same longest-prefix rule as the menu's active-tab logic, so a path can
 * never match two tabs.
 */
function matches(route, pathname) {
  const p = String(pathname || '');
  return p === route.base || p.startsWith(route.base + '/');
}

/** The path exactly as the request line carried it, which is what the gate sees as req.path. */
function requestPath(req) {
  return String((req && (req.originalUrl || req.url)) || '').split(/[?#]/)[0];
}

/**
 * Removes a tab's prefix from a request URL, for a route marked `strip`.
 *
 * Takes the whole `req.url` because that is what http-proxy-middleware hands
 * `pathRewrite`, query string and all, and the query has to survive: `?page=2`
 * is the difference between a listing's second page and its first.
 *
 * `pathFilter` has already established that the path is the base or sits
 * under it, so what is left is either empty or starts with a slash. Empty
 * becomes `/`, so `/edu` reaches the app as its home page rather than as the
 * empty string, which is not a valid request target.
 */
function stripPrefix(route, url) {
  const raw = String(url == null ? '' : url);
  const cut = raw.search(/[?#]/);
  const path = cut === -1 ? raw : raw.slice(0, cut);
  const suffix = cut === -1 ? '' : raw.slice(cut);
  return (path.slice(route.base.length) || '/') + suffix;
}

/**
 * The page shown when a configured app does not answer.
 *
 * Carries the menu, like the "not on this tier yet" page does, so a project
 * being down leaves the rest of the estate reachable instead of dead-ending.
 */
function unreachablePage(route, renderMenu, pathname, req) {
  const name = route.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — not responding</title></head>
<body style="margin:0;font:15px/1.5 'Inter',system-ui,sans-serif;background:#F6F4EF;color:#1B1D24">
${renderMenu(pathname, req)}
<div style="max-width:620px;margin:0 auto;padding:56px 16px">
  <h1 style="font-size:26px;letter-spacing:-.02em;margin:0 0 10px">${name}</h1>
  <p style="color:#5F6472;margin:0 0 6px">This project is configured on this tier
  but is not answering right now.</p>
  <p style="color:#9A9EA9;margin:0">Everything else in the menu above still works.</p>
</div></body></html>`;
}

/**
 * Mounts a route per configured project.
 *
 * `renderMenu(pathname, req)` renders the shared bar for the error page; it is
 * passed in rather than imported so this module owns no copy of the tier
 * detection that lives in server.js.
 *
 * Returns the routes it mounted, for the startup log and for tests.
 */
function mount(app, {
  env = process.env,
  // Defaulted so a caller that forgets it gets a bare 502 page rather than a
  // throw inside the error handler, which would turn one project being down
  // into an unhandled exception.
  renderMenu = () => '',
  log = console,
  // How long to wait on the app behind a tab. Long enough for a cold Next.js
  // route on shared hosting, short enough that a dead app does not hold a
  // visitor's browser open. Overridable so tests need not wait it out.
  timeoutMs = 30_000,
  // Per-project access checks, keyed by route key ('edu', 'ladwani'). A gate
  // is Express middleware that either answers (sign-in, request access, 404)
  // or sets the signed X-Bkesari-Token header and calls next().
  gates = {},
} = {}) {
  const { routes, problems } = readRoutes(env);

  for (const p of problems) {
    log.error(`Not serving ${p.path}: ${p.problem}`);
  }

  for (const route of routes) {
    app.use((req, res, next) => {
      if (!matches(route, req.path)) return next();
      // Whatever the browser sent under this name is forged: only a gate may set it.
      delete req.headers['x-bkesari-token'];
      const gate = gates[route.key];
      return gate ? gate(req, res, next) : next();
    });
    app.use(
      createProxyMiddleware({
        // Mounted at the root with a filter, NOT as app.use('/ladwani', ...):
        // Express strips a mount path from req.url, so a pass-through tab would
        // lose the prefix its app's own links are built on, and a stripping tab
        // would have the rewrite done for it where it can neither be seen nor
        // tested. Whether the prefix goes is decided below, in one place.
        // Both spellings must match. `pathname` is WHATWG-normalised (so
        // /./ladwani/ and /ladwani/%2e%2e/edu/ arrive as /ladwani/ and /edu/),
        // while the gate above decided on the path as sent. Forwarding on the
        // normalised one alone let those spellings past the gate.
        pathFilter: (pathname, req) => matches(route, pathname) && matches(route, requestPath(req)),
        target: route.target,
        // Only for a tab that cannot own its prefix; see the file header.
        ...(route.strip ? { pathRewrite: (url) => stripPrefix(route, url) } : {}),
        // Name-based virtual hosts need the Host header to match the target,
        // and so does TLS SNI when the target is https.
        changeOrigin: true,
        // Verify certificates. The projects sit behind real certificates on
        // the same account; a target that needs this off is a target worth
        // looking at rather than trusting.
        secure: true,
        // X-Forwarded-For / -Proto / -Host / -Port, so the app can work out
        // the public origin it is being viewed under.
        xfwd: true,
        // Rewrite the host in a Location header pointing at the app's own
        // origin, so its redirects land back on the hub.
        autoRewrite: true,
        // Let the browser see redirects; following them here would hide them.
        followRedirects: false,
        proxyTimeout: timeoutMs,
        timeout: timeoutMs,
        on: {
          error: (err, req, res) => {
            // originalUrl: for a stripping tab, req.url has already lost the
            // prefix by now, and the bar would light up no tab at all.
            const url = req.originalUrl || req.url;
            log.error(`Proxy error for ${url} -> ${route.target}: ${err.message}`);
            // The socket may already be gone, or headers already sent.
            if (!res || typeof res.writeHead !== 'function' || res.headersSent) return;
            res.writeHead(502, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Robots-Tag': 'noindex',
            });
            // Pathname only: the query string would be noise in the bar's
            // active-tab matching and has no business in the page.
            const pathname = String(url || route.path).split('?')[0];
            res.end(unreachablePage(route, renderMenu, pathname, req));
          },
        },
      }),
    );
  }

  return routes;
}

module.exports = { PROXIED_TABS, TIER_ORIGINS, parseOrigin, readRoutes, matches, stripPrefix, mount };
