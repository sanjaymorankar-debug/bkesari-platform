/**
 * The central login's pure parts: TOTP, passwords, the permission matrix,
 * the redirect allow-list, JWTs and the ATIP-free public menu.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const totp = require('../portal/auth/totp');
const passwords = require('../portal/auth/passwords');
const rbac = require('../portal/auth/rbac');
const jwt = require('../portal/auth/jwt');
const { seal, unseal } = require('../portal/auth/state');
const { hostAllowed, assertAllowedUri } = require('../portal/auth/clients');
const { safeReturn } = require('../portal/auth/routes');
const { tabsFor } = require('../portal/auth/menu-tabs');
const menu = require('../portal/public/shared/menu.js');
const { encrypt, decrypt, deriveKey } = require('../portal/auth/crypto');

test('TOTP matches the RFC 6238 SHA-1 test vectors', () => {
  // RFC 6238 Appendix B, secret "12345678901234567890", 8 digits truncated to 6.
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.codeAt(secret, Math.floor(1234567890 / 30)), '005924');
});

test('a TOTP code is accepted once, within one step either side', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const step = totp.currentStep(now);
  assert.equal(totp.verify(secret, totp.codeAt(secret, step), { nowMs: now }), step);
  assert.equal(totp.verify(secret, totp.codeAt(secret, step - 1), { nowMs: now }), step - 1);
  assert.equal(totp.verify(secret, totp.codeAt(secret, step - 3), { nowMs: now }), null);
  assert.equal(totp.verify(secret, totp.codeAt(secret, step), { nowMs: now, afterStep: step }), null, 'replay refused');
  assert.equal(totp.verify(secret, 'abcdef', { nowMs: now }), null);
});

test('passwords: bcrypt, length rules, and a miss costs a compare', async () => {
  assert.match(passwords.validatePassword('short'), /at least/);
  assert.match(passwords.validatePassword('x'.repeat(73)), /at most/);
  assert.equal(passwords.validatePassword('a perfectly fine passphrase'), null);
  const hash = await passwords.hashPassword('a perfectly fine passphrase');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await passwords.verifyPassword('a perfectly fine passphrase', hash), true);
  assert.equal(await passwords.verifyPassword('wrong passphrase!!', hash), false);
  assert.equal(await passwords.verifyPassword('anything', null), false);
});

test('a USER gets only the features they subscribe to', () => {
  const ev = rbac.evaluate({
    roles: [{ role_code: 'USER', feature_code: '' }],
    subscriptions: [{ feature_code: 'LADWANI', status: 'active' }, { feature_code: 'EDUCATION', status: 'pending' }],
  });
  assert.deepEqual(ev.features, ['LADWANI']);
  assert.deepEqual(ev.permissions, ['ladwani.view', 'ladwani.edit_tree']);
  assert.ok(!ev.permissions.includes('ladwani.moderate'));
});

test('an expired subscription grants nothing and reads as expired', () => {
  const ev = rbac.evaluate({
    roles: [{ role_code: 'USER', feature_code: '' }],
    subscriptions: [{ feature_code: 'TASKLIST', status: 'active', expires_at: '2000-01-01 00:00:00' }],
  });
  assert.deepEqual(ev.features, []);
  assert.equal(ev.subscriptions[0].status, 'expired');
});

test('a MODERATOR moderates one feature only', () => {
  const ev = rbac.evaluate({ roles: [{ role_code: 'USER', feature_code: '' }, { role_code: 'MODERATOR', feature_code: 'AGTCI' }] });
  assert.deepEqual(ev.features, ['AGTCI']);
  assert.ok(ev.permissions.includes('agtci.manage_enquiries'));
  assert.ok(!ev.permissions.some(p => p.startsWith('ladwani.')));
  assert.ok(!ev.permissions.some(p => p.startsWith('admin.')));
});

test('ADMIN administers every feature but cannot manage admins; SUPER_ADMIN can', () => {
  const admin = rbac.evaluate({ roles: [{ role_code: 'ADMIN', feature_code: '' }] });
  assert.deepEqual(admin.features, rbac.FEATURE_CODES);
  assert.ok(admin.permissions.includes('admin.manage_users'));
  assert.ok(!admin.permissions.includes('admin.manage_admins'));
  const owner = rbac.evaluate({ roles: [{ role_code: 'SUPER_ADMIN', feature_code: '' }] });
  assert.ok(owner.permissions.includes('admin.manage_admins'));
});

test('ATIP is not a feature, a permission or a role', () => {
  const everything = JSON.stringify({ f: rbac.FEATURES, p: rbac.ALL_PERMISSIONS, r: rbac.ROLES });
  assert.doesNotMatch(everything, /atip/i);
});

test('the ATIP owner test needs SUPER_ADMIN, the owner email and TOTP, all three', () => {
  const user = { email: 'Owner@Example.com', status: 'ACTIVE' };
  const sa = [{ role_code: 'SUPER_ADMIN' }];
  assert.equal(rbac.isAtipOwner({ user, roles: sa, mfa: true }, 'owner@example.com'), true);
  assert.equal(rbac.isAtipOwner({ user, roles: sa, mfa: false }, 'owner@example.com'), false);
  assert.equal(rbac.isAtipOwner({ user, roles: [{ role_code: 'ADMIN' }], mfa: true }, 'owner@example.com'), false);
  assert.equal(rbac.isAtipOwner({ user: { email: 'admin@example.com' }, roles: sa, mfa: true }, 'owner@example.com'), false);
  assert.equal(rbac.isAtipOwner({ user, roles: sa, mfa: true }, ''), false, 'no owner configured: nobody');
});

test('role changes: nobody changes their own, only the owner touches admins, nobody grants SUPER_ADMIN', () => {
  const admin = { id: 'a' }; const adminRoles = [{ role_code: 'ADMIN' }];
  const owner = { id: 'o' }; const ownerRoles = [{ role_code: 'SUPER_ADMIN' }];
  const user = { id: 'u' }; const userRoles = [{ role_code: 'USER' }];
  assert.match(rbac.roleChangeDenied({ actor: admin, actorRoles: adminRoles, target: admin, targetRoles: adminRoles, role: 'USER' }), /own role/);
  assert.match(rbac.roleChangeDenied({ actor: owner, actorRoles: ownerRoles, target: owner, targetRoles: ownerRoles, role: 'ADMIN' }), /own role/);
  assert.match(rbac.roleChangeDenied({ actor: admin, actorRoles: adminRoles, target: user, targetRoles: userRoles, role: 'ADMIN' }), /Only the owner/);
  assert.match(rbac.roleChangeDenied({ actor: owner, actorRoles: ownerRoles, target: user, targetRoles: userRoles, role: 'SUPER_ADMIN' }), /server/);
  assert.match(rbac.roleChangeDenied({ actor: admin, actorRoles: adminRoles, target: owner, targetRoles: ownerRoles, role: 'USER' }), /owner account/);
  assert.match(rbac.roleChangeDenied({ actor: user, actorRoles: userRoles, target: admin, targetRoles: adminRoles, role: 'USER' }), /Only admins/);
  assert.equal(rbac.roleChangeDenied({ actor: admin, actorRoles: adminRoles, target: user, targetRoles: userRoles, role: 'MODERATOR' }), null);
  assert.equal(rbac.roleChangeDenied({ actor: owner, actorRoles: ownerRoles, target: user, targetRoles: userRoles, role: 'ADMIN' }), null);
});

test('redirect URIs: bkesari.com and agtci.com only, https, exact hosts', () => {
  const prod = { allowLocalhost: false };
  for (const ok of ['bkesari.com', 'dev.bkesari.com', 'agtci.com', 'test.agtci.com']) assert.ok(hostAllowed(ok, prod), ok);
  for (const bad of ['gokesari.com', 'test.gokesari.com', 'evilbkesari.com', 'bkesari.com.evil.net', 'agtci.co', 'localhost']) {
    assert.ok(!hostAllowed(bad, prod), bad);
  }
  assert.throws(() => assertAllowedUri('http://agtci.com/cb', prod), /https/);
  assert.throws(() => assertAllowedUri('https://user:pw@agtci.com/cb', prod));
  assert.throws(() => assertAllowedUri('https://agtci.com/cb#x', prod));
  assert.equal(assertAllowedUri('https://agtci.com/auth/callback', prod), 'https://agtci.com/auth/callback');
  assert.ok(hostAllowed('localhost', { allowLocalhost: true }));
});

test('return_to only ever points back into this site', () => {
  assert.equal(safeReturn('/milk/orders?x=1'), '/milk/orders?x=1');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/ok\r\nSet-Cookie: x', '']) {
    assert.equal(safeReturn(bad, '/'), '/', JSON.stringify(bad));
  }
  assert.equal(safeReturn('/auth/logout', '/'), '/');
});

test('JWT sign/verify round trip, and a tampered token fails', () => {
  const key = jwt.loadKey(jwt.generatePem());
  const token = jwt.sign({ sub: 'x', n: 1 }, key);
  assert.equal(jwt.verify(token, key.publicKey).payload.sub, 'x');
  const [h, , s] = token.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'y' })).toString('base64url')}.${s}`;
  assert.throws(() => jwt.verify(forged, key.publicKey), /signature/);
  assert.equal(key.jwk.kid, jwt.verify(token, key.publicKey).header.kid);
});

test('sealed state rejects tampering and expiry; encryption round-trips', () => {
  const k = deriveKey('a'.repeat(40), 'x');
  const s = seal(k, { a: 1 }, 60);
  assert.deepEqual(unseal(k, s), { a: 1 });
  assert.equal(unseal(k, s.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))), null);
  assert.equal(unseal(k, seal(k, { a: 1 }, -1)), null);
  assert.equal(decrypt(k, encrypt(k, 'JBSWY3DPEHPK3PXP')), 'JBSWY3DPEHPK3PXP');
});

test('the public menu file and the welcome page never mention ATIP', () => {
  for (const file of ['portal/public/shared/menu.js', 'portal/public/index.html']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(text, /atip/i, `${file} mentions ATIP`);
  }
  assert.ok(!menu.TABS.some(t => /atip/i.test(t.path)));
});

test('menu tabs: logged out sees the catalogue, users see what they have, only the owner sees ATIP', () => {
  const asUser = (features, atip = false) => tabsFor({ evaluation: { features }, atip, user: {} });
  assert.deepEqual(tabsFor(null).map(t => t.path), menu.TABS.map(t => t.path));
  assert.deepEqual(asUser(['LADWANI']).map(t => t.path), ['/global-warming/', '/ladwani/', '/driving-simulator/']);
  assert.ok(!JSON.stringify(asUser(rbac.FEATURE_CODES)).match(/atip/i), 'even an admin with every feature');
  const owner = asUser(rbac.FEATURE_CODES, true).map(t => t.path);
  assert.ok(owner.includes('/atip/'));
  assert.equal(owner.indexOf('/atip/'), owner.indexOf('/driving-simulator/') - 1);
});
