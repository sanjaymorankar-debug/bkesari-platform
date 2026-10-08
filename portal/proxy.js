/**
 * Serves another project under one of the hub's tab paths.
 *
 * The menu's tabs are paths, not hostnames — `/milk/`, `/edu/`, `/ladwani/` —
 * but each of those projects is its own application on its own Hostinger site.
 * This is what joins the two: the hub forwards those paths to the app behind
 * them, so one origin serves the whole estate and the same link works on dev,
 * test and production.
 *
 * Each route is off until its origin is set, and a tab with no origin keeps
 * falling through to the hub's "not on this tier yet" page. So this file
 * changes nothing until a tier is actually configured.
 *
 * THE PATH IS NOT REWRITTEN. `/milk/orders` is forwarded as `/milk/orders`,
 * and the app behind it is expected to serve itself under that prefix — a
 * Next.js `basePath`, Laravel's `APP_URL` path. That is deliberate: if the
 * prefix were stripped here, the app would emit absolute asset URLs like
 * `/_next/...` that the hub does not serve, and the three apps would collide
 * with each other at the root. Getting the app to own its prefix is the only
 * arrangement where its own links come out right.
 *
 * MOUNT THIS BEFORE ANY BODY PARSER. express.json() consumes the request
 * stream, and what follows is worse than an empty body: the forwarded request
 * still carries the original Content-Length, so the app waits for bytes that
 * will never arrive, and the visitor sits there until the proxy timeout fires
 * and hands them a 502. Verified, not guessed — tests/proxy.test.js covers
 * both orders, so moving this in server.js fails the suite.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * The tabs that a separate application can serve, and the environment variable
 * that points each one at its origin. Every other tab is the hub's own: `/`,
 * `/tasks/`, `/atip/`, and the two static pages.
 */
const PROXIED_TABS = [
  { path: '/milk/', env: 'MILK_ORIGIN', name: 'Milk & Dairy Products' },
  { path: '/edu/', env: 'EDU_ORIGIN', name: 'Education' },
  { path: '/ladwani/', env: 'LADWANI_ORIGIN', name: 'LadWani' },
];

/**
 * Reads one origin, or explains why it cannot be used.
 *
 * Strict on purpose. A proxy target is the one setting here that could turn
 * the hub into something it should not be, so anything but a bare http(s)
 * origin is refused rather than interpreted:
 *
 *   - a path (`https://host/app`) would be prepended to every forwarded
 *     request, giving `/app/milk/...`, which is not what anyone meant;
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
  for (const tab of PROXIED_TABS) {
    const value = env[tab.env];
    if (value === undefined || String(value).trim() === '') continue;
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
 * Next.js app with `basePath: '/milk'` serves its home page at `/milk` and
 * redirects `/milk/` to it. Were only `/milk/` forwarded, `/milk` would fall
 * through to the hub's placeholder while the app sat there working.
 *
 * The same longest-prefix rule as the menu's active-tab logic, so a path can
 * never match two tabs.
 */
function matches(route, pathname) {
  const p = String(pathname || '');
  return p === route.base || p.startsWith(route.base + '/');
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
} = {}) {
  const { routes, problems } = readRoutes(env);

  for (const p of problems) {
    log.error(`Not serving ${p.path}: ${p.problem}`);
  }

  for (const route of routes) {
    app.use(
      createProxyMiddleware({
        // Mounted at the root with a filter, NOT as app.use('/milk', ...):
        // Express strips a mount path from req.url, which would send the app
        // `/` and lose the prefix its own links are built on.
        pathFilter: (pathname) => matches(route, pathname),
        target: route.target,
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
            log.error(`Proxy error for ${req.url} -> ${route.target}: ${err.message}`);
            // The socket may already be gone, or headers already sent.
            if (!res || typeof res.writeHead !== 'function' || res.headersSent) return;
            res.writeHead(502, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Robots-Tag': 'noindex',
            });
            // Pathname only: the query string would be noise in the bar's
            // active-tab matching and has no business in the page.
            const pathname = String(req.url || route.path).split('?')[0];
            res.end(unreachablePage(route, renderMenu, pathname, req));
          },
        },
      }),
    );
  }

  return routes;
}

module.exports = { PROXIED_TABS, parseOrigin, readRoutes, matches, mount };
