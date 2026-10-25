/**
 * The real portal/server.js app (createApp), with no database: the routes
 * here never reach one. What is pinned is what only the assembled app can
 * show: the Task Tracker's login however a path is spelled, what a malformed
 * body gets back, and the proxy's place before the body parsers in THIS file
 * rather than in a copy of its order.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../portal/server.js');

// Never called by the routes under test; a call would be a test bug.
// The hub's permission lookups are the exception: `approved` is the one person
// the stand-in sign-in below knows, and holds every project's access.
const HUB_PROJECTS = [
  { key: 'ladwani', name: 'LadWani', path: '/ladwani/', visibility: 'approval', roles: 'member,karta,operator,admin', sort_order: 10 },
  { key: 'atip', name: 'ATIP', path: '/ATIP/', visibility: 'owner', roles: 'owner', sort_order: 20 },
  { key: 'edu', name: 'Education', path: '/edu/', visibility: 'approval', roles: 'parent,student,teacher,school_admin,admin', sort_order: 30 },
  { key: 'tasklist', name: 'TaskList', path: '/tasks/', visibility: 'approval', roles: 'viewer,editor,owner', sort_order: 40 },
];
const stubDb = (approved) => new Proxy({}, { get: (_, k) => async (sql) => {
  if (k === 'all' && /FROM hub_projects/.test(sql)) return HUB_PROJECTS;
  if (k === 'all' && /FROM project_access/.test(sql)) return approved ? HUB_PROJECTS.map((p) => ({ project_key: p.key, role: p.roles.split(',')[0] })) : [];
  if (k === 'get' && /FROM project_access/.test(sql)) return approved ? { ok: 1 } : null;
  throw new Error(`unexpected db.${String(k)}(${String(sql).slice(0, 60)})`);
} });
const noDb = stubDb(false);
const APPROVED_USER = { id: 'u-approved', email: 'member@example.com', emailVerified: true };

const ENV = {
  TRACKER_USER: 'tracker', TRACKER_PASSWORD: 'tracker-pw',
  ATIP_USER: 'viewer', ATIP_PASSWORD: 'viewer-pw', ATIP_PUBLISH_TOKEN: 'token',
  EDU_ORIGIN: '', LADWANI_ORIGIN: '', APP_ENV: 'dev',
};

/** Runs `fn(base)` against createApp with `env` applied to process.env, then puts it back. */
async function withHub(env, fn, { db = noDb, extra = {} } = {}) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  const { app } = createApp(db, extra);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/**
 * A request with the path sent exactly as written. fetch() and new URL() fold
 * dot segments and slashes before sending, which would hide what is tested.
 */
function raw(port, method, rawPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: rawPath, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, type: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const basic = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });

test('the Task Tracker page needs its login however the path is spelled', async () => {
  await withHub(ENV, async (base, port) => {
    const spellings = [
      '/tasks/', '/tasks/index.html',
      '/%74asks/', '/%74asks/index.html', '/tasks%2findex.html', '/%74asks',
      '//tasks/', '/./tasks/', '/shared/../tasks/', '/x/y/../../tasks/index.html',
      '/shared/%2e%2e/tasks/index.html', '/%54ASKS/', '/TASKS/',
    ];
    for (const p of spellings) {
      const r = await raw(port, 'GET', p);
      assert.equal(r.status, 401, `${p} answered ${r.status}`);
      assert.doesNotMatch(r.text, /Task Tracker/, `${p} served the page`);
    }
    // ...and the login still works the normal way.
    const ok = await raw(port, 'GET', '/tasks/', { headers: basic('tracker', 'tracker-pw') });
    assert.equal(ok.status, 200);
    assert.match(ok.text, /<title>Task Tracker<\/title>/);
    assert.equal((await raw(port, 'GET', '/tasks/', { headers: basic('tracker', 'wrong') })).status, 401);
    // The rest of the site is untouched by the check.
    assert.equal((await raw(port, 'GET', '/')).status, 200);
    assert.equal((await raw(port, 'GET', '/shared/menu.js')).status, 200);
  });
});

test('a malformed JSON body is a 400 that gives nothing away', async () => {
  await withHub(ENV, async (base, port) => {
    const paths = [
      ['/', {}],
      ['/tasks/api/projects', {}],
      ['/tasks/api/projects', basic('tracker', 'tracker-pw')],
      ['/ATIP/api/snapshot', { authorization: 'Bearer token' }],
    ];
    for (const [p, auth] of paths) {
      const r = await raw(port, 'POST', p, { headers: { 'content-type': 'application/json', ...auth }, body: '{bad' });
      assert.equal(r.status, 400, `${p} answered ${r.status}`);
      assert.match(r.type, /application\/json/);
      assert.deepEqual(JSON.parse(r.text), { error: 'The request body is not valid JSON' });
      // Express's default page carried the stack: file paths, node_modules, "at ..." frames.
      assert.doesNotMatch(r.text, /node_modules|server\.js|\bat \w|SyntaxError/, `${p} leaked: ${r.text}`);
    }
  });
});

test('the real server.js mounts the proxy before the body parsers', async () => {
  // tests/proxy.test.js proves why the order matters on a copy of it; this is
  // the copy that ships. Moving proxy.mount below express.json() in
  // portal/server.js makes this POST hang and fail.
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: req.url, body })); });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  try {
    await withHub({ ...ENV, LADWANI_ORIGIN: origin }, async (base) => {
      const payload = JSON.stringify({ order: 'ghee', qty: 3 });
      const res = await fetch(`${base}/ladwani/api/orders`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: AbortSignal.timeout(5000),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { url: '/ladwani/api/orders', body: payload });
    }, { db: stubDb(true), extra: { getUser: async () => APPROVED_USER } });
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('the report proxy answers 502, not 500, when the function cannot be reached', async () => {
  // A port that was free a moment ago: nothing is listening on it.
  const spare = http.createServer();
  await new Promise((resolve) => spare.listen(0, '127.0.0.1', resolve));
  const dead = `http://127.0.0.1:${spare.address().port}/`;
  await new Promise((resolve) => spare.close(resolve));
  await withHub({ ...ENV, NEON_FUNCTION_REPORT_BASE_URL: dead, ORIGIN_SECRET: 'origin-secret' }, async (base, port) => {
    const r = await raw(port, 'GET', '/tasks/api/report', { headers: basic('tracker', 'tracker-pw') });
    assert.equal(r.status, 502);
    assert.deepEqual(JSON.parse(r.text), { error: 'The report function did not answer' });
  });
});

test('with Realtime off the live endpoint is a 404 the page can read, behind the login', async () => {
  // bkesari-hub runs PostgreSQL 16, which Neon Realtime does not serve, so this
  // is the production configuration: tasks/index.html takes the 404 as "no
  // live updates". Half a configuration is still off.
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  for (const rt of [
    { NEON_REALTIME_URL: '', NEON_REALTIME_SECRET: '' },
    { NEON_REALTIME_URL: 'wss://127.0.0.1:1/realtime', NEON_REALTIME_SECRET: '' },
    { NEON_REALTIME_URL: '', NEON_REALTIME_SECRET: secret },
  ]) {
    await withHub({ ...ENV, ...rt }, async (base, port) => {
      const r = await raw(port, 'GET', '/tasks/api/live', { headers: basic('tracker', 'tracker-pw') });
      assert.equal(r.status, 404, JSON.stringify(rt));
      assert.match(r.type, /application\/json/);
      assert.deepEqual(JSON.parse(r.text), { error: 'Live updates are not configured' });
      assert.equal((await raw(port, 'GET', '/tasks/api/live')).status, 401);
    });
  }
});

test('under Neon Auth the Task Tracker still needs its login however the path is spelled', async () => {
  // A stand-in Neon Auth: get-session answers for whoever the test cookie
  // names. The toolkit forwards only its own (__Secure-neon-auth.*) cookies.
  const auth = http.createServer((req, res) => {
    const who = (/__Secure-neon-auth\.test=(\w+)/.exec(req.headers.cookie || '') || [])[1];
    const user = who === 'allowed' ? { email: 'asha@example.com', emailVerified: true }
      : who === 'stranger' ? { email: 'ravi@example.com', emailVerified: true } : null;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/get-session') && user ? { user, session: { id: 's' } } : null));
  });
  await new Promise((resolve) => auth.listen(0, '127.0.0.1', resolve));
  const env = {
    ...ENV,
    NEON_AUTH_BASE_URL: `http://127.0.0.1:${auth.address().port}/neondb/auth`,
    NEON_AUTH_COOKIE_SECRET: 'test-only-cookie-secret-0123456789abcdef',
    TRACKER_ALLOWED_EMAILS: 'asha@example.com',
  };
  const as = (who) => ({ cookie: `__Secure-neon-auth.test=${who}` });
  try {
    await withHub(env, async (base, port) => {
      const spellings = [
        '/tasks/', '/tasks/index.html', '/tasks/live.js', '/tasks/api/overview',
        '/%74asks/', '/%74asks/index.html', '/tasks%2findex.html', '/%74asks/api/overview',
        '//tasks/', '//tasks/api/overview', '/./tasks/', '/shared/../tasks/',
        '/shared/%2e%2e/tasks/index.html', '/%54ASKS/', '/TASKS/',
      ];
      for (const headers of [{}, as('stranger'), basic('tracker', 'tracker-pw')]) {
        for (const p of spellings) {
          const r = await raw(port, 'GET', p, { headers });
          assert.ok([302, 401, 403].includes(r.status), `${p} (${JSON.stringify(headers)}) answered ${r.status}`);
          assert.doesNotMatch(r.text, /Task Tracker|"projects"/, `${p} served the tracker`);
        }
      }
      const page = await raw(port, 'GET', '/tasks/', { headers: as('allowed') });
      assert.equal(page.status, 200);
      assert.match(page.text, /<title>Task Tracker<\/title>/);
      assert.equal((await raw(port, 'GET', '/tasks/api/me', { headers: as('allowed') })).status, 200);
    });
  } finally {
    await new Promise((resolve) => auth.close(resolve));
  }
});

test('the hub is an installable PWA: manifest, icons, service worker, offline page', async () => {
  await withHub(ENV, async (base) => {
    const m = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
    const manifest = await m.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url.split('?')[0], '/');
    for (const icon of manifest.icons) assert.equal((await fetch(base + icon.src)).status, 200, icon.src);
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.status, 200);
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
    const swText = await sw.text();
    // Per-user pages are never cached by the worker.
    for (const p of ['hub', 'api', 'tasks', 'atip', 'ladwani', 'edu', 'admin', 'access', 'auth']) assert.ok(swText.includes(p), p);
    assert.equal((await fetch(`${base}/offline.html`)).status, 200);
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /<link rel="manifest" href="\/manifest.webmanifest">/);
    assert.match(home, /apple-touch-icon/);
  });
});
