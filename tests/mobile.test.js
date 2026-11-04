/**
 * The Android/iOS wrappers (mobile/): each app opens its own project on
 * bkesari.com over https, stays on bkesari.com, and has an offline screen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const menu = require('../portal/public/shared/menu.js');

const dir = path.join(__dirname, '..', 'mobile', 'apps');
const APPS = { ladwani: 'ladwani', education: 'education', tasklist: 'tasklist' };

test('one app per project, each opening that project and nothing else', () => {
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(APPS).sort());
  const ids = new Set();
  for (const [app, key] of Object.entries(APPS)) {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, app, 'capacitor.config.json'), 'utf8'));
    assert.match(cfg.appId, /^com\.bkesari\.[a-z]+$/);
    assert.ok(!ids.has(cfg.appId), 'app IDs are unique');
    ids.add(cfg.appId);
    const tab = menu.TABS.find((t) => t.key === key);
    assert.equal(cfg.server.url, `https://bkesari.com${tab.path}`, `${app} opens its own project on production`);
    assert.equal(cfg.server.cleartext, false);
    assert.deepEqual(cfg.server.allowNavigation, ['bkesari.com']);
    assert.equal(cfg.android.allowMixedContent, false);
    const offline = fs.readFileSync(path.join(dir, app, cfg.webDir, 'index.html'), 'utf8');
    assert.match(offline, /<meta name="viewport"/);
    assert.match(offline, /lang="mr"/);
    assert.match(offline, /min-height:48px/);
  }
});
