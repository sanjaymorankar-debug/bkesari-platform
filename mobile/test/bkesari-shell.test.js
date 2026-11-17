/**
 * The bkesari app's shell (bkesari/): the settings that have to agree across
 * Capacitor, Android, iOS and the start screen — app id and URL scheme, where
 * the WebView may go, the version and build numbers, and the vendored
 * Capacitor scripts. Run `npm ci` in mobile/ first (the vendored scripts are
 * compared with node_modules).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobile = path.join(__dirname, '..');
const app = path.join(mobile, 'bkesari');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const readJson = (...parts) => JSON.parse(read(...parts));

const cap = readJson(app, 'capacitor.config.json');
const config = require('../bkesari/www/config.js');
const Auth = require('../bkesari/www/js/auth-core.js');
const rootPkg = readJson(mobile, 'package.json');
const appPkg = readJson(app, 'package.json');
const gradle = read(app, 'android', 'app', 'build.gradle');
const manifest = read(app, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const strings = read(app, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const plist = read(app, 'ios', 'App', 'App', 'Info.plist');
const pbxproj = read(app, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

/** The strings of a plist `<key>name</key><array>…</array>`. */
function plistArray(name) {
  const match = new RegExp(`<key>${name}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist);
  assert.ok(match, `${name} is in Info.plist`);
  return [...match[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
}

function plistString(name) {
  const match = new RegExp(`<key>${name}</key>\\s*<string>([^<]*)</string>`).exec(plist);
  assert.ok(match, `${name} is in Info.plist`);
  return match[1];
}

function buildSettings(name) {
  return [...pbxproj.matchAll(new RegExp(`\\b${name} = ([^;]+);`, 'g'))].map((m) => m[1].trim());
}

test('one app id, which is also the URL scheme the hub hands sign-in back to', () => {
  assert.equal(cap.appId, 'in.bkesari.app');
  assert.equal(cap.appName, 'bkesari');
  assert.equal(config.scheme, cap.appId);
  assert.equal(Auth.isAllowedScheme(config.scheme), true);
  assert.match(gradle, /namespace = "in\.bkesari\.app"/);
  assert.match(gradle, /applicationId "in\.bkesari\.app"/);
  assert.match(strings, /<string name="package_name">in\.bkesari\.app<\/string>/);
  assert.match(strings, /<string name="custom_url_scheme">in\.bkesari\.app<\/string>/);
  assert.ok(fs.existsSync(path.join(app, 'android', 'app', 'src', 'main', 'java', 'in', 'bkesari', 'app', 'MainActivity.java')));
  assert.deepEqual([...new Set(buildSettings('PRODUCT_BUNDLE_IDENTIFIER'))], ['in.bkesari.app']);
});

test('Android opens in.bkesari.app://auth-callback in the running app', () => {
  const filters = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]);
  const callback = filters.find((f) => f.includes('android:host="auth-callback"'));
  assert.ok(callback, 'an intent filter for the callback');
  assert.match(callback, /android\.intent\.action\.VIEW/);
  assert.match(callback, /android\.intent\.category\.DEFAULT/);
  assert.match(callback, /android\.intent\.category\.BROWSABLE/);
  assert.match(callback, /android:scheme="@string\/custom_url_scheme"/);
  // singleTask: the link reaches the activity that started the sign-in (onNewIntent -> appUrlOpen).
  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*?android:launchMode="singleTask"/);
  // The WebView's cookies (bk_sid) and the pending verifier stay on this phone.
  assert.match(manifest, /android:allowBackup="false"/);
});

test('iOS registers the scheme and the app-bound domains', () => {
  const types = /<key>CFBundleURLTypes<\/key>\s*<array>([\s\S]*?)<\/array>\s*<key>/.exec(plist);
  assert.ok(types, 'CFBundleURLTypes');
  assert.match(types[1], /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>in\.bkesari\.app<\/string>\s*<\/array>/);
  const domains = plistArray('WKAppBoundDomains');
  assert.ok(domains.length <= 10, 'iOS allows at most 10');
  assert.ok(domains.includes(cap.server.hostname), 'the start screen (Capacitor: add server.hostname)');
  assert.ok(domains.includes(new URL(config.site).hostname), 'the hub this build opens');
  for (const host of cap.server.allowNavigation) assert.ok(domains.includes(host), host);
  assert.equal(cap.ios.limitsNavigationsToAppBoundDomains, true);
});

test('the app starts on its own screen and the WebView goes only to the hub', () => {
  assert.equal(cap.server.url, undefined, 'no server.url: the start screen (www/) is the app');
  assert.equal(cap.webDir, 'www');
  assert.equal(cap.server.androidScheme, 'https', 'https://localhost: a secure context (SubtleCrypto)');
  assert.equal(cap.server.iosScheme, 'capacitor');
  assert.equal(cap.server.hostname, 'localhost');
  assert.equal(cap.server.cleartext, false);
  assert.equal(cap.android.allowMixedContent, false);
  assert.deepEqual(cap.server.allowNavigation, [new URL(config.site).hostname]);
  assert.equal(Auth.isValidSite(config.site), true);
  assert.ok(!cap.server.allowNavigation.some((h) => /google/.test(h)), 'Google opens in the system browser, never the WebView');
  assert.ok(fs.existsSync(path.join(app, 'www', cap.server.errorPath)), 'the offline page exists');
});

test('version and build numbers agree everywhere', () => {
  const version = rootPkg.version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(appPkg.version, version, 'bkesari/package.json');
  assert.equal(config.version, version, 'www/config.js');
  assert.equal(/versionName "([^"]+)"/.exec(gradle)[1], version, 'Android versionName');
  assert.deepEqual([...new Set(buildSettings('MARKETING_VERSION'))], [version], 'iOS MARKETING_VERSION (CFBundleShortVersionString)');
  assert.equal(plistString('CFBundleShortVersionString'), '$(MARKETING_VERSION)');
  assert.equal(plistString('CFBundleVersion'), '$(CURRENT_PROJECT_VERSION)');

  const versionCode = Number(/versionCode (\d+)/.exec(gradle)[1]);
  assert.ok(Number.isInteger(versionCode) && versionCode >= 1);
  assert.deepEqual([...new Set(buildSettings('CURRENT_PROJECT_VERSION'))], [String(versionCode)], 'one build number on both platforms');

  assert.equal(cap.android.appendUserAgent, `bkesariApp/${version} (android)`);
  assert.equal(cap.ios.appendUserAgent, `bkesariApp/${version} (ios)`);

  const readme = read(mobile, 'README.md');
  assert.ok(readme.includes(`| bkesari | \`${version}\` | ${versionCode} |`), 'README.md records the version and build');
});

test('the start screen loads its scripts in order, and every one exists', () => {
  const html = read(app, 'www', 'index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['config.js', 'vendor/capacitor.js', 'vendor/app.js', 'vendor/browser.js', 'js/auth-core.js', 'js/start.js']);
  for (const src of scripts) assert.ok(fs.existsSync(path.join(app, 'www', src)), src);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /min-height:48px/);
  for (const id of ['google', 'email', 'status', 'routes', 'version']) assert.match(html, new RegExp(`id="${id}"`));
  for (const route of ['/', '/access/request', '/account']) assert.match(html, new RegExp(`data-path="${route}"`));

  const offline = read(app, 'www', 'offline.html');
  assert.match(offline, /<meta name="viewport"/);
  assert.match(offline, /lang="mr"/);
  assert.match(offline, /min-height:48px/);
});

test('the vendored Capacitor scripts are the installed ones (npm run vendor after an upgrade)', () => {
  const vendored = {
    'capacitor.js': '@capacitor/core/dist/capacitor.js',
    'app.js': '@capacitor/app/dist/plugin.js',
    'browser.js': '@capacitor/browser/dist/plugin.js',
  };
  for (const [name, source] of Object.entries(vendored)) {
    const installed = fs.readFileSync(require.resolve(source, { paths: [mobile] }), 'utf8');
    assert.equal(read(app, 'www', 'vendor', name), installed, `www/vendor/${name} = ${source}`);
  }
});

test('each app folder lets the Capacitor CLI run there, with plugins installed in mobile/', () => {
  const installed = { ...rootPkg.dependencies };
  const apps = { bkesari: appPkg };
  for (const name of ['ladwani', 'education', 'tasklist']) apps[name] = readJson(mobile, 'apps', name, 'package.json');
  for (const [name, pkg] of Object.entries(apps)) {
    assert.equal(pkg.private, true, name);
    for (const [dep, range] of Object.entries(pkg.dependencies)) {
      assert.equal(installed[dep], range, `${name}: ${dep} is installed by mobile/package.json with the same range`);
    }
  }
  assert.ok(appPkg.dependencies['@capacitor/app'] && appPkg.dependencies['@capacitor/browser'], 'the bkesari app has App and Browser');
  for (const name of ['ladwani', 'education', 'tasklist']) {
    assert.equal(apps[name].dependencies['@capacitor/browser'], undefined, `${name} keeps the plugins it had`);
    assert.equal(apps[name].dependencies['@capacitor/app'], undefined, `${name} keeps the plugins it had`);
  }
});
