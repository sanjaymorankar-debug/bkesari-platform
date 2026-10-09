/**
 * The shared menu is the one piece every project on every tier includes, so a
 * mistake here is visible on all seven tabs at once. These tests cover the
 * parts that cannot be seen from a diff: the tab order the brief fixes, the
 * tier detection, and the two bugs this file has actually had.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const menu = require('../portal/public/shared/menu.js');

/**
 * Just the bar's markup, with the stylesheet dropped.
 *
 * renderHtml returns the styles and the <nav> together. The stylesheet names
 * `.bk-env` and `[aria-current="page"]` as selectors, so searching the whole
 * string for those finds CSS and reports a badge or a current item that is not
 * actually rendered. Every assertion about what the bar shows uses this.
 */
function bar(options) {
  const html = menu.renderHtml(options);
  const nav = html.indexOf('<nav');
  assert.notEqual(nav, -1, 'renderHtml returned no <nav>');
  return html.slice(nav);
}

// The order is specified, not incidental — it is the order in the brief.
const EXPECTED_TABS = [
  ['Milk & Dairy Products', '/milk/'],
  ['Education', '/edu/'],
  ['Global Warming', '/global-warming/'],
  ['LadWani', '/ladwani/'],
  ['TaskList', '/tasklist/'],
  ['ATIP', '/atip/'],
  ['Driving Simulator', '/driving-simulator/'],
];

test('the seven tabs are present, in the specified order', () => {
  assert.deepEqual(
    menu.TABS.map((t) => [t.name, t.path]),
    EXPECTED_TABS,
  );
});

test('every tab path is absolute and ends in a slash', () => {
  // activeTabPath strips one trailing slash to compare, and server.js
  // registers these paths verbatim as routes. Both assume this shape.
  for (const tab of menu.TABS) {
    assert.match(tab.path, /^\/[a-z-]+\/$/, `${tab.name} has path ${tab.path}`);
  }
});

test('every tab has an icon and a tagline for the welcome cards', () => {
  for (const tab of menu.TABS) {
    assert.ok(tab.icon, `${tab.name} has no icon`);
    assert.ok(tab.tagline, `${tab.name} has no tagline`);
  }
});

test('the tier comes from the hostname', () => {
  assert.equal(menu.resolveEnv('dev.bkesari.com'), 'dev');
  assert.equal(menu.resolveEnv('test.bkesari.com'), 'test');
  assert.equal(menu.resolveEnv('bkesari.com'), 'prod');
  assert.equal(menu.resolveEnv('www.bkesari.com'), 'prod');
  assert.equal(menu.resolveEnv('localhost'), 'dev');
  assert.equal(menu.resolveEnv('127.0.0.1'), 'dev');
  assert.equal(menu.resolveEnv('DEV.BKESARI.COM'), 'dev');
});

test('an explicit override beats the hostname', () => {
  // This is how a server passes its own APP_ENV in, so that a tier is never
  // inferred wrongly from a hostname the app does not control.
  assert.equal(menu.resolveEnv('bkesari.com', 'dev'), 'dev');
  assert.equal(menu.resolveEnv('dev.bkesari.com', 'production'), 'prod');
  assert.equal(menu.resolveEnv('bkesari.com', 'staging'), 'test');
  assert.equal(menu.resolveEnv('dev.bkesari.com', '  DEV  '), 'dev');
  // An unrecognised override falls back to the hostname rather than guessing.
  assert.equal(menu.resolveEnv('dev.bkesari.com', 'nonsense'), 'dev');
  assert.equal(menu.resolveEnv('bkesari.com', ''), 'prod');
});

test('an unknown hostname is treated as production, never as dev', () => {
  // Failing closed matters: a dev badge missing on production is cosmetic,
  // but a page claiming to be dev while serving production is misleading.
  assert.equal(menu.resolveEnv(''), 'prod');
  assert.equal(menu.resolveEnv(undefined), 'prod');
  assert.equal(menu.resolveEnv('example.test'), 'prod');
});

test('the active tab is the longest matching prefix', () => {
  assert.equal(menu.activeTabPath('/milk/'), '/milk/');
  assert.equal(menu.activeTabPath('/milk'), '/milk/');
  assert.equal(menu.activeTabPath('/milk/orders/42'), '/milk/');
  assert.equal(menu.activeTabPath('/driving-simulator/'), '/driving-simulator/');
  assert.equal(menu.activeTabPath('/'), '/');
  assert.equal(menu.activeTabPath(''), '/');
  assert.equal(menu.activeTabPath(undefined), '/');
});

test('a path that only looks like a tab does not activate it', () => {
  assert.equal(menu.activeTabPath('/milkshake/'), '/');
  assert.equal(menu.activeTabPath('/edu-news/'), '/');
});

test('renderHtml lists all seven tabs', () => {
  const html = menu.renderHtml({ pathname: '/', env: 'dev' });
  for (const [name] of EXPECTED_TABS) {
    const escaped = name.replace(/&/g, '&amp;');
    assert.ok(html.includes(escaped), `${name} is missing from the bar`);
  }
});

test('renderHtml escapes the tab names', () => {
  // "Milk & Dairy Products" is the one tab whose name is not HTML-safe.
  const html = menu.renderHtml({ pathname: '/' });
  assert.ok(html.includes('Milk &amp; Dairy Products'));
  assert.ok(!html.includes('Milk & Dairy'));
});

test('renderHtml marks exactly one current item', () => {
  const html = bar({ pathname: '/tasklist/', env: 'dev' });
  assert.equal(html.match(/aria-current="page"/g).length, 1);
  assert.match(html, /<a href="\/tasklist\/" aria-current="page">TaskList<\/a>/);
});

test('the TaskList tab is lit on TaskList pages and not on the old /tasks/ path', () => {
  assert.equal(menu.activeTabPath('/tasklist/'), '/tasklist/');
  assert.equal(menu.activeTabPath('/tasklist'), '/tasklist/');
  assert.equal(menu.activeTabPath('/tasklist/api/tasks'), '/tasklist/');
  // /tasks/ redirects to /tasklist/ when TaskList is configured; it is no
  // longer a tab of its own, so it must not light one up.
  assert.equal(menu.activeTabPath('/tasks/'), '/');
});

test('the brand carries aria-current on the welcome page only', () => {
  const home = bar({ pathname: '/' });
  assert.match(home, /class="bk-brand" href="\/" aria-current="page"/);
  assert.equal(home.match(/aria-current="page"/g).length, 1);
  const away = bar({ pathname: '/atip/' });
  assert.ok(!/class="bk-brand" href="\/" aria-current="page"/.test(away));
});

test('the tier badge shows on dev and test, and not on production', () => {
  assert.match(bar({ pathname: '/', env: 'dev' }), /class="bk-env">dev</);
  assert.match(bar({ pathname: '/', env: 'test' }), /class="bk-env">test</);
  const prod = bar({ pathname: '/', env: 'prod' });
  assert.ok(!prod.includes('bk-env'), 'production is wearing a tier badge');
  // No env given is treated as production, so an unlabelled page never
  // claims to be a lower tier.
  assert.ok(!bar({ pathname: '/' }).includes('bk-env'));
});

test('the mobile disclosure is a checkbox, not a <details>', () => {
  // A closed <details> does not render its non-summary children at all, so no
  // CSS could reveal the tabs on desktop and the bar came up empty. The
  // checkbox is the one disclosure whose open state CSS can reach. This test
  // exists so that cannot be reintroduced.
  const html = menu.renderHtml({ pathname: '/' });
  assert.ok(!html.includes('<details'), 'the hamburger is a <details> again');
  assert.match(html, /<input class="bk-toggle" id="bk-menu-toggle" type="checkbox">/);
  assert.match(html, /<label class="bk-burger" for="bk-menu-toggle">/);
});

test('the stylesheet opens the tabs from the checkbox', () => {
  // The markup above is inert without this rule, and a page with no
  // JavaScript has nothing else to fall back on.
  assert.match(menu.styleTag(), /\.bk-toggle:checked\s*~\s*\.bk-tabs\s*\{[^}]*display:\s*flex/);
});

test('renderHtml needs no scripts to work', () => {
  // The ATIP viewer's Content-Security-Policy allows inline scripts but not
  // 'self'; the bar is server-rendered there precisely so it adds none.
  const html = menu.renderHtml({ pathname: '/atip/', env: 'dev' });
  assert.ok(!html.includes('<script'), 'the bar injected a script tag');
});

test('server.js and the menu agree on the tab paths', () => {
  // server.js registers menu.TABS paths as a fallback route, so a tab whose
  // project is not deployed on this tier answers with a short explanation
  // instead of a bare 404. It reads them from the menu rather than repeating
  // them; this asserts that it still does.
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal', 'server.js'), 'utf8');
  assert.match(src, /menu\.TABS\.map\(\(tab\) => tab\.path\)/);
});

test('every static hub page includes the shared bar', () => {
  // index.html loads it WITHOUT defer on purpose: an inline script right after
  // it reads BKESARI_MENU.TABS to build the welcome cards from the same list,
  // so the script has to have run by then. The other two defer it.
  const publicDir = path.join(__dirname, '..', 'portal', 'public');
  const pages = ['index.html', 'global-warming/index.html', 'driving-simulator/index.html'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(
      html,
      /<script src="\/shared\/menu\.js"( defer)?><\/script>/,
      `${page} does not include the shared menu`,
    );
  }
});

test("the welcome page's <noscript> list matches the tabs", () => {
  // This is the one place a second copy of the tab list exists, and it has to:
  // on the welcome page both the bar and the cards are built by script, so
  // with JavaScript off there would otherwise be no way to reach a project.
  // Being a copy, it can go stale — adding an eighth tab to TABS would leave
  // it invisible here — so it is checked against TABS rather than trusted.
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'portal', 'public', 'index.html'), 'utf8');
  const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
  assert.ok(noscript, 'the welcome page has no <noscript> fallback');

  const listed = [...noscript[1].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)]
    .map(([, href, text]) => [text, href]);

  assert.deepEqual(
    listed,
    menu.TABS.map((t) => [menu.escapeHtml(t.name), t.path]),
    'the <noscript> list has drifted from TABS',
  );
});
