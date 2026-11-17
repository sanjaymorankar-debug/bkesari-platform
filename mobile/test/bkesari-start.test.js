/**
 * The bkesari app's start screen (bkesari/www/js/start.js), run in a sandbox
 * with stand-ins for the page, @capacitor/app and @capacitor/browser: launch,
 * Continue with Google, the link back from the browser, /mobile-auth/finish,
 * the back button, the hub's ?google=1 and the error paths.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

const www = path.join(__dirname, '..', 'bkesari', 'www');
const START_JS = fs.readFileSync(path.join(www, 'js', 'start.js'), 'utf8');
const Auth = require('../bkesari/www/js/auth-core.js');
const config = require('../bkesari/www/config.js');

const SITE = config.site;

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
}

function element(extra = {}) {
  const listeners = {};
  return Object.assign(
    {
      textContent: '',
      className: '',
      hidden: false,
      disabled: false,
      href: '',
      attributes: {},
      listeners,
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      click() {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const fn of listeners.click || []) fn(event);
        return event;
      },
    },
    extra,
  );
}

/** One run of the start screen. `local` and `session` carry over between runs, like the WebView's storage. */
async function launch({
  local = memoryStorage(),
  session = memoryStorage(),
  search = '',
  launchUrl = null,
  native = true,
} = {}) {
  const calls = { open: [], close: 0, assign: [], replace: [], replaceState: [] };
  const appListeners = {};
  const browserListeners = {};
  const routeLinks = ['/', '/access/request', '/account'].map((p) => element({ attributes: { 'data-path': p } }));
  const elements = {
    google: element(),
    email: element(),
    status: element(),
    version: element(),
    routes: element({ hidden: true, querySelectorAll: () => routeLinks }),
  };
  const bodyClasses = new Set(['is-starting']);
  const windowListeners = {};

  const sandbox = {
    BKESARI_APP: { ...config },
    BkesariAuth: Auth,
    capacitorExports: { Capacitor: { isNativePlatform: () => native } },
    capacitorApp: {
      App: {
        addListener(name, fn) { (appListeners[name] ||= []).push(fn); return Promise.resolve({ remove() {} }); },
        getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : undefined),
      },
    },
    capacitorBrowser: {
      Browser: {
        open: async (options) => { calls.open.push(options); },
        close: async () => { calls.close += 1; },
        addListener(name, fn) { (browserListeners[name] ||= []).push(fn); return Promise.resolve({ remove() {} }); },
      },
    },
    crypto: webcrypto,
    localStorage: local,
    sessionStorage: session,
    location: {
      search,
      pathname: '/',
      assign: (url) => calls.assign.push(url),
      replace: (url) => calls.replace.push(url),
    },
    history: { replaceState: (...args) => calls.replaceState.push(args) },
    document: {
      getElementById: (id) => elements[id],
      body: { classList: { remove: (c) => bodyClasses.delete(c), contains: (c) => bodyClasses.has(c) } },
    },
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    URLSearchParams,
    Promise,
    Date,
    Object,
    Array,
    Boolean,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(START_JS, sandbox, { filename: 'start.js' });
  await waitFor(
    () => calls.assign.length + calls.replace.length > 0 || (!bodyClasses.has('is-starting') && elements.status.textContent !== 'Opening Google…'),
    'the start screen',
  );

  return {
    calls,
    elements,
    routeLinks,
    local,
    session,
    shown: () => !bodyClasses.has('is-starting'),
    appUrlOpen: async (url) => { for (const fn of appListeners.appUrlOpen || []) fn({ url }); await settle(); },
    browserFinished: async () => { for (const fn of browserListeners.browserFinished || []) fn(); await settle(); },
    pageshow: async (persisted) => { for (const fn of windowListeners.pageshow || []) fn({ persisted }); await settle(); },
    clickGoogle: async () => {
      elements.google.click();
      await waitFor(() => elements.status.textContent !== 'Opening Google…' || calls.assign.length > 0, 'the browser to open');
    },
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Waits for the screen's async work (SubtleCrypto runs on Node's thread pool, so ticks are not enough). */
async function waitFor(condition, what) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await settle();
}

function challengeOf(openCall) {
  return new URL(openCall.url).searchParams.get('challenge');
}

test('first launch shows the start screen and goes nowhere by itself', async () => {
  const app = await launch();
  assert.equal(app.shown(), true);
  assert.equal(app.elements.routes.hidden, true, 'the project links appear once the person has been to the hub');
  assert.deepEqual([app.calls.assign, app.calls.replace, app.calls.open], [[], [], []]);
  assert.equal(app.elements.version.textContent, `Version ${config.version}`);
  assert.equal(app.elements.email.href, `${SITE}/auth/sign-in?next=%2F`);
  assert.deepEqual(app.routeLinks.map((a) => a.href), [`${SITE}/`, `${SITE}/access/request`, `${SITE}/account`]);
});

test('Continue with Google: system browser, link back, finish in the WebView', async () => {
  const app = await launch();
  await app.clickGoogle();

  assert.equal(app.calls.open.length, 1);
  const start = new URL(app.calls.open[0].url);
  assert.equal(`${start.origin}${start.pathname}`, `${SITE}/mobile-auth/start`);
  assert.equal(start.searchParams.get('app'), 'in.bkesari.app');
  assert.match(challengeOf(app.calls.open[0]), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(app.elements.google.disabled, true, 'one sign-in at a time');
  await app.clickGoogle();
  assert.equal(app.calls.open.length, 1, 'a second tap does not open another browser');
  assert.equal(app.calls.assign.length + app.calls.replace.length, 0, 'the WebView itself never goes to Google');

  await app.appUrlOpen('in.bkesari.app://auth-callback?code=42.1763400000000.abc');
  assert.equal(app.calls.close, 1, 'the browser is closed');
  assert.equal(app.calls.replace.length, 1);
  const finish = new URL(app.calls.replace[0]);
  assert.equal(`${finish.origin}${finish.pathname}`, `${SITE}/mobile-auth/finish`);
  assert.equal(finish.searchParams.get('code'), '42.1763400000000.abc');
  const verifier = finish.searchParams.get('verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challengeOf(app.calls.open[0]),
    'the verifier is the one whose challenge went to /mobile-auth/start');
  assert.equal(app.local.getItem(Auth.PENDING_KEY), null, 'the verifier is not kept once used');
  assert.equal(app.local.getItem('bk.continued'), '1');

  await app.appUrlOpen('in.bkesari.app://auth-callback?code=42.1763400000000.abc');
  assert.equal(app.calls.replace.length, 1, 'the same link again does nothing');
});

test('later launches open the hub; the back button comes back to the start screen', async () => {
  const local = memoryStorage({ 'bk.continued': '1' });
  const first = await launch({ local });
  assert.deepEqual(first.calls.assign, [`${SITE}/`]);
  assert.equal(first.shown(), false);

  // Back from the hub: the same run of the app (sessionStorage), page loaded again ...
  const back = await launch({ local, session: first.session });
  assert.deepEqual(back.calls.assign, []);
  assert.equal(back.shown(), true);
  assert.equal(back.elements.routes.hidden, false, 'Your projects, Request access, Your profile');
  back.routeLinks[2].click();
  assert.deepEqual(back.calls.assign, [`${SITE}/account`]);

  // ... or restored from the back/forward cache.
  await first.pageshow(true);
  assert.equal(first.shown(), true);
});

test('the hub sends the app here with ?google=1: sign-in starts at once, and only once', async () => {
  const local = memoryStorage({ 'bk.continued': '1' });
  const app = await launch({ local, session: memoryStorage({ 'bk.launched': '1' }), search: '?google=1' });
  assert.equal(app.calls.open.length, 1);
  assert.deepEqual(app.calls.replaceState, [[null, '', '/']], '?google=1 is dropped from the address');
  assert.deepEqual(app.calls.assign, []);
});

test('Android ended the app while the browser was open: the link arrives as the launch link', async () => {
  const before = await launch();
  await before.clickGoogle();
  const challenge = challengeOf(before.calls.open[0]);

  const link = 'in.bkesari.app://auth-callback?code=7.1763400000000.xyz';
  const cold = await launch({ local: before.local, launchUrl: link });
  assert.equal(cold.calls.replace.length, 1);
  const verifier = new URL(cold.calls.replace[0]).searchParams.get('verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);

  // Later the start screen loads again in the same run (back button): the old launch link is ignored.
  const again = await launch({ local: before.local, session: cold.session, launchUrl: link });
  assert.deepEqual(again.calls.replace, []);
  assert.equal(again.shown(), true);
  assert.equal(again.elements.status.textContent, '');
});

test('a link with no sign-in in progress, or without a code, is explained and goes nowhere', async () => {
  const stale = await launch();
  await stale.appUrlOpen('in.bkesari.app://auth-callback?code=1.2.3');
  assert.deepEqual(stale.calls.replace, []);
  assert.match(stale.elements.status.textContent, /expired/);
  assert.equal(stale.elements.status.className, 'status error');

  const noCode = await launch();
  await noCode.clickGoogle();
  await noCode.appUrlOpen('in.bkesari.app://auth-callback?error=access_denied');
  assert.deepEqual(noCode.calls.replace, []);
  assert.match(noCode.elements.status.textContent, /did not finish/);
  assert.equal(noCode.elements.google.disabled, false, 'the person can try again');
});

test('links that are not ours are ignored', async () => {
  const app = await launch();
  await app.clickGoogle();
  for (const url of ['https://bkesari.com/', 'com.bkesari.ladwani://auth-callback?code=abc', 'in.bkesari.app://other?code=abc']) {
    await app.appUrlOpen(url);
  }
  assert.deepEqual(app.calls.replace, []);
  assert.equal(app.calls.close, 0);
  assert.notEqual(app.local.getItem(Auth.PENDING_KEY), null, 'the sign-in in progress is untouched');
});

test('closing the browser without signing in makes the button usable again', async () => {
  const app = await launch();
  await app.clickGoogle();
  assert.equal(app.elements.google.disabled, true);
  await app.browserFinished();
  assert.equal(app.elements.google.disabled, false);
  assert.equal(app.elements.status.textContent, '');
});

test('email code and the desktop preview use the hub web pages in the WebView', async () => {
  const app = await launch();
  const event = app.elements.email.click();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(app.calls.assign, [`${SITE}/auth/sign-in?next=%2F`]);
  assert.equal(app.local.getItem('bk.continued'), '1');

  const web = await launch({ native: false });
  await web.clickGoogle();
  assert.deepEqual(web.calls.open, [], 'no system browser outside the app');
  assert.deepEqual(web.calls.assign, [`${SITE}/auth/google/start?next=%2F`]);
});
