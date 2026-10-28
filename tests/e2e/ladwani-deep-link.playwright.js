/**
 * Browser check (Playwright) for LadWani deep links behind the hub.
 *
 * Bug it guards: opening /ladwani/dashboard/ (or any non-root LadWani page)
 * straight in a fresh browser showed an "Unauthorized" error banner, because
 * the page's own useEffect fetched before the hub sign-in (POST
 * /ladwani/api/v1/auth/hub) had finished. api-client.ts now shares one hub
 * sign-in promise (signInViaHub) that token-less requests wait on.
 *
 * What it does: starts tests/support/signed-in-hub.js with LadWani embedded
 * (the real API, the built export) on scratch databases, then for each deep
 * page opens a FRESH browser context (empty localStorage, no cookies) and
 * asserts: no .error-banner, no "Unauthorized" text, the page's data rendered
 * (its empty-state text, which only shows after the fetch succeeded), and no
 * 401 on a data request. A last case makes the hub sign-in fail (no hub
 * access) and records what a genuine 401 does.
 *
 * Not part of `npm test` (that globs tests/*.test.js only) and not in CI:
 * the repo has no Playwright dependency. Run it by hand, see TEST_SPEC.md S5.
 *
 *   # needs: LadWani built (TEST_SPEC.md #9a), scratch databases (2.2/2.5),
 *   # Playwright (npm i playwright in any folder; PLAYWRIGHT_DIR points at its
 *   # node_modules parent) and Google Chrome (or PLAYWRIGHT_CHANNEL=chromium
 *   # after `npx playwright install chromium`).
 *   export SMOKE_DATABASE_URL=...  LADWANI_SMOKE_DATABASE_URL=...   # local scratch only
 *   PLAYWRIGHT_DIR=/path/to/dir node tests/e2e/ladwani-deep-link.playwright.js
 *
 * Environment:
 *   BASE                  use a hub that is already running (skips starting one)
 *   PORT                  port for the hub it starts (default 3101)
 *   EXPECT_BANNER=1       invert the deep-link assertions: pass only if the
 *                         banner DOES show. Used to prove, against the old
 *                         api-client.ts, that this test detects the bug.
 *   PLAYWRIGHT_CHANNEL    browser channel (default "chrome")
 *
 * Exit code 0 = every assertion held.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..', '..');
const expectBanner = process.env.EXPECT_BANNER === '1';
const port = Number(process.env.PORT || 3101);
const BASE = process.env.BASE || `http://127.0.0.1:${port}`;

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, root].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(path.join(d, 'x.js'))('playwright'); } catch { /* try the next */ }
  }
  throw new Error('playwright is not installed: npm i playwright somewhere and set PLAYWRIGHT_DIR to that folder');
}

// Scratch databases only: local host, and "smoke" in the database name.
function scratchUrl(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (a local scratch database, TEST_SPEC.md 2.2)`);
  const u = new URL(v);
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname) || !/smoke/.test(u.pathname)) {
    throw new Error(`${name} is not a local scratch smoke database; refusing to use it`);
  }
  return v;
}

async function startHub() {
  const env = { ...process.env, PORT: String(port), APP_ENV: 'dev', SIGNED_IN_HUB_LADWANI: 'embedded',
    DATABASE_URL: scratchUrl('SMOKE_DATABASE_URL'), LADWANI_DATABASE_URL: scratchUrl('LADWANI_SMOKE_DATABASE_URL') };
  for (const k of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL', 'DATABASE_URL_UNPOOLED']) delete env[k];
  const child = spawn(process.execPath, [path.join(root, 'tests/support/signed-in-hub.js')], { cwd: root, env });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`hub exited early:\n${log}`);
    if (/LadWani API: ready/.test(log) && /running at/.test(log)) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`hub did not start:\n${log}`);
}

// Each page fetches its data in its own useEffect; "ready" is the text it shows
// only once that fetch succeeded (an empty list on a fresh scratch database).
const PAGES = [
  { path: '/ladwani/dashboard/', api: '/families/mine', ready: "You're not linked to a family yet" },
  { path: '/ladwani/notifications/', api: '/notifications', ready: 'No notifications yet.' },
  { path: '/ladwani/community/', api: '/posts', ready: 'No posts yet' },
];

async function openFresh(browser, hubAuth) {
  const context = await browser.newContext(); // new context = empty localStorage, no cookies
  const page = await context.newPage();
  const seen = [];
  page.on('response', (res) => {
    const u = new URL(res.url());
    if (u.pathname.startsWith('/ladwani/api/v1/')) {
      seen.push({ method: res.request().method(), path: u.pathname.replace('/ladwani/api/v1', ''), status: res.status() });
    }
  });
  if (hubAuth === 'denied') {
    // The hub refuses: what a visitor with no hub access gets from POST /auth/hub.
    await page.route('**/ladwani/api/v1/auth/hub', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Unauthorized","statusCode":401}' }));
  }
  return { context, page, seen };
}

async function main() {
  const { chromium } = loadPlaywright();
  const hub = process.env.BASE ? null : await startHub();
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const results = [];
  try {
    for (const p of PAGES) {
      const { context, page, seen } = await openFresh(browser);
      const stored = await page.goto(`${BASE}${p.path}`).then(() => page.evaluate(() => window.localStorage.length));
      void stored;
      const banner = page.locator('.error-banner');
      const dataShown = page.getByText(p.ready, { exact: false });
      // Wait until either the data or a banner shows, then give late errors a moment.
      await Promise.race([
        dataShown.first().waitFor({ timeout: 15000 }).catch(() => {}),
        banner.first().waitFor({ timeout: 15000 }).catch(() => {}),
      ]);
      await page.waitForTimeout(500);
      const bannerText = (await banner.count()) ? await banner.first().innerText() : null;
      const unauthorizedText = await page.getByText('Unauthorized').count();
      const dataOk = (await dataShown.count()) > 0;
      const apiCall = seen.filter((s) => s.path === p.api);
      results.push({ page: p.path, bannerText, unauthorizedText, dataOk, requests: seen.map((s) => `${s.method} ${s.path} ${s.status}`) });
      if (expectBanner) {
        assert.ok(bannerText || unauthorizedText, `${p.path}: expected the Unauthorized banner (old api-client), saw none`);
      } else {
        assert.equal(bannerText, null, `${p.path}: error banner shown: ${bannerText}`);
        assert.equal(unauthorizedText, 0, `${p.path}: "Unauthorized" text on the page`);
        assert.ok(dataOk, `${p.path}: data did not render (looked for "${p.ready}")`);
        assert.ok(apiCall.length >= 1 && apiCall.every((s) => s.status === 200), `${p.path}: ${p.api} was not answered 200: ${JSON.stringify(apiCall)}`);
        assert.equal(seen.filter((s) => s.status === 401).length, 0, `${p.path}: a request got 401: ${JSON.stringify(seen)}`);
        assert.equal(seen.filter((s) => s.path === '/auth/hub').length, 1, `${p.path}: hub sign-in should run exactly once`);
      }
      await context.close();
    }

    // No hub access: the hub sign-in is refused. A genuine 401 must stay a 401:
    // no session, no data, and no retry loop. Recorded, with bounded request counts asserted.
    const { context, page, seen } = await openFresh(browser, 'denied');
    await page.goto(`${BASE}/ladwani/dashboard/`);
    await page.waitForTimeout(3000);
    const denied = {
      url: new URL(page.url()).pathname,
      banner: (await page.locator('.error-banner').count()) ? await page.locator('.error-banner').first().innerText() : null,
      requests: seen.map((s) => `${s.method} ${s.path} ${s.status}`),
    };
    results.push({ page: 'no hub access: /ladwani/dashboard/', ...denied });
    if (!expectBanner) {
      assert.ok(denied.requests.includes('GET /families/mine 401'), 'without hub access the data call must still answer 401');
      assert.ok(seen.filter((s) => s.path === '/families/mine').length <= 2, 'a 401 must not be retried in a loop');
      assert.ok(seen.filter((s) => s.path === '/auth/hub').length <= 1, 'hub sign-in must be attempted once per page load (denied replies are routed in the browser, so none reaches the server)');
    }
    await context.close();
  } finally {
    await browser.close();
    if (hub) hub.kill();
    console.log(JSON.stringify(results, null, 2));
  }
  console.log(expectBanner ? 'OK: the banner reproduces (this build lacks the fix)' : 'OK: deep links load without the Unauthorized banner');
}

main().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
