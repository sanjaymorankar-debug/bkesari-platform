/**
 * The hub's pure parts, no database: its pages' strings in three languages,
 * the language choice, and the per-project sign-in helpers every project's
 * accounts rely on.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pages = require('../portal/hub-pages.js');
const { ownerEmails } = require('../portal/hub.js');
const auth = require('../portal/project-auth.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('every hub string exists in English, Marathi and Hindi, key for key', () => {
  const en = Object.keys(pages.strings.en).sort();
  for (const lang of ['mr', 'hi']) assert.deepEqual(Object.keys(pages.strings[lang]).sort(), en, lang);
  for (const lang of ['mr', 'hi']) {
    for (const [k, v] of Object.entries(pages.strings[lang])) {
      assert.ok(v.trim(), `${lang}.${k} is empty`);
      // Placeholders survive translation.
      const want = (pages.strings.en[k].match(/\{\w+\}/g) || []).sort();
      assert.deepEqual((v.match(/\{\w+\}/g) || []).sort(), want, `${lang}.${k} placeholders`);
    }
  }
});

test('every string the hub pages ask for exists', () => {
  const src = read('portal/hub-pages.js') + read('portal/hub.js') + read('portal/server.js');
  const used = new Set([...src.matchAll(/\bt\((?:lang|l|[a-z]+), '([a-zA-Z0-9.]+)'/g)].map((m) => m[1]));
  for (const k of [...src.matchAll(/'((?:contact|chip)\.[a-z.]+)'/g)].map((m) => m[1])) if (!k.endsWith('.')) used.add(k);
  assert.ok(used.size > 30, `found ${used.size} keys`);
  for (const k of used) assert.ok(k in pages.strings.en, `missing string ${k}`);
  assert.throws(() => pages.t('en', 'no.such.key'), /hub string missing/);
});

test('the language: the k_lang cookie, else the browser\'s, else English', () => {
  assert.equal(pages.langOf({ headers: { cookie: 'a=1; k_lang=mr; b=2' } }), 'mr');
  assert.equal(pages.langOf({ headers: { cookie: 'k_lang=xx', 'accept-language': 'hi-IN,hi;q=0.9' } }), 'hi');
  assert.equal(pages.langOf({ headers: { 'accept-language': 'fr-FR,mr;q=0.8' } }), 'mr');
  assert.equal(pages.langOf({ headers: {} }), 'en');
  assert.equal(pages.langOf(null), 'en');
});

test('a page is the Kesari layout: language, pinned design system, the shell, no inline script', () => {
  const html = pages.layout({ req: { path: '/about' }, lang: 'hi', env: 'test', title: 'T', body: '<p>b</p>' });
  assert.match(html, /<html lang="hi" data-i18n-reload>/);
  assert.match(html, /\/kesari-ui\/1\.0\.0\/kesari\.css/);
  assert.match(html, /mukta-devanagari-400-normal\.woff2/, 'Devanagari font preloaded for Marathi and Hindi');
  assert.match(html, /<header class="ks-bar/);
  assert.match(html, /<main id="main" class="k-main">/);
  assert.match(html, /class="ks-env">test</);
  assert.doesNotMatch(html.replace(/<script src="[^"]+"( defer)?><\/script>/g, ''), /<script/, 'only external scripts');
});

test('the owner list defaults to agtcipl@gmail.com and is configurable', () => {
  assert.deepEqual([...ownerEmails({})], ['agtcipl@gmail.com']);
  assert.deepEqual([...ownerEmails({ HUB_OWNER_EMAILS: 'A@x.com, b@y.com' })], ['a@x.com', 'b@y.com']);
});

test('mobile numbers are Indian 10-digit numbers, however they are typed', () => {
  for (const v of ['9876543210', '+91 98765 43210', '098765-43210', '919876543210', '0091 9876543210', '(98765) 43210']) assert.equal(auth.normalizeMobile(v), '9876543210', v);
  for (const v of ['12345', '5876543210', '98765432101', '', null, 'abcdefghij', '+1 9876543210']) assert.equal(auth.normalizeMobile(v), null, String(v));
});

test('emails are trimmed and lower-cased; passwords are long and not one kind', () => {
  assert.equal(auth.normalizeEmail('  Asha@Example.COM '), 'asha@example.com');
  assert.equal(auth.normalizeEmail('not-an-email'), null);
  assert.equal(auth.normalizeEmail(`${'a'.repeat(250)}@x.co`), null);
  assert.match(auth.passwordProblem('short'), /at least 8/);
  assert.match(auth.passwordProblem('12345678'), /letters/);
  assert.match(auth.passwordProblem('aaaaaaaaaa'), /predictable/);
  assert.equal(auth.passwordProblem('mango-tree-42'), null);
  assert.equal(auth.LOCK_AFTER, 5);
  assert.equal(auth.LOCK_MINUTES, 15);
});

test('each project\'s sign-in tables are in its own schema file, under its own prefix', () => {
  // TaskList's accounts live in TaskList's database; the hub's admins in the hub's.
  assert.ok(read('portal/sql/tasklist_schema.sql').includes(auth.authSchema('tl_').trim()));
  assert.ok(read('portal/sql/hub_schema.sql').includes(auth.authSchema('hub_admin_').trim()));
  assert.doesNotMatch(read('portal/sql/hub_schema.sql'), /CREATE TABLE IF NOT EXISTS tl_/, 'no TaskList accounts in the hub');
  assert.doesNotMatch(read('portal/sql/tasklist_schema.sql'), /hub_admin_/, 'no hub admins in TaskList');
  for (const t of ['users', 'sessions', 'password_resets', 'otp_codes', 'rate_limits', 'audit_log']) {
    assert.match(auth.authSchema('tl_'), new RegExp(`CREATE TABLE IF NOT EXISTS tl_${t} `), t);
  }
  assert.throws(() => auth.authSchema('x; DROP'), /bad prefix/);
});

test('the per-project session cookies are named and scoped as the spec says', () => {
  assert.match(read('portal/tasklist.js'), /cookie: 'tl_sid'/);
  assert.match(read('portal/tasklist.js'), /base: BASE/);
  assert.match(read('portal/hub.js'), /cookie: 'hub_admin_sid', cookiePath: '\/'/);
  assert.match(read('portal/project-auth.js'), /'SameSite=Lax'/);
  assert.match(read('portal/project-auth.js'), /parts\.push\('HttpOnly'\)/);
  assert.match(read('portal/ladwani.js'), /LADWANI_COOKIE_PATH = BASE/);
  assert.match(read('edu/config/session.php'), /edu_sid/);
});
