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
const noDb = new Proxy({}, { get: (_, k) => () => { throw new Error(`unexpected db.${String(k)}()`); } });

const ENV = {
  TRACKER_USER: 'tracker', TRACKER_PASSWORD: 'tracker-pw',
  ATIP_USER: 'viewer', ATIP_PASSWORD: 'viewer-pw', ATIP_PUBLISH_TOKEN: 'token',
  MILK_ORIGIN: '', EDU_ORIGIN: '', LADWANI_ORIGIN: '', APP_ENV: 'dev',
};

/** Runs `fn(base)` against createApp with `env` applied to process.env, then puts it back. */
async function withHub(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  const { app } = createApp(noDb);
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
    await withHub({ ...ENV, MILK_ORIGIN: origin }, async (base) => {
      const payload = JSON.stringify({ order: 'ghee', qty: 3 });
      const res = await fetch(`${base}/milk/api/orders`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: AbortSignal.timeout(5000),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { url: '/milk/api/orders', body: payload });
    });
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});
