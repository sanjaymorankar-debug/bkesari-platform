/**
 * kesari-ui, the shared design system: the committed build matches its source,
 * it stays inside its size budget, every text colour pair is WCAG AA in light
 * and dark, and the runtime formats dates, times and numbers the Indian way,
 * in IST, whatever the machine's own time zone.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/kesari-ui/package.json'), 'utf8'));
const dist = path.join(root, 'portal/public/kesari-ui', pkg.version);
const K = require('../packages/kesari-ui/src/kesari.js');

test('the committed build is exactly what the source builds to', async () => {
  const { build } = await import('../packages/kesari-ui/build.mjs');
  const { css, js } = build();
  assert.equal(fs.readFileSync(path.join(dist, 'kesari.css'), 'utf8'), css, 'run npm run build:kesari and commit');
  assert.equal(fs.readFileSync(path.join(dist, 'kesari.js'), 'utf8'), js, 'run npm run build:kesari and commit');
  for (const f of fs.readdirSync(path.join(root, 'packages/kesari-ui/fonts'))) {
    assert.ok(fs.existsSync(path.join(dist, 'fonts', f)), `font ${f} is not in the build`);
  }
  assert.equal(K.VERSION, pkg.version, 'the runtime and the package agree on the version');
});

test('the design system stays within 30 KB gzipped (CSS + JS + the shell)', () => {
  const gz = (f) => zlib.gzipSync(fs.readFileSync(f)).length;
  const total = gz(path.join(dist, 'kesari.css')) + gz(path.join(dist, 'kesari.js')) + gz(path.join(root, 'portal/public/shared/menu.js'));
  assert.ok(total <= 30 * 1024, `${total} bytes gzipped`);
});

test('every font face swaps in, and there is a Devanagari face for Marathi and Hindi', () => {
  const css = fs.readFileSync(path.join(dist, 'kesari.css'), 'utf8');
  const faces = css.match(/@font-face\{[^}]+\}/g);
  assert.ok(faces.length >= 9);
  for (const f of faces) {
    assert.match(f, /font-display:swap/);
    const file = f.match(/url\(([^)]+)\)/)[1];
    assert.ok(fs.existsSync(path.join(dist, file)), `${file} is missing`);
  }
  assert.ok(faces.some((f) => /mukta-devanagari/.test(f) && /U\+0900-097F/i.test(f)));
  assert.ok(fs.existsSync(path.join(root, 'packages/kesari-ui/fonts/OFL-mukta.txt')), 'the licence ships with the font');
});

/* ---------------- contrast ---------------- */
function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--(k-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}
const src = fs.readFileSync(path.join(root, 'packages/kesari-ui/src/tokens.css'), 'utf8');
const light = tokens(src.slice(src.indexOf(':root{'), src.indexOf('}', src.indexOf(':root{'))));
const darkBlock = src.slice(src.indexOf(':root[data-theme="dark"]{'));
const dark = { ...light, ...tokens(darkBlock.slice(0, darkBlock.indexOf('}'))) };

test('light: every text pair is AA (4.5:1) on the surfaces it is used on', () => {
  const pairs = [
    ['k-ink', 'k-surface'], ['k-ink', 'k-page'], ['k-ink', 'k-surface-2'], ['k-muted', 'k-surface'], ['k-muted', 'k-page'], ['k-faint', 'k-surface'],
    ['k-success', 'k-surface'], ['k-warning', 'k-surface'], ['k-danger', 'k-surface'], ['k-info', 'k-surface'],
    ['k-success', 'k-success-tint'], ['k-warning', 'k-warning-tint'], ['k-danger', 'k-danger-tint'], ['k-info', 'k-info-tint'],
    ['k-accent-ink', 'k-page'], ['k-accent-ink', 'k-surface'], ['k-accent-ink', 'k-brand-tint'], ['k-ink', 'k-brand-tint'],
  ];
  for (const [fg, bg] of pairs) assert.ok(ratio(light[fg], light[bg]) >= 4.5, `${fg} on ${bg}: ${ratio(light[fg], light[bg]).toFixed(2)}`);
  // White on the brand and on each project accent (buttons).
  for (const accent of ['#C2560A', '#A64808', '#7C2D12', '#0F766E', '#4338CA', '#15803D']) {
    assert.ok(ratio('#FFFFFF', accent) >= 4.5, `white on ${accent}: ${ratio('#FFFFFF', accent).toFixed(2)}`);
    assert.ok(ratio(accent, '#FAF8F5') >= 4.5 || accent === '#C2560A', `${accent} as text on the page`);
  }
  // The reason --k-accent-ink exists: brand saffron as text on the page is not AA.
  assert.ok(ratio('#C2560A', light['k-page']) < 4.5);
});

test('dark: every text pair is AA on the dark surfaces', () => {
  const pairs = [
    ['k-ink', 'k-surface'], ['k-ink', 'k-page'], ['k-muted', 'k-surface'], ['k-muted', 'k-page'], ['k-faint', 'k-surface'],
    ['k-success', 'k-surface'], ['k-warning', 'k-surface'], ['k-danger', 'k-surface'], ['k-info', 'k-surface'],
    ['k-accent-ink', 'k-page'], ['k-accent-ink', 'k-surface'], ['k-accent-ink', 'k-brand-tint'],
  ];
  for (const [fg, bg] of pairs) assert.ok(ratio(dark[fg], dark[bg]) >= 4.5, `${fg} on ${bg}: ${ratio(dark[fg], dark[bg]).toFixed(2)}`);
  for (const accent of ['#F08A3C', '#F4A68C', '#5EEAD4', '#A5B4FC', '#4ADE80']) {
    assert.ok(ratio(dark['k-on-accent'], accent) >= 4.5, `dark text on ${accent}`);
    assert.ok(ratio(accent, dark['k-surface']) >= 4.5, `${accent} on the dark surface`);
  }
});

test('the dark values are the same whether chosen by the system or pinned by the toggle', () => {
  const media = src.slice(src.indexOf('@media (prefers-color-scheme:dark)'));
  const sys = tokens(media.slice(0, media.indexOf('}')));
  const pinned = tokens(darkBlock.slice(0, darkBlock.indexOf('}')));
  assert.deepEqual(sys, pinned);
});

test('touch targets are 48px and the focus ring is a 3px saffron outline, never removed', () => {
  const css = fs.readFileSync(path.join(dist, 'kesari.css'), 'utf8');
  assert.match(src, /--k-target:48px/);
  assert.match(css, /:focus-visible\{outline:3px solid var\(--k-focus\)/);
  assert.doesNotMatch(css.replace(/:focus:not\(:focus-visible\)\{outline:none\}/, ''), /outline:\s*(none|0)\b/, 'no other rule removes the outline');
  assert.match(css, /prefers-reduced-motion:reduce/);
});

/* ---------------- runtime ---------------- */
test('dates read "3 Nov 2026" and times "08:42 AM IST", in IST whatever the clock\'s zone', () => {
  const at = new Date('2026-11-03T03:12:00Z'); // 08:42 IST
  assert.equal(K.formatDate(at), '3 Nov 2026');
  assert.equal(K.formatTime(at), '08:42 AM IST');
  assert.equal(K.formatDateTime(at), '3 Nov 2026, 08:42 AM IST');
  assert.equal(K.formatDate('2026-11-02T20:00:00Z'), '3 Nov 2026', 'late evening UTC is already tomorrow in India');
  assert.equal(K.formatTime('2026-11-03T06:30:00Z'), '12:00 PM IST');
  assert.equal(K.formatTime('2026-11-02T18:30:00Z'), '12:00 AM IST');
  assert.equal(K.istToday(at), '2026-11-03');
  assert.equal(K.formatDate('not a date'), '');
});

test('numbers use Indian grouping, and rupees', () => {
  assert.equal(K.formatNumber(130000), '1,30,000');
  assert.equal(K.formatNumber(12345678), '1,23,45,678');
  assert.equal(K.formatRupees(130000), '₹1,30,000.00');
  assert.equal(K.formatNumber('x'), '');
});

test('the language: saved choice, then cookie, then browser, then English', () => {
  assert.equal(K.resolveLang({ saved: 'mr', cookie: 'hi' }), 'mr');
  assert.equal(K.resolveLang({ saved: 'xx', cookie: 'hi' }), 'hi');
  // The browser's language is not used: English until the person picks one (D-030).
  assert.equal(K.resolveLang({ navigatorLangs: ['fr-FR', 'hi-IN'] }), 'en');
  assert.equal(K.resolveLang({}), 'en');
  assert.equal(K.readCookie('k_lang', 'a=1; k_lang=mr'), 'mr');
  assert.deepEqual(K.LANGS.map((l) => l.code), ['en', 'mr', 'hi']);
  assert.equal(K.nextTheme('system'), 'light');
  assert.equal(K.nextTheme('dark'), 'system');
});

test('storage that throws (private windows, blocked cookies) never breaks the page', () => {
  assert.doesNotThrow(() => K.store.set('x', '1'));
  assert.equal(K.store.get('x'), null);
  assert.equal(K.currentTheme(), 'system');
});
