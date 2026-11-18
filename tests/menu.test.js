/**
 * The Kesari app shell (portal/public/shared/menu.js) is the one piece every
 * project on every tier includes, so a mistake here shows on every page at
 * once. These tests cover what a diff does not show: the project order, the
 * tier detection, scoping, accessibility and the per-project account.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const menu = require('../portal/public/shared/menu.js');

/** The header's markup with the stylesheet dropped (the CSS names classes too). */
function bar(options) {
  const html = menu.renderHtml(options);
  const at = html.indexOf('<header');
  assert.notEqual(at, -1, 'renderHtml returned no <header>');
  return html.slice(at);
}

const EXPECTED = [
  ['LadWani', '/ladwani/'],
  ['ATIP', '/ATIP/'],
  ['Education', '/edu/'],
  ['TaskList', '/tasklist/'],
  ['Driving Simulator', '/driving-simulator/'],
  ['Environmental Activities', '/environment/'],
];

test('the six projects are present, in order, each with a key, icon, accent and tagline', () => {
  assert.deepEqual(menu.TABS.map((t) => [t.name, t.path]), EXPECTED);
  for (const tab of menu.TABS) {
    assert.match(tab.path, /^\/[A-Za-z-]+\/$/, `${tab.name} has path ${tab.path}`);
    assert.ok(menu.ICONS[tab.icon], `${tab.name} has no icon`);
    assert.match(tab.accent, /^#[0-9A-F]{6}$/i);
    for (const lang of ['en', 'mr', 'hi']) assert.ok(menu.STRINGS[lang][`tag.${tab.key}`], `${tab.name} has no ${lang} tagline`);
  }
});

test('the shell\'s strings exist in English, Marathi and Hindi, key for key', () => {
  const keys = Object.keys(menu.STRINGS.en).sort();
  for (const lang of ['mr', 'hi']) assert.deepEqual(Object.keys(menu.STRINGS[lang]).sort(), keys, lang);
});

test('the tier comes from the hostname, an explicit override wins, and unknown is production', () => {
  assert.equal(menu.resolveEnv('dev.bkesari.com'), 'dev');
  assert.equal(menu.resolveEnv('test.bkesari.com'), 'test');
  assert.equal(menu.resolveEnv('bkesari.com'), 'prod');
  assert.equal(menu.resolveEnv('localhost'), 'dev');
  assert.equal(menu.resolveEnv('DEV.BKESARI.COM'), 'dev');
  assert.equal(menu.resolveEnv('bkesari.com', 'dev'), 'dev');
  assert.equal(menu.resolveEnv('dev.bkesari.com', 'production'), 'prod');
  assert.equal(menu.resolveEnv('bkesari.com', 'staging'), 'test');
  assert.equal(menu.resolveEnv('dev.bkesari.com', 'nonsense'), 'dev');
  assert.equal(menu.resolveEnv(''), 'prod');
  assert.equal(menu.resolveEnv(undefined), 'prod');
  assert.equal(menu.resolveEnv('example.test'), 'prod');
});

test('the active project is the longest matching prefix, old names included', () => {
  assert.equal(menu.activeTabPath('/ladwani/members/42'), '/ladwani/');
  assert.equal(menu.activeTabPath('/ladwani'), '/ladwani/');
  assert.equal(menu.activeTabPath('/atip/'), '/ATIP/');
  assert.equal(menu.activeTabPath('/tasks/'), '/tasklist/', 'the old tracker address is TaskList');
  assert.equal(menu.activeTabPath('/education/sign-in'), '/edu/');
  assert.equal(menu.activeTabPath('/'), '/');
  assert.equal(menu.activeTabPath(undefined), '/');
  assert.equal(menu.activeTabPath('/ladwanix/'), '/', 'a path that only looks like a project');
  assert.equal(menu.activeTabPath('/edu-news/'), '/');
});

test('inside a project the header names it in its accent; on the hub it names none', () => {
  const tl = bar({ pathname: '/tasklist/board' });
  assert.match(tl, /<header class="ks-bar bk-menu" data-project="tasklist">/);
  assert.match(tl, /<a class="ks-proj" href="\/tasklist\/">TaskList<\/a>/);
  assert.match(menu.styleTag(), /\.ks-bar\[data-project=tasklist\]\{--ks-accent:#4338CA\}/);
  assert.match(menu.styleTag(), /\.ks-bar \.ks-proj\{[^}]*color:var\(--ks-accent\)/, 'the name is drawn in the accent, not inherited ink');
  const home = bar({ pathname: '/' });
  assert.doesNotMatch(home, /ks-proj/);
  assert.doesNotMatch(home, /data-project=/);
  assert.match(home, /class="ks-brand" href="\/" aria-current="page"/);
  assert.doesNotMatch(bar({ pathname: '/ladwani/' }), /class="ks-brand" href="\/" aria-current/);
});

test('the All-projects switcher lists every project, ATIP included, marked private and only as a link out', () => {
  for (const isOwner of [true, false]) {
    const html = bar({ pathname: '/', isOwner });
    for (const [name, href] of EXPECTED) assert.ok(html.includes(`href="${href}"`), `${name} is missing from the switcher (owner: ${isOwner})`);
    assert.match(html, /href="\/ATIP\/"[^>]*target="_blank" rel="noopener"/, 'ATIP opens /ATIP/ unchanged, in its own window');
    assert.match(html, /ATIP ↗<small>Private: the owner&#39;s view-only trading dashboard<\/small>/);
    assert.equal((html.match(/class="ks-item"/g) || []).length, 6);
  }
  const other = bar({ pathname: '/' });
  assert.match(other, /<details class="ks-pop ks-switch">/);
  assert.match(other, /<summary class="ks-btn" aria-label="All projects"/);
  assert.match(other, /<a class="ks-item ks-homeitem" href="\/" aria-current="page">/, 'and returns to the hub, first');
  assert.match(other, /<a class="ks-all" href="\/account">/, 'and ends with My projects and access');
  assert.equal((bar({ pathname: '/tasklist/' }).match(/aria-current="page"/g) || []).length, 1, 'exactly one current item');
});

test('inside every project the logo is a visible way back: "Back to bkesari home", in each language', () => {
  for (const tab of menu.TABS) {
    const html = bar({ pathname: tab.path, isOwner: true, env: 'dev' });
    assert.match(html, /<a class="ks-brand ks-back" href="\/" title="Back to bkesari home">/, `${tab.name} has no way back home`);
    // Named by its content: the visible word "bkesari" inside "Back to … home" (WCAG 2.5.3).
    assert.match(html, /<span class="ks-sr">Back to <\/span><span class="ks-brand-name">bkesari<\/span><span class="ks-sr"> home<\/span><\/a> <span class="ks-env">dev<\/span>/, 'the tier badge is outside the link');
    assert.match(html, /<a class="ks-item ks-homeitem" href="\/"><span class="ks-dot">/, `${tab.name}'s switcher starts with home`);
  }
  assert.match(bar({ pathname: '/ladwani/', lang: 'mr' }), /<span class="ks-brand-name">bkesari<\/span><span class="ks-sr"> मुख्यपृष्ठावर परत जा<\/span>/);
  assert.match(bar({ pathname: '/edu/', lang: 'hi' }), /title="bkesari मुखपृष्ठ पर वापस जाएँ"/);
  assert.doesNotMatch(bar({ pathname: '/' }), /ks-back/, 'the hub itself needs no way back');
});

test('long project names have a short form on tablets and phones, and the full name on wider screens', () => {
  assert.match(bar({ pathname: '/driving-simulator/' }), /<a class="ks-proj" href="\/driving-simulator\/"><span class="ks-proj-full">Driving Simulator<\/span><span class="ks-proj-short">Driving<\/span><\/a>/);
  assert.match(menu.styleTag(), /\.ks-proj-short\{display:none\}/);
  assert.match(menu.styleTag(), /@media \(max-width:959px\)\{[^@]*\.ks-proj-full\{display:none\}\.ks-proj-short\{display:inline\}/);
});

test('the footer lists the public projects (never ATIP) and the site links', () => {
  const foot = menu.renderFooter({ lang: 'en', year: 2026 });
  for (const tab of menu.TABS.filter((x) => !x.ownerOnly)) assert.ok(foot.includes(`<a href="${tab.path}">${tab.name}</a>`), `${tab.name} missing from the footer`);
  assert.doesNotMatch(foot, /ATIP/);
  for (const href of ['/about', '/privacy', '/terms', '/contact']) assert.ok(foot.includes(`href="${href}"`));
});

test('the tier badge shows on dev and test, never on production', () => {
  assert.match(bar({ pathname: '/', env: 'dev' }), /class="ks-env">dev</);
  assert.match(bar({ pathname: '/', env: 'test' }), /class="ks-env">test</);
  assert.doesNotMatch(bar({ pathname: '/', env: 'prod' }), /ks-env/);
  assert.doesNotMatch(bar({ pathname: '/' }), /ks-env/, 'no env given is production');
});

test('below 960 px the bar fits: the avatar stands for the account, and the tier badge hangs from the accent stripe', () => {
  // portal-tester O1: signed in below 340 px (350 px with "test") the badge in the row made every page scroll sideways;
  // with an email as the account's name, projects' bars scrolled sideways at 641-770 px, production included.
  const css = menu.styleTag();
  const narrow = css.match(/@media \(max-width:959px\)\{([\s\S]*?\})\}/)[1];
  assert.match(narrow, /\.ks-acct-name\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\)/, 'the account\'s name is only spoken');
  const badge = narrow.match(/\.ks-bar \.ks-env\{([^}]*)\}/);
  assert.ok(badge, 'no phone rule for the badge');
  for (const decl of ['position:absolute', 'top:0', 'pointer-events:none']) assert.ok(badge[1].includes(decl), decl);
  assert.match(css, /\.ks-bar\{position:sticky;/, 'the bar is the badge\'s containing block');
  // From 960 px the badge stays in the row, beside the logo.
  const wide = css.replace(/@media[^{]*\{[\s\S]*?\}\}/g, '');
  assert.doesNotMatch(wide.match(/\.ks-env\{[^}]*\}/)[0], /position/);
  // The badge is the same element, with its text, on the hub and inside a project.
  assert.match(bar({ pathname: '/', env: 'test' }), /<span class="ks-brand-name">bkesari<\/span> <span class="ks-env">test<\/span><\/a>/);
  assert.match(bar({ pathname: '/ladwani/', env: 'dev' }), /<\/a> <span class="ks-env">dev<\/span>/);
});

test('up to 640 px the project switcher\'s panel stays on screen', () => {
  // portal-tester: on phones the switcher is not the bar's last control, so its panel, held to the switcher's
  // right edge, ran 76-120 px off the left of the screen at 320-360 px: the projects' names read "i", "on".
  const css = menu.styleTag();
  const phones = css.match(/@media \(max-width:640px\)\{([\s\S]*?\})\}/)[1];
  assert.match(phones, /\.ks-switch\.ks-pop\{position:static\}/, 'the panel is placed against the bar, not the switcher');
  assert.match(phones, /\.ks-switch \.ks-panel\{right:6px\}/, 'and against the bar\'s right edge');
  assert.match(css, /\.ks-bar\{position:sticky;/, 'the bar is the panel\'s containing block');
  assert.match(css, /\.ks-panel\{position:absolute;right:0;top:calc\(100% \+ 6px\);width:min\(340px,calc\(100vw - 24px\)\)/, 'never wider than the screen less 24 px');
});

test('server-rendered, the header adds no script and shows nothing that needs one', () => {
  // The ATIP viewer's CSP allows inline scripts but not 'self'; the header is
  // rendered there on the server and must work as it is.
  const html = menu.renderHtml({ pathname: '/ATIP/', env: 'dev', isOwner: true });
  assert.ok(!html.includes('<script'), 'the header injected a script tag');
  const header = bar({ pathname: '/ladwani/' });
  // Language, theme and the account need the script: hidden until it runs.
  assert.match(header, /<label class="ks-lang" hidden data-ks-js>/);
  assert.match(header, /<button class="ks-btn" type="button" data-k-theme hidden data-ks-js/);
  assert.match(header, /<div class="ks-account" data-ks-account hidden><\/div>/);
  assert.match(header, /<a class="ks-skip" href="#main">Skip to content<\/a>/);
});

test('the shell\'s styles are scoped: including it never changes the host page\'s colours', () => {
  const css = menu.styleTag();
  assert.doesNotMatch(css, /(^|[}\s]):root\s*\{/, 'no tokens on :root');
  for (const rule of css.replace(/<\/?style[^>]*>/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter(Boolean)) {
    const selector = rule.split('{')[0].replace(/@media[^{]*\{/, '').trim();
    if (!selector || selector.startsWith('@')) continue;
    assert.match(selector, /\.ks-|\.k-footer/, `unscoped rule: ${selector}`);
  }
  assert.match(css, /:focus-visible\{outline:3px solid var\(--ks-focus\)/, 'a 3px focus ring');
  assert.match(css, /min-height:48px/, '48px targets');
});

test('the header and footer render in Marathi and Hindi', () => {
  assert.match(bar({ pathname: '/', lang: 'mr' }), /aria-label="सर्व प्रकल्प"/);
  assert.match(bar({ pathname: '/', lang: 'hi' }), /मुख्य सामग्री पर जाएँ/);
  const foot = menu.renderFooter({ lang: 'mr', year: 2026 });
  for (const href of ['/about', '/privacy', '/terms', '/contact']) assert.ok(foot.includes(`href="${href}"`), href);
  assert.match(foot, /गोपनीयता/);
  assert.match(foot, /&copy; 2026 bkesari\.com/);
});

test('the account menu shows only the current project\'s own user, and signs out of that project only', () => {
  // No DOM library here: a stand-in slot is enough to check what is rendered.
  const slot = { innerHTML: '', hidden: true, querySelector: () => null };
  const d = { defaultView: { location: {} } };
  const tab = menu.TABS.find((x) => x.key === 'tasklist');
  menu.renderAccount(d, slot, { user: { name: 'Sanjay More', email: 's@example.com' }, signOut: { url: '/tasklist/api/auth/sign-out', csrf: 'tok' } }, tab, 'en');
  assert.equal(slot.hidden, false);
  assert.match(slot.innerHTML, /Signed in to TaskList/);
  assert.match(slot.innerHTML, /This is a separate account for TaskList\./);
  assert.match(slot.innerHTML, />SM</, 'initials');
  assert.match(slot.innerHTML, /<summary class="ks-btn"><span class="ks-avatar" aria-hidden="true">SM<\/span><span class="ks-acct-name">Sanjay More<\/span><span class="ks-sr">, Account<\/span><\/summary>/,
    'the spoken name begins with the visible name (WCAG 2.5.3)');
  assert.match(slot.innerHTML, /data-ks-signout/);
  const out = { innerHTML: '', hidden: true, querySelector: () => null };
  menu.renderAccount(d, out, { user: null, signInUrl: '/tasklist/sign-in' }, tab, 'en');
  assert.match(out.innerHTML, /class="ks-btn ks-signin" href="\/tasklist\/sign-in"/);
  const none = { innerHTML: '', hidden: true, querySelector: () => null };
  menu.renderAccount(d, none, null, null, 'en');
  assert.equal(none.hidden, true, 'no me-url answer: nothing shown');
});

test('the bar never mentions Milk & Dairy', () => {
  assert.doesNotMatch(menu.renderHtml({ pathname: '/', isOwner: true }), /milk/i);
});

test('server.js and the shell agree on the project paths', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal', 'server.js'), 'utf8');
  assert.match(src, /menu\.TABS\.map\(\(tab\) => tab\.path\)/);
});

test('every hub page carries the shell and the pinned design system', () => {
  const publicDir = path.join(__dirname, '..', 'portal', 'public');
  for (const page of ['environment/index.html', 'driving-simulator/index.html', 'tasklist/app.html', 'tasklist/auth.html', 'styleguide/index.html']) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(html, /<script src="\/shared\/menu\.js" defer><\/script>/, `${page} has no shell`);
    assert.match(html, /<link rel="stylesheet" href="\/kesari-ui\/1\.1\.0\/kesari\.css">/, `${page} is not on Kesari 1.1.0`);
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, `${page} has an inline script, which the hub's CSP refuses`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${page} has an inline event handler`);
    assert.doesNotMatch(html, /fonts\.googleapis\.com/, `${page} fetches Google Fonts; Kesari ships its own`);
    assert.doesNotMatch(html, /class="todo"/, `${page} shows an internal editorial note`);
  }
  const hubPages = fs.readFileSync(path.join(__dirname, '..', 'portal', 'hub-pages.js'), 'utf8');
  assert.match(hubPages, /menu\.renderHtml\(/, 'the hub\'s own pages render the shell on the server');
  assert.match(hubPages, /menu\.renderFooter\(/);
});
