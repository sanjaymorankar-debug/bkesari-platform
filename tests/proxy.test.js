/**
 * The hub's reverse proxy.
 *
 * Two halves: the pure configuration logic, and a real proxy run against a
 * real upstream. The second half matters more — the mistakes this code can
 * make (a swallowed request body, a stripped path prefix) all look like
 * success from the outside.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const proxy = require('../portal/proxy.js');
const menu = require('../portal/public/shared/menu.js');

// --- Configuration ---------------------------------------------------------

test('a tab is proxied for each project that can have its own app', () => {
  assert.deepEqual(
    proxy.PROXIED_TABS.map((t) => [t.path, t.env]),
    [
      ['/edu/', 'EDU_ORIGIN'],
      ['/ladwani/', 'LADWANI_ORIGIN'],
    ],
  );
});

test('only the tab that cannot own its prefix has it stripped', () => {
  // Which of the two modes a tab uses is a fact about the app behind it, not
  // about the tier, so it is pinned here rather than left to configuration.
  // Next.js owns its prefix through `basePath`; Laravel cannot, because it
  // matches routes against the request path and serves `public/` from the
  // origin's root.
  assert.deepEqual(
    proxy.PROXIED_TABS.map((t) => [t.path, t.strip === true]),
    [
      ['/edu/', true],
      ['/ladwani/', false],
    ],
  );
});

test('every proxied path is a real tab in the menu', () => {
  // A proxy route for a path the menu does not link to would be unreachable,
  // and a typo here would be invisible.
  const tabPaths = menu.TABS.map((t) => t.path);
  for (const tab of proxy.PROXIED_TABS) {
    assert.ok(tabPaths.includes(tab.path), `${tab.path} is not a menu tab`);
  }
});

test('a bare origin is accepted', () => {
  for (const value of [
    'http://127.0.0.1:3001',
    'https://devladwani.bkesari.com',
    'https://devladwani.bkesari.com/',
    '  https://devladwani.bkesari.com  ',
  ]) {
    const got = proxy.parseOrigin(value);
    assert.ok(got.ok, `${value} was rejected: ${got.reason}`);
    assert.ok(!got.origin.endsWith('/'), 'the origin keeps no trailing slash');
  }
});

test('an origin with a path is refused', () => {
  // The hub forwards the tab prefix unchanged, so a target path would be
  // prepended to it and every request would land somewhere unintended.
  const got = proxy.parseOrigin('https://devladwani.bkesari.com/app');
  assert.ok(!got.ok);
  assert.match(got.reason, /path/);
});

test('anything that is not a plain http origin is refused', () => {
  const cases = {
    '': /empty/,
    '   ': /empty/,
    'devladwani.bkesari.com': /not a URL/,
    'file:///etc/passwd': /http/,
    'ftp://host': /http/,
    'https://user:pw@host': /username or password/,
    'https://host/?a=1': /path|query/,
    'https://host/#x': /path|fragment/,
  };
  for (const [value, pattern] of Object.entries(cases)) {
    const got = proxy.parseOrigin(value);
    assert.ok(!got.ok, `${JSON.stringify(value)} should have been refused`);
    assert.match(got.reason, pattern, `wrong reason for ${JSON.stringify(value)}`);
  }
});

test('no routes are configured by default', () => {
  // The whole point: adding this file changes nothing until a tier sets an
  // origin, and the unconfigured tabs keep their placeholder page.
  const { routes, problems } = proxy.readRoutes({});
  assert.deepEqual(routes, []);
  assert.deepEqual(problems, []);
});

test('only the projects with an origin are routed', () => {
  const { routes } = proxy.readRoutes({ LADWANI_ORIGIN: 'http://127.0.0.1:3001' });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, '/ladwani/');
  assert.equal(routes[0].target, 'http://127.0.0.1:3001');
  assert.equal(routes[0].base, '/ladwani');
});

test('a blank origin is treated as unset, not as an error', () => {
  const { routes, problems } = proxy.readRoutes({ LADWANI_ORIGIN: '   ', EDU_ORIGIN: '' });
  assert.deepEqual(routes, []);
  assert.deepEqual(problems, []);
});

test('one bad origin disables its own tab and leaves the others alone', () => {
  const { routes, problems } = proxy.readRoutes({
    LADWANI_ORIGIN: 'http://127.0.0.1:3001',
    EDU_ORIGIN: 'not a url',
  });
  assert.deepEqual(routes.map((r) => r.path), ['/ladwani/']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].problem, /^EDU_ORIGIN /);
});

test('APP_ENV fills in the tier origins the environment leaves unset', () => {
  const prod = proxy.readRoutes({ APP_ENV: 'production' });
  assert.deepEqual(prod.routes.map((r) => [r.path, r.target]), [['/edu/', 'https://edu.bkesari.com']]);
  assert.deepEqual(prod.problems, []);

  const test = proxy.readRoutes({ APP_ENV: 'test' });
  assert.deepEqual(test.routes.map((r) => r.target), ['https://testedu.bkesari.com', 'https://testladwani.bkesari.com']);

  const dev = proxy.readRoutes({ APP_ENV: 'dev', EDU_ORIGIN: '  ' });
  assert.deepEqual(dev.routes.map((r) => r.target), ['https://devedu.bkesari.com', 'https://devladwani.bkesari.com']);
});

test('an origin set in the environment wins over the tier default', () => {
  const { routes } = proxy.readRoutes({ APP_ENV: 'production', EDU_ORIGIN: 'http://127.0.0.1:8000' });
  assert.deepEqual(routes.map((r) => r.target), ['http://127.0.0.1:8000']);
});

test('an unknown APP_ENV gets no defaults', () => {
  assert.deepEqual(proxy.readRoutes({ APP_ENV: 'local' }).routes, []);
});

test('the proxy reads APP_ENV as the same tier the hub reports, never another', () => {
  // A spelling the proxy took for a tier while the hub fell back to the
  // hostname could put production behind dev.bkesari.com, or the reverse.
  for (const v of ['dev', 'Development', ' test ', 'STAGING', 'prod', 'Production', 'local', 'qa', 'live', '', undefined]) {
    const edu = proxy.readRoutes({ APP_ENV: v }).routes.find((r) => r.key === 'edu');
    const tiers = new Set(['dev.bkesari.com', 'test.bkesari.com', 'bkesari.com'].map((h) => menu.resolveEnv(h, v)));
    assert.equal(Boolean(edu), tiers.size === 1, `APP_ENV=${JSON.stringify(v)}: proxy ${edu ? edu.target : 'none'}, hub ${[...tiers]}`);
    if (edu) assert.equal(edu.target, proxy.TIER_ORIGINS[[...tiers][0]].edu);
  }
});

test('a tab matches with and without its trailing slash', () => {
  const [route] = proxy.readRoutes({ LADWANI_ORIGIN: 'http://x' }).routes;
  // A Next.js app with basePath /ladwani serves its home page at /ladwani, so a
  // request there has to reach the app rather than the hub's placeholder.
  assert.ok(proxy.matches(route, '/ladwani'));
  assert.ok(proxy.matches(route, '/ladwani/'));
  assert.ok(proxy.matches(route, '/ladwani/orders/42'));
  assert.ok(proxy.matches(route, '/ladwani/_next/static/chunk.js'));
});

test('a path that only looks like a tab is not proxied', () => {
  const [route] = proxy.readRoutes({ LADWANI_ORIGIN: 'http://x' }).routes;
  assert.ok(!proxy.matches(route, '/ladwanishake'));
  assert.ok(!proxy.matches(route, '/ladwanishake/x'));
  assert.ok(!proxy.matches(route, '/'));
  assert.ok(!proxy.matches(route, '/tasks/'));
  assert.ok(!proxy.matches(route, '/shared/menu.js'));
  assert.ok(!proxy.matches(route, ''));
});

test('stripping a prefix leaves a request the app can answer', () => {
  const route = { base: '/edu' };
  const strip = (url) => proxy.stripPrefix(route, url);

  // The tab's own home page has to become `/`, not the empty string: an empty
  // request target is not valid and the app would never see its home page.
  assert.equal(strip('/edu'), '/');
  assert.equal(strip('/edu/'), '/');

  assert.equal(strip('/edu/login'), '/login');
  assert.equal(strip('/edu/livewire/update'), '/livewire/update');
  // Laravel's compiled assets are served from the origin's root, which is the
  // whole reason this tab strips.
  assert.equal(strip('/edu/build/assets/app-BvRk9kiK.js'), '/build/assets/app-BvRk9kiK.js');
});

test('stripping a prefix keeps the query string', () => {
  // `?page=2` is the difference between a listing's second page and its first.
  const route = { base: '/edu' };
  assert.equal(proxy.stripPrefix(route, '/edu/courses?page=2&sort=name'), '/courses?page=2&sort=name');
  assert.equal(proxy.stripPrefix(route, '/edu?page=2'), '/?page=2');
  assert.equal(proxy.stripPrefix(route, '/edu/a?q=/edu/b'), '/a?q=/edu/b');
});

// --- A real proxy, against a real upstream ---------------------------------

/** Starts a server on an arbitrary free port and resolves its origin. */
function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const close = (server) => new Promise((r) => server.close(r));

/**
 * The hub's middleware order, reproduced: the proxy, then the body parsers,
 * then a catch-all standing in for the placeholder route.
 */
async function hubWith(env, { parsersFirst = false, timeoutMs } = {}) {
  const app = express();
  const mountProxy = () =>
    proxy.mount(app, {
      env,
      renderMenu: (pathname, req) =>
        menu.renderHtml({ pathname, env: 'dev', req }),
      log: { error: () => {} },
      ...(timeoutMs ? { timeoutMs } : {}),
    });

  if (parsersFirst) app.use(express.json({ limit: '1mb' }));
  const routes = mountProxy();
  if (!parsersFirst) app.use(express.json({ limit: '1mb' }));

  app.use((req, res) => res.status(404).type('html').send('not on this tier yet'));
  const { server, origin } = await listen(app);
  return { server, origin, routes };
}

test('a configured tab is forwarded to its app, prefix intact', async () => {
  // The upstream echoes what it was asked for, which is how the test can tell
  // the prefix survived. Stripping it is the failure this guards: the app's
  // own asset URLs are built on it.
  const upstream = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, host: req.headers.host }));
  });
  const hub = await hubWith({ LADWANI_ORIGIN: upstream.origin });
  try {
    for (const path of ['/ladwani', '/ladwani/', '/ladwani/orders/42', '/ladwani/_next/static/a.js']) {
      const res = await fetch(hub.origin + path);
      assert.equal(res.status, 200, `${path} did not reach the app`);
      const body = await res.json();
      assert.equal(body.url, path, `${path} arrived at the app as ${body.url}`);
    }
    // A query string is carried through untouched.
    const withQuery = await (await fetch(hub.origin + '/ladwani/search?q=ghee&page=2')).json();
    assert.equal(withQuery.url, '/ladwani/search?q=ghee&page=2');
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('a stripping tab reaches its app at the root, and only that tab', async () => {
  // Both tabs are configured against the same upstream, so the two modes are
  // compared under one hub rather than in isolation: a mistake that stripped
  // every tab, or none, fails here.
  const upstream = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: req.url }));
  });
  const hub = await hubWith({ EDU_ORIGIN: upstream.origin, LADWANI_ORIGIN: upstream.origin });
  try {
    const seen = async (path) => (await (await fetch(hub.origin + path)).json()).url;

    assert.equal(await seen('/edu'), '/');
    assert.equal(await seen('/edu/'), '/');
    assert.equal(await seen('/edu/login'), '/login');
    // The asset path that only resolves once the prefix is off.
    assert.equal(await seen('/edu/build/assets/app.js'), '/build/assets/app.js');
    assert.equal(await seen('/edu/courses?page=2'), '/courses?page=2');

    // ...while the tab that owns its prefix still keeps it.
    assert.equal(await seen('/ladwani/orders/42'), '/ladwani/orders/42');
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test("a Livewire update reaches the app stripped, with its body", async () => {
  // Every interactive page in Education posts to this one endpoint, including
  // the login form, which has no `action` of its own. If the path arrived
  // prefixed it would 404 on a route Laravel never registered, and if the body
  // were eaten the component would come back empty — so both are checked in
  // the shape the app actually sees.
  const upstream = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: req.url, method: req.method, body }));
    });
  });
  const hub = await hubWith({ EDU_ORIGIN: upstream.origin });
  try {
    const payload = JSON.stringify({ components: [{ snapshot: '{}', updates: {} }] });
    const res = await fetch(hub.origin + '/edu/livewire/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Livewire': '1' },
      body: payload,
    });
    assert.equal(res.status, 200);
    const got = await res.json();
    assert.equal(got.url, '/livewire/update');
    assert.equal(got.method, 'POST');
    assert.equal(got.body, payload);
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('an unconfigured tab still gets the hub placeholder', async () => {
  const hub = await hubWith({ LADWANI_ORIGIN: '' });
  try {
    const res = await fetch(hub.origin + '/ladwani/');
    assert.equal(res.status, 404);
    assert.match(await res.text(), /not on this tier yet/);
  } finally {
    await close(hub.server);
  }
});

test('a POST body reaches the app intact', async () => {
  // THE ORDERING TEST. express.json() consumes the request stream, so a proxy
  // mounted after it forwards an empty body and nothing anywhere reports a
  // problem. If this fails, check that proxy.mount runs before the parsers in
  // portal/server.js.
  const upstream = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, received: body }));
    });
  });
  const hub = await hubWith({ LADWANI_ORIGIN: upstream.origin });
  try {
    const payload = JSON.stringify({ order: 'ghee', qty: 3 });
    const res = await fetch(hub.origin + '/ladwani/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const body = await res.json();
    assert.equal(body.method, 'POST');
    assert.equal(body.received, payload, 'the app received a different body');
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('mounting the parsers first makes a POST hang, not merely lose its body', async () => {
  // Proves the test above is not passing by luck, and records the real failure
  // mode: express.json() drains the stream, but the forwarded request keeps
  // its Content-Length, so the app waits for bytes that never come. The
  // visitor gets nothing until the proxy timeout, then a 502 — which is why
  // the mount order in server.js is load-bearing.
  //
  // A short timeout here so the suite does not spend the real 30 seconds
  // demonstrating it.
  let sawBody = false;
  const upstream = await listen((req, res) => {
    req.on('data', () => { sawBody = true; });
    req.on('end', () => { res.writeHead(200); res.end('ok'); });
  });
  const hub = await hubWith(
    { LADWANI_ORIGIN: upstream.origin },
    { parsersFirst: true, timeoutMs: 300 },
  );
  try {
    // No usable response at all. The 502 page in the test below is reached
    // only when the connection is REFUSED outright, before anything is
    // forwarded; a request that stalls mid-flight is past that point, so the
    // timeout tears the socket down and the browser shows its own error. Both
    // are bad, and this one is harder to diagnose from the outside, which is
    // the whole reason the mount order is pinned by a test.
    await assert.rejects(
      fetch(hub.origin + '/ladwani/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: 'ghee' }),
      }),
      'the request should have failed rather than succeeded',
    );
    assert.equal(sawBody, false, 'no body byte should have reached the app');
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('the app is told which origin it is being viewed under', async () => {
  // The app builds its own absolute links; without these it would advertise
  // its private hostname instead of the hub's.
  const upstream = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.headers));
  });
  const hub = await hubWith({ LADWANI_ORIGIN: upstream.origin });
  try {
    const headers = await (await fetch(hub.origin + '/ladwani/')).json();
    assert.ok(headers['x-forwarded-host'], 'no X-Forwarded-Host');
    assert.ok(headers['x-forwarded-proto'], 'no X-Forwarded-Proto');
    assert.ok(headers['x-forwarded-for'], 'no X-Forwarded-For');
    // changeOrigin: the upstream sees its own host, so virtual hosting and TLS
    // SNI resolve to the right site.
    assert.equal(headers.host, upstream.origin.replace('http://', ''));
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('response headers and status from the app are passed through', async () => {
  const upstream = await listen((req, res) => {
    res.writeHead(201, { 'Content-Type': 'text/plain', 'X-From-App': 'yes' });
    res.end('created');
  });
  const hub = await hubWith({ LADWANI_ORIGIN: upstream.origin });
  try {
    const res = await fetch(hub.origin + '/ladwani/api/thing', { method: 'POST' });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('x-from-app'), 'yes');
    assert.equal(await res.text(), 'created');
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test("a redirect to the app's own origin is rewritten onto the hub", async () => {
  // autoRewrite. Without it the browser would be sent to the app's private
  // hostname, leaving the hub's path behind.
  const upstream = await listen((req, res) => {
    res.writeHead(302, { Location: `${upstream.origin}/ladwani/signin` });
    res.end();
  });
  const hub = await hubWith({ LADWANI_ORIGIN: upstream.origin });
  try {
    const res = await fetch(hub.origin + '/ladwani/account', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${hub.origin}/ladwani/signin`);
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('an app that is down gives a 502 that still carries the menu', async () => {
  // Nothing is listening on this port, so the proxy's error path runs.
  const hub = await hubWith({ LADWANI_ORIGIN: 'http://127.0.0.1:1' });
  try {
    const res = await fetch(hub.origin + '/ladwani/');
    assert.equal(res.status, 502);
    const html = await res.text();
    assert.match(html, /not responding/);
    // The bar, so the rest of the estate stays reachable from the error page.
    assert.match(html, /bk-tabs/);
    assert.match(html, /Driving Simulator/);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  } finally {
    await close(hub.server);
  }
});

test("a stripping tab's 502 page still marks that tab as current", async () => {
  // By the time the error handler runs, http-proxy-middleware has rewritten
  // req.url for /edu/ to the stripped path, so a page built from it lit up no
  // tab at all. The bar has to be built from the path the visitor asked for.
  const hub = await hubWith({ EDU_ORIGIN: 'http://127.0.0.1:1' });
  try {
    const res = await fetch(hub.origin + '/edu/login?next=%2Fadmin');
    assert.equal(res.status, 502);
    const html = await res.text();
    assert.match(html, /not responding/);
    assert.match(html, /<a href="\/edu\/" aria-current="page">Education<\/a>/);
  } finally {
    await close(hub.server);
  }
});

test('a large response body streams through', async () => {
  // A buffering proxy would blow up on a real page with images; this is a
  // cheap guard that the response is piped rather than accumulated.
  const chunk = 'x'.repeat(64 * 1024);
  const upstream = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    for (let i = 0; i < 16; i += 1) res.write(chunk);
    res.end();
  });
  const hub = await hubWith({ LADWANI_ORIGIN: upstream.origin });
  try {
    const text = await (await fetch(hub.origin + '/ladwani/big')).text();
    assert.equal(text.length, chunk.length * 16);
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('a path spelled with dot segments cannot reach an app past its gate', async () => {
  // The gate decides on the path as sent; http-proxy-middleware's pathFilter
  // is handed a WHATWG-normalised one, where /./ladwani/ and /x/../ladwani/
  // are /ladwani/ and /ladwani/%2e%2e/edu/ is /edu/. Whatever is forwarded
  // must have been through the gate of the tab it is forwarded to.
  const reached = [];
  const upstream = await listen((req, res) => { reached.push(req.url); res.end('app'); });
  const app = express();
  const gated = [];
  const refuse = (key) => (req, res) => { gated.push(key); res.status(403).end('gate'); };
  proxy.mount(app, {
    env: { EDU_ORIGIN: upstream.origin, LADWANI_ORIGIN: upstream.origin },
    gates: { edu: refuse('edu'), ladwani: refuse('ladwani') },
    log: { error: () => {} },
  });
  app.use((req, res) => res.status(404).end('hub'));
  const hub = await listen(app);
  // fetch() would normalise these itself, so send the request line as written.
  const raw = (path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: hub.server.address().port, path }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  try {
    for (const path of ['/./ladwani/', '/x/../ladwani/orders', '/%2e/ladwani/', '/ladwani/%2e%2e/edu/', '/edu/../ladwani/', '/./edu/login']) {
      const status = await raw(path);
      assert.notEqual(status, 200, `${path} reached the app (${status})`);
    }
    assert.deepEqual(reached, [], `forwarded without passing the gate: ${reached.join(', ')}`);
    // The plain spellings still meet their gate.
    assert.equal(await raw('/ladwani/'), 403);
    assert.equal(await raw('/edu/login'), 403);
    assert.deepEqual(gated.slice(-2), ['ladwani', 'edu']);
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});

test('a tier default meets its gate like any other origin, and a forged token never reaches the app', async () => {
  // TIER_ORIGINS points at live sites; for this test only, dev's point here.
  const reached = [];
  const upstream = await listen((req, res) => { reached.push([req.url, req.headers['x-bkesari-token'] || null]); res.end('app'); });
  const saved = proxy.TIER_ORIGINS.dev;
  proxy.TIER_ORIGINS.dev = { edu: upstream.origin, ladwani: upstream.origin };
  const app = express();
  let routes;
  try {
    routes = proxy.mount(app, {
      env: { APP_ENV: 'dev' },
      gates: {
        // Lets a request through without a token of its own, as a gate never does.
        edu: (req, res, next) => next(),
        ladwani: (req, res) => res.status(403).end('gate'),
      },
      log: { error: () => {} },
    });
  } finally {
    proxy.TIER_ORIGINS.dev = saved;
  }
  app.use((req, res) => res.status(404).end('hub'));
  const hub = await listen(app);
  const get = (path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: hub.server.address().port, path, headers: { 'x-bkesari-token': 'forged' } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  try {
    assert.deepEqual(routes.map((r) => r.target), [upstream.origin, upstream.origin]);
    assert.equal(await get('/ladwani/orders'), 403);
    assert.equal(await get('/x/../ladwani/'), 404);
    assert.equal(await get('/edu/login?x=1'), 200);
    assert.deepEqual(reached, [['/login?x=1', null]]);
  } finally {
    await close(hub.server);
    await close(upstream.server);
  }
});
