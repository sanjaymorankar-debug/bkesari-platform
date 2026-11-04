// Browser smoke test for the Education app through the hub under /edu/
// (TEST_SPEC.md, levels S5 and S7; root TESTING.md section 4.2):
//
//   HUB=http://127.0.0.1:3105 KILL_URL="$DB_URL_UNPOOLED" node tests/smoke/browser.cjs
//
// Needs Playwright with Chromium (`npm i --no-save playwright && npx playwright
// install chromium` in any scratch folder, then NODE_PATH pointing at it), the
// app running with APP_URL=$HUB/edu on a database seeded by `php artisan
// db:seed`, and the hub running with EDU_ORIGIN set to the app.
//
// It signs in as demo accounts (edu/TEST_ACCOUNTS.md) and WRITES: one
// complaint with an evidence file (uploaded through Livewire's signed upload
// URL, then downloaded again) and one erasure request, which it then carries
// out. Run it only against a scratch database. The uploaded file lands in the
// app's storage/app/private (gitignored); TEST_SPEC.md S5 clears it afterwards.
//
// KILL_URL, when set, is a direct connection string for the app's database
// (any role that may signal the app's backends; the app's own role can). The
// script then terminates every server connection of that role on that
// database, as Neon does when it suspends an idle compute, and checks that the
// next request still works. Unset, that check is reported as SKIP.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HUB = process.env.HUB || 'http://127.0.0.1:3105';
const EDU = `${HUB}/edu`;
const PASSWORD = process.env.DEMO_PASSWORD || 'Password123!';
const KILL_URL = process.env.KILL_URL || '';
let pass = 0, fail = 0;
const ok = m => { pass++; console.log(`PASS ${m}`); };
const bad = m => { fail++; console.log(`FAIL ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// URLs on the current page that point at the hub's origin but outside /edu.
// The bkesari shell (header and footer, drawn by the hub's /shared/menu.js)
// links to the hub and the other projects on purpose, and the Kesari design
// system and the shell script are the hub's own files: those are not ours.
async function urlsEscapingPrefix(page) {
  return page.evaluate(hub => {
    const out = [];
    const attrs = [['a', 'href'], ['link', 'href'], ['script', 'src'], ['img', 'src'], ['form', 'action'], ['[data-update-uri]', 'data-update-uri']];
    for (const [sel, attr] of attrs) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('.ks-bar, .ks-foot')) continue;
        const raw = el.getAttribute(attr);
        if (!raw || /^(#|mailto:|tel:|javascript:)/.test(raw)) continue;
        const abs = new URL(raw, location.href);
        if (abs.origin !== new URL(hub).origin) continue; // not ours to prefix
        if (/^\/(kesari-ui|shared)\//.test(abs.pathname)) continue; // the hub's shared files
        if (!(abs.pathname === '/edu' || abs.pathname.startsWith('/edu/'))) out.push(`${sel}[${attr}]=${raw}`);
      }
    }
    return out;
  }, HUB);
}

// Education's own sign-in, by email and password (a code by email is the
// first tab wherever mail can be delivered, and a code by text message where
// SMS is set up).
async function signIn(page, email) {
  const passwordTab = page.locator('#tab-password');
  if (await passwordTab.count() && (await passwordTab.getAttribute('aria-selected')) !== 'true') {
    await passwordTab.click();
    await page.waitForSelector('#password');
  }
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL(u => !/\/(login|sign-in)$/.test(u.pathname), { timeout: 30000 }),
    page.click('#email-sign-in button[type=submit]'),
  ]);
}

// Signing out through the bkesari shell's account menu: it posts to
// Education's /edu/logout (JSON, X-CSRF-Token from /edu/shell/me) and then
// goes to Education's sign-in page.
async function signOut(page) {
  await page.locator('.ks-account summary').click();
  const before = page.url();
  await Promise.all([
    page.waitForURL(u => u.href !== before, { timeout: 30000 }),
    page.locator('[data-ks-signout]').click(),
  ]);
}

function killAppConnections() {
  const sql = 'SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity '
    + 'WHERE usename = current_user AND datname = current_database() AND pid <> pg_backend_pid()';
  return execFileSync('psql', [KILL_URL, '-Atc', sql]).toString().trim();
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const broken = [];
  // /edu/shell/me answers a guest with 401 by design (it tells the shell where to sign in).
  page.on('response', r => {
    if (r.status() === 401 && new URL(r.url()).pathname === '/edu/shell/me') return;
    if (r.status() >= 400 && r.url().startsWith(HUB)) broken.push(`${r.status()} ${r.url()}`);
  });
  // Our own origin only: a third-party font that cannot be reached is not a fault here.
  page.on('requestfailed', r => { if (r.url().startsWith(HUB)) broken.push(`failed ${r.url()}`); });
  page.on('pageerror', e => broken.push(`script error: ${e.message}`));

  try {
    // 1. A protected page while signed out, and back to it after signing in.
    await page.goto(`${EDU}/admin/rating-weights`);
    check(page.url() === `${EDU}/login`, `signed out, /edu/admin/rating-weights sends you to ${page.url()}`);
    check((await urlsEscapingPrefix(page)).length === 0, 'every URL on the sign-in page carries /edu');
    check(await page.locator('script[src*="/edu/livewire/livewire"]').count() === 1, "Livewire's script is requested under /edu");
    await signIn(page, 'admin@test.agtci.com');
    check(page.url() === `${EDU}/admin/rating-weights`, `after signing in you land on ${page.url()}`);
    const escaping = await urlsEscapingPrefix(page);
    check(escaping.length === 0, `every URL on a signed-in page carries /edu${escaping.length ? ': ' + escaping.join(', ') : ''}`);
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    check(/Mukta/.test(font), `the app's stylesheet applies (body font ${font.split(',')[0]})`);
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--k-accent').trim());
    check(/^#0f766e$/i.test(accent), `Kesari loads with the Education accent (--k-accent ${accent || 'unset'})`);
    await page.waitForSelector('.ks-account summary', { timeout: 30000 });
    check(/Admin/i.test(await page.locator('.ks-account').innerText()), 'the shell shows the Education account from /edu/shell/me');

    // 2. Signing out stays inside the tab, and ends the Education session.
    await signOut(page);
    const out = new URL(page.url());
    check(out.pathname === '/edu/sign-in', `signing out lands on ${page.url()}`);
    const after = await page.request.get(`${EDU}/shell/me`, { headers: { Accept: 'application/json' } });
    check(after.status() === 401, `and /edu/shell/me then answers ${after.status()}`);

    // 3. A write: a complaint, numbered by Complaint::createNumbered() inside a
    //    savepoint, which is exactly what a pooler used to break, with an
    //    evidence file. Livewire uploads it to a signed URL, which under /edu
    //    used to be a 404 (prefixed twice) and then a signature mismatch.
    await page.goto(`${EDU}/login`);
    await signIn(page, 'parent@test.agtci.com');
    await page.goto(`${EDU}/complaints/create`);
    await page.selectOption('#schoolId', '1');
    await page.selectOption('#complaintCategoryId', await page.locator('#complaintCategoryId option').nth(1).getAttribute('value'));
    await page.fill('#subject', 'Smoke test: broken water tap');
    await page.fill('#description', 'The drinking water tap near the primary block has been broken for three weeks.');
    await page.locator('#description').blur();
    await page.selectOption('#severity', 'medium');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-smoke-'));
    const evidence = path.join(scratch, 'tap.png');
    fs.writeFileSync(evidence, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4DwABAQEABRjYTgAAAABJRU5ErkJggg==', 'base64'));
    const uploaded = page.waitForResponse(r => r.url().includes('/livewire/upload-file'), { timeout: 30000 });
    await page.setInputFiles('#evidenceFile', evidence);
    const upload = await uploaded;
    check(upload.status() === 200 && new URL(upload.url()).pathname === '/edu/livewire/upload-file', `evidence uploaded: ${upload.status()} ${new URL(upload.url()).pathname}`);
    await page.waitForLoadState('networkidle');
    await Promise.all([
      page.waitForURL(/\/edu\/complaints\/\d+$/, { timeout: 30000 }),
      page.click('button:has-text("Submit Complaint")'),
    ]);
    const heading = (await page.locator('h2:has-text("Complaint EDU-")').first().innerText()).trim();
    check(/EDU-[A-Z]+-[A-Z]+-\d{4}-\d{6}/.test(heading), `complaint filed: ${heading}`);
    await page.reload();
    check(await page.locator(`h2:has-text("${heading}")`).count() === 1, 'the complaint is still there after a reload');
    const link = page.locator('a[href*="/evidence/"]').first();
    const href = await link.getAttribute('href');
    check(href !== null && new URL(href, page.url()).pathname.startsWith('/edu/complaints/'), `the evidence link carries /edu: ${href}`);
    const download = await page.request.get(new URL(href, page.url()).href);
    check(download.status() === 200 && /tap\.png/.test(download.headers()['content-disposition'] || ''), `the evidence downloads: ${download.status()} ${download.headers()['content-disposition'] || ''}`);
    fs.rmSync(scratch, { recursive: true, force: true });

    // 4. A DPDP erasure, carried out by the DPO: the app's multi-statement DB::transaction().
    await page.goto(`${EDU}/privacy/requests`);
    await page.selectOption('#requestType', 'erasure');
    await page.locator('label:has-text("Growth and capability observations") input[type=checkbox]').check();
    await page.click('button:has-text("Send request")');
    await page.waitForSelector('[role="status"]', { timeout: 30000 });
    ok('erasure request sent');
    await signOut(page);
    await page.goto(`${EDU}/login`);
    await signIn(page, 'dpo@test.agtci.com');
    await page.goto(`${EDU}/privacy/queue`);
    await page.locator('button:has-text("Carry out erasure")').first().click();
    await page.fill('#note', 'Smoke test: erased as requested.');
    await page.click('button:has-text("Confirm")');
    await page.waitForSelector('[role="status"]', { timeout: 30000 });
    const flash = (await page.locator('[role="status"]').first().innerText()).trim();
    check(/has been dealt with/.test(flash), `erasure carried out: ${flash.slice(0, 90)}`);

    // 5. Neon drops an idle compute's connections. Do the same, then ask again.
    if (KILL_URL) {
      await page.waitForTimeout(3000);
      ok(`terminated ${killAppConnections()} server connection(s) of the app's role`);
      const response = await page.goto(`${EDU}/privacy/queue`);
      check(response.status() === 200 && page.url() === `${EDU}/privacy/queue`, 'the next request succeeds, still signed in');
      check(await page.locator('button:has-text("Carry out erasure"), [role="status"], h2').count() > 0, 'and renders the page');
    } else {
      console.log('SKIP dropped connections: KILL_URL is not set');
    }

    await signOut(page);
  } catch (e) {
    bad(`browser flow stopped: ${e.message.split('\n')[0]}`);
  }

  check(broken.length === 0, `no failed requests or script errors${broken.length ? ': ' + broken.slice(0, 5).join(' | ') : ''}`);
  await browser.close();
  console.log(`browser smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
