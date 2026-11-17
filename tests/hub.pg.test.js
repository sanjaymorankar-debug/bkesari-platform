/**
 * The hub on a real PostgreSQL: home tiles, the bkesari ID sign-in page
 * (D-039), the contact form and its spam protection, the hub's
 * own admin login and editor, the ATIP viewer (owner only), languages, error
 * pages and security headers.
 *
 * Needs TEST_DATABASE_URL (a database it may WIPE); works in a schema of its
 * own there (tests/support/pg.js). Skipped without it.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const createDb = require('../portal/db.js');
const { createApp } = require('../portal/server.js');
const { skip, freshSchema } = require('./support/pg.js');
const { Browser } = require('./support/browser.js');

const quiet = { log() {}, warn() {}, error() {} };
const OWNER = { email: 'agtcipl@gmail.com', password: 'Owner-pass-123' };

describe('the hub on PostgreSQL', { skip }, () => {
  let db, server, base;
  const saved = {};

  before(async () => {
    const { url } = await freshSchema('hub');
    db = await createDb({ env: { DATABASE_URL: url }, quiet: true });
    for (const k of ['APP_ENV', 'HUB_ADMIN_EMAIL', 'HUB_ADMIN_PASSWORD', 'HUB_OWNER_EMAILS', 'EDU_ORIGIN', 'LADWANI_ORIGIN', 'ATIP_USER', 'ATIP_PASSWORD', 'ATIP_PUBLISH_TOKEN', 'HUB_AUTH_SECRET']) saved[k] = process.env[k];
    Object.assign(process.env, {
      APP_ENV: '', EDU_ORIGIN: '', LADWANI_ORIGIN: '', HUB_ADMIN_EMAIL: OWNER.email, HUB_ADMIN_PASSWORD: OWNER.password, HUB_OWNER_EMAILS: OWNER.email,
      ATIP_PUBLISH_TOKEN: 'publish-token', HUB_AUTH_SECRET: 'test-only-hub-secret-0123456789abcdef',
    });
    delete process.env.ATIP_USER; delete process.env.ATIP_PASSWORD;
    const made = createApp(db, { log: quiet, notify: () => ({}) });
    assert.ok(await made.hub.bootstrapAdmin(), 'the first admin is created from the environment');
    assert.equal(await made.hub.bootstrapAdmin(), null, 'and only once');
    server = await new Promise((r) => { const s = made.app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.end();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const html = (b, path, headers = {}) => b.fetch('GET', path, { headers: { accept: 'text/html', ...headers } });
  async function adminSignIn() {
    const b = new Browser(base);
    const s = await b.fetch('GET', '/admin/api/auth/session');
    const r = await b.fetch('POST', '/admin/api/auth/sign-in', { json: { identifier: OWNER.email, password: OWNER.password }, csrf: s.json.csrf });
    assert.equal(r.status, 200, r.text);
    b.csrf = r.json.csrf;
    return b;
  }

  test('the home page is rendered on the server: six tiles with status chips and each project\'s access state (D-039)', async () => {
    const r = await html(new Browser(base), '/');
    assert.equal(r.status, 200);
    const tiles = [...r.text.matchAll(/<h3 class="k-pcard__name">([^<]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(tiles, ['LadWani', 'Education', 'TaskList', 'ATIP', 'Driving Simulator', 'Global Warming']);
    for (const chip of ['Live', 'Beta', 'Coming soon', 'Private']) assert.match(r.text, new RegExp(`class="k-chip[^"]*">${chip}<`));
    assert.match(r.text, /href="\/ATIP\/"[^>]*target="_blank" rel="noopener"/, 'ATIP only links out');
    assert.match(r.text, /href="\/tasklist\/"/);
    // A visitor: the projects that need approval ask them to sign in first (D-039).
    assert.match(r.text, /One bkesari ID/);
    for (const p of ['%2Fladwani%2F', '%2Fedu%2F', '%2Ftasklist%2F']) assert.ok(r.text.includes(`href="/auth/sign-in?next=${p}"`), p);
    assert.match(r.text, /data-access-state="signin"/);
    assert.match(r.text, /<html lang="en"/);
    assert.match(r.text, /\/kesari-ui\/1\.1\.0\/kesari\.css/);
    assert.match(r.text, /<header class="ks-bar/, 'the shell header is in the page, not added by script');
    assert.match(r.text, /href="\/privacy">Privacy</, 'the footer carries the privacy notice');
  });

  test('the hub speaks the visitor\'s language: Marathi and Hindi from the k_lang cookie', async () => {
    const mr = await html(new Browser(base), '/', { cookie: 'k_lang=mr' });
    assert.match(mr.text, /<html lang="mr"/);
    assert.match(mr.text, /आपल्या समाजाच्या प्रकल्पांसाठी एकच ठिकाण/);
    assert.match(mr.text, /गावागावातून आपला वंशवृक्ष/, 'tile text in Marathi from the database');
    const hi = await html(new Browser(base), '/privacy', { cookie: 'k_lang=hi' });
    assert.match(hi.text, /<html lang="hi"/);
    assert.match(hi.text, /निजता सूचना/);
    assert.match(hi.text, /DPDP/);
    const accept = await html(new Browser(base), '/', { 'accept-language': 'hi-IN,hi;q=0.9,en;q=0.5' });
    assert.match(accept.text, /<html lang="en"/, 'English until the visitor picks a language, whatever the browser says (D-030)');
  });

  test('the bkesari ID\'s sign-in page replaces "choose a project"; the access pages need a sign-in (D-039)', async () => {
    const b = new Browser(base);
    const page = await html(b, '/auth/sign-in?next=%2Ftasklist%2F');
    assert.equal(page.status, 200);
    assert.match(page.text, /Sign in to bkesari/);
    assert.match(page.text, /data-next="\/tasklist\/"/);
    assert.match(page.text, /src="\/shared\/signin\.js"/);
    assert.doesNotMatch(page.text, /Continue with Google/, 'no Google button while GOOGLE_CLIENT_ID is unset');
    assert.equal((await html(b, '/auth/sign-in?next=https%3A%2F%2Fevil.example')).text.match(/data-next="([^"]*)"/)[1], '/', 'only a path on this site');
    for (const p of ['/access/request?project=ladwani', '/account', '/admin/access']) assert.match((await html(b, p)).location, /^\/auth\/sign-in\?next=/, p);
    assert.equal((await html(b, '/access')).location, '/account');
    assert.equal((await html(b, '/auth')).location, '/auth/sign-in');
    assert.equal((await b.fetch('GET', '/auth/google/start')).status, 404, 'Google is off without its client');
    const me = (await b.fetch('GET', '/hub/api/me')).json;
    assert.equal(me.user, null);
    assert.deepEqual(me.projects.map((p) => `${p.key}:${p.state}`), ['ladwani:signin', 'edu:signin', 'tasklist:signin', 'driving:open', 'environment:open']);
    assert.equal((await b.fetch('GET', '/.well-known/jwks.json')).status, 410);
    assert.equal((await html(b, '/education/sign-in')).location, '/edu/sign-in');
    assert.equal((await html(b, '/education')).location, '/edu');
  });

  test('request access: step 1 chooses a project (no scripts needed), step 2 says what it asks, then hands over to its own sign-up', async () => {
    const b = new Browser(base);
    const one = await html(b, '/request-access');
    assert.equal(one.status, 200);
    assert.match(one.text, /<form class="hub-req" method="get" action="\/request-access"/);
    for (const key of ['ladwani', 'education', 'tasklist']) assert.match(one.text, new RegExp(`<input type="radio" name="project" value="${key}" required>`));
    assert.doesNotMatch(one.text, /value="atip"/, 'ATIP has no request path');
    assert.match(one.text, /aria-current="step">Choose a project</);
    const none = await html(b, '/request-access?step=2');
    assert.equal(none.status, 400, 'continuing without a project says so');
    assert.match(none.text, /role="alert">Choose a project to continue\./);
    const lw = await html(b, '/request-access?project=ladwani&step=2');
    assert.equal(lw.status, 200);
    assert.match(lw.text, /Joining LadWani: what happens next/);
    assert.match(lw.text, /An operator verifies you/, 'LadWani keeps its operator verification');
    assert.match(lw.text, /href="\/ladwani\/sign-up\/">Continue to LadWani/);
    assert.match((await html(b, '/request-access?project=tasklist')).text, /No approval needed/);
    assert.match((await html(b, '/request-access?project=atip')).text, /Request access to a project/, 'an unknown project is step 1 again');
  });

  test('My projects asks each project itself, from the browser; the hub sends no one\'s details', async () => {
    const r = await html(new Browser(base), '/account');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    for (const me of ['/ladwani/api/v1/auth/session', '/edu/shell/me', '/tasklist/api/auth/me']) assert.ok(r.text.includes(`data-me="${me}"`), me);
    assert.match(r.text, /<script src="\/shared\/account\.js" defer><\/script>/);
    assert.match(r.text, /data-words="\{&quot;checking&quot;/, 'its words travel as data, not an inline script');
    assert.doesNotMatch(r.text, /data-project="atip"/, 'ATIP\'s row is only for the owner');
    assert.match(r.text, /<noscript>/);
  });

  test('read in another language without scripts: /lang/xx sets k_lang and goes back to a path on this site only', async () => {
    const b = new Browser(base);
    const r = await html(b, '/lang/mr?next=/about');
    assert.equal(r.status, 303);
    assert.equal(r.location, '/about');
    assert.match(r.headers.get('set-cookie'), /k_lang=mr; Path=\/; Max-Age=31536000; SameSite=Lax/);
    for (const next of ['//evil.example/', 'https://evil.example/', '/\\evil.example']) assert.equal((await html(b, `/lang/hi?next=${encodeURIComponent(next)}`)).location, '/', next);
    assert.match((await html(b, '/lang/xx')).headers.get('set-cookie'), /k_lang=en;/);
    assert.match((await html(new Browser(base), '/')).text, /<a href="\/lang\/mr\?next=%2F" lang="mr" hreflang="mr" data-k-setlang="mr">मराठी<\/a>/);
  });

  test('robots.txt closes dev and test; the sitemap lists the public pages', async () => {
    const r = await html(new Browser(base), '/robots.txt');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/plain/);
    assert.equal(r.text, 'User-agent: *\nDisallow: /\n', 'this suite runs as a non-production tier');
    const map = await html(new Browser(base), '/sitemap.xml');
    assert.match(map.headers.get('content-type'), /application\/xml/);
    for (const p of ['/', '/driving-simulator/', '/environment/', '/ladwani/', '/edu/']) assert.match(map.text, new RegExp(`<loc>https://[^<]+${p.replace(/\//g, '\\/')}</loc>`));
    assert.doesNotMatch(map.text, /admin|account|ATIP/i);
  });

  test('the contact form takes its topic from the page that sends people there', async () => {
    const r = await html(new Browser(base), '/contact?topic=driving');
    assert.match(r.text, /<option value="driving" selected>Driving Simulator<\/option>/);
    const topicSelect = (text) => text.match(/<select class="k-select" id="topic"[\s\S]*?<\/select>/)[0];
    assert.doesNotMatch(topicSelect((await html(new Browser(base), '/contact?topic=<x>')).text), /selected/, 'an unknown topic chooses nothing');
  });

  test('the contact form stores a real message, and keeps out forged, robotic and repeated ones', async () => {
    const b = new Browser(base);
    const page = await html(b, '/contact');
    assert.equal(page.status, 200);
    const csrf = page.text.match(/name="csrf" value="([^"]+)"/)[1];
    const stamp = page.text.match(/name="stamp" value="([^"]+)"/)[1];
    assert.equal(b.get('hub_csrf').path, '/contact');
    const form = (fields) => new URLSearchParams({ csrf, stamp, name: 'Ramesh Patil', email: '', mobile: '98765 43210', topic: 'ladwani', message: 'How do I add my grandson to the tree?', consent: 'yes', website: '', ...fields }).toString();
    const post = (fields, extra = {}) => b.fetch('POST', '/contact', { body: form(fields), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', ...extra } });
    const count = async () => (await db.get('SELECT COUNT(*) AS n FROM hub_contact_messages')).n;

    const fast = await post({});
    assert.equal(fast.status, 303, 'filled in under 3 seconds: answered as sent...');
    assert.equal(await count(), 0, '...and nothing stored');
    await new Promise((r) => setTimeout(r, 3100));
    assert.equal((await post({ website: 'http://spam.example' })).status, 303);
    assert.equal(await count(), 0, 'the hidden field filled: nothing stored');
    assert.equal((await post({ csrf: 'forged-token-forged-token' })).status, 403);
    assert.equal((await post({}, { origin: 'https://evil.example' })).status, 403);
    const invalid = await post({ message: 'hi', mobile: '123', consent: '' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.text, /aria-invalid="true"/);
    assert.match(invalid.text, /Write a message of at least 10 characters/);
    assert.equal(await count(), 0);
    const ok = await post({});
    assert.equal(ok.status, 303);
    assert.equal(ok.location, '/contact?sent=1');
    const row = await db.get('SELECT name, mobile, email, topic, status, lang FROM hub_contact_messages');
    assert.deepEqual({ ...row }, { name: 'Ramesh Patil', mobile: '9876543210', email: null, topic: 'ladwani', status: 'new', lang: 'en' });
    for (let i = 0; i < 4; i++) await post({});
    const limited = await post({});
    assert.equal(limited.status, 429, 'five messages an hour from one address');
    assert.match(limited.text, /try again in an hour/);
  });

  test('the hub admin has its own login: no sign-up, lockout, and it edits tiles and the banner', async () => {
    const anon = new Browser(base);
    const signInPage = await html(anon, '/admin');
    assert.equal(signInPage.status, 200);
    assert.match(signInPage.text, /data-admin-signin/);
    assert.equal((await anon.fetch('GET', '/admin/api/state')).status, 401);
    const s = await anon.fetch('GET', '/admin/api/auth/session');
    assert.equal(s.json.allowSignUp, false);
    assert.equal((await anon.fetch('POST', '/admin/api/auth/sign-up', { json: { name: 'x', email: 'x@example.com', password: 'whatever-123' }, csrf: s.json.csrf })).status, 403);
    assert.equal((await anon.fetch('POST', '/admin/api/auth/otp/send', { json: { mobile: '9876543210' }, csrf: s.json.csrf })).status, 404, 'no OTP sign-in for the admin');

    const admin = await adminSignIn();
    const sid = admin.get('hub_admin_sid');
    assert.equal(sid.path, '/');
    assert.equal(sid.httpOnly, true);
    assert.equal(admin.get('k_admin').value, '1', 'the shell\'s hint that the owner may see ATIP');
    assert.equal(admin.get('k_admin').httpOnly, false);
    const state = await admin.fetch('GET', '/admin/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.json.tiles.length, 6);
    assert.ok(state.json.messages.length >= 1, 'the contact inbox');

    const tiles = state.json.tiles.map((x) => (x.key === 'driving' ? { ...x, status: 'beta', benefit_en: 'Book a practice session.', sort_order: 5 } : x));
    assert.equal((await admin.fetch('PUT', '/admin/api/tiles', { json: { tiles } })).status, 403, 'a write needs the CSRF token');
    assert.equal((await admin.fetch('PUT', '/admin/api/tiles', { json: { tiles: [{ ...tiles[0], href: 'javascript:alert(1)' }] }, csrf: admin.csrf })).status, 400);
    assert.equal((await admin.fetch('PUT', '/admin/api/tiles', { json: { tiles }, csrf: admin.csrf })).status, 200);
    const banner = await admin.fetch('PUT', '/admin/api/announcement', { json: { message_en: 'TaskList is open for everyone.', message_mr: 'टास्कलिस्ट सर्वांसाठी खुली.', kind: 'success', active: true, link: '/tasklist/' }, csrf: admin.csrf });
    assert.equal(banner.status, 200, banner.text);
    const home = await html(new Browser(base), '/');
    const names = [...home.text.matchAll(/<h3 class="k-pcard__name">([^<]+)/g)].map((m) => m[1].trim());
    assert.equal(names[0], 'Driving Simulator', 'the new order shows straight away');
    assert.match(home.text, /Book a practice session\./);
    assert.match(home.text, /TaskList is open for everyone\./);
    assert.match((await html(new Browser(base), '/', { cookie: 'k_lang=mr' })).text, /टास्कलिस्ट सर्वांसाठी खुली\./);
    const audit = await db.get("SELECT COUNT(*) AS n FROM hub_admin_audit_log WHERE action IN ('tiles-saved','announcement-saved')");
    assert.equal(audit.n, 2);

    const other = new Browser(base);
    const s2 = await other.fetch('GET', '/admin/api/auth/session');
    for (let i = 0; i < 5; i++) await other.fetch('POST', '/admin/api/auth/sign-in', { json: { identifier: OWNER.email, password: 'nope-nope-1' }, csrf: s2.json.csrf });
    const locked = await other.fetch('POST', '/admin/api/auth/sign-in', { json: { identifier: OWNER.email, password: OWNER.password }, csrf: s2.json.csrf });
    assert.equal(locked.status, 423, 'five wrong passwords lock the admin too');
    await db.run("UPDATE hub_admin_users SET locked_until = NULL, failed_attempts = 0");
  });

  test('ATIP is the owner\'s alone: a plain 404 for everyone else, the snapshot for the owner', async () => {
    const page = (n) => `<html><head><title>t</title></head><body><div class="acts"><button>Confirm order</button></div><p>snapshot ${n}</p></body></html>`;
    const anon = new Browser(base);
    assert.equal((await anon.fetch('POST', '/ATIP/api/snapshot', { json: { html: page(1) }, headers: { authorization: 'Bearer nope' } })).status, 401);
    for (const n of [1, 2]) {
      const r = await anon.fetch('POST', '/atip/api/snapshot', { json: { html: page(n), trade_date: '2026-11-03', generated_at: '2026-11-03T15:30:00' }, headers: { authorization: 'Bearer publish-token' } });
      assert.equal(r.status, 200, r.text);
    }
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM atip_snapshots')).n, 1, 'only the newest is kept');
    assert.equal((await html(anon, '/ATIP/')).status, 404);
    assert.equal((await html(anon, '/ATIP')).status, 404, 'even the slash redirect gives nothing away');
    const admin = await adminSignIn();
    const shown = await html(admin, '/ATIP/');
    assert.equal(shown.status, 200);
    assert.match(shown.text, /snapshot 2/);
    assert.match(shown.text, /trade date 2026-11-03/);
    assert.match(shown.headers.get('content-security-policy'), /connect-src 'none'/, 'ATIP keeps its own policy');
    assert.match(shown.text, /<style id="bk-readonly">[^<]*\.acts/);
    assert.ok(shown.text.indexOf('id="bk-readonly"') < shown.text.indexOf('class="acts"'));
    // Without </head> the controls are still hidden.
    await anon.fetch('POST', '/ATIP/api/snapshot', { json: { html: '<html><body><div class="acts">x</div></body></html>' }, headers: { authorization: 'Bearer publish-token' } });
    const noHead = (await html(admin, '/ATIP/')).text;
    assert.ok(noHead.indexOf('id="bk-readonly"') < noHead.indexOf('class="acts"'));
    // An editor (not the owner) is no one at ATIP.
    await db.run("INSERT INTO hub_admin_users (email, name, password_hash, role) SELECT 'editor@example.com', 'Ed', password_hash, 'editor' FROM hub_admin_users WHERE role = 'owner'");
    const ed = new Browser(base);
    const s = await ed.fetch('GET', '/admin/api/auth/session');
    await ed.fetch('POST', '/admin/api/auth/sign-in', { json: { identifier: 'editor@example.com', password: OWNER.password }, csrf: s.json.csrf });
    assert.equal(ed.get('k_admin').value, '0');
    assert.equal((await html(ed, '/ATIP/')).status, 404);
  });

  test('error pages, the style guide and security headers', async () => {
    const b = new Browser(base);
    const nf = await html(b, '/no-such-page');
    assert.equal(nf.status, 404);
    assert.match(nf.text, /We could not find that page/);
    assert.match(nf.text, /<header class="ks-bar/);
    assert.equal((await b.fetch('GET', '/no/api/thing')).json.error, 'Not found');
    const home = await html(b, '/');
    const csp = home.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/, 'no inline scripts on the hub');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.match(home.headers.get('referrer-policy'), /strict-origin/);
    assert.equal(home.headers.get('strict-transport-security'), null, 'HSTS only over https');
    const https = await html(b, '/', { 'x-forwarded-proto': 'https' });
    assert.equal(https.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.match((await html(b, '/kesari-ui/1.1.0/kesari.css')).headers.get('cache-control'), /immutable/);
    // 127.0.0.1 is the dev tier: the style guide is there, and not on production.
    assert.equal((await html(b, '/styleguide/')).status, 200);
    process.env.APP_ENV = 'prod';
    try {
      assert.equal((await html(b, '/styleguide/')).status, 404);
    } finally { process.env.APP_ENV = ''; }
    assert.equal((await html(b, '/global-warming/x?y=1')).location, '/environment/x?y=1');
  });
});
