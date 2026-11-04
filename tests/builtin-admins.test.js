'use strict';
/* portal/builtin-admins.js: the names, the reserved domain and the scrypt hash
   every project checks the built-in administrators' password against (D-036).
   Each project's own sign-in is tested in builtin-admins.pg.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  hashPassword, parseHash, verifyPassword, normalizeUsername, isReservedEmail, USERNAMES, EMAIL_DOMAIN,
} = require('../portal/builtin-admins.js');

const PASSWORD = 'test-only-builtin-password-1';
const COST = { N: 2 ** 14, r: 8, p: 1 }; // the lowest cost parseHash accepts: keeps the suite quick

test('the two built-in accounts are smorankar and sonalimorankar, on a reserved domain', () => {
  assert.deepEqual(USERNAMES, ['smorankar', 'sonalimorankar']);
  assert.equal(EMAIL_DOMAIN, 'builtin.bkesari.com');
  assert.equal(normalizeUsername('  SMorankar '), 'smorankar');
  for (const not of ['smorankar@builtin.bkesari.com', 'admin', '', null, undefined]) assert.equal(normalizeUsername(not), null, String(not));
  for (const yes of ['smorankar@builtin.bkesari.com', ' Anyone@Builtin.Bkesari.com ']) assert.equal(isReservedEmail(yes), true, yes);
  assert.equal(isReservedEmail('asha@example.com'), false);
});

test('the repository carries no password or hash for them', () => {
  // A public repository: the hashes come from each server's environment only.
  for (const f of ['portal/builtin-admins.js', 'portal/project-auth.js', '.env.example', 'DEPLOY.md']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{32,}/, f);
    assert.doesNotMatch(src, /\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/, f);
  }
});

test('a hash round-trips, and a malformed or too-cheap one is refused', async () => {
  const h = await hashPassword(PASSWORD, COST);
  assert.match(h, /^scrypt:16384:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.equal(h.includes('$'), false, 'no $ for an env parser to expand');
  const parsed = parseHash(h);
  assert.equal(await verifyPassword(PASSWORD, parsed), true);
  assert.equal(await verifyPassword(`${PASSWORD}x`, parsed), false);
  for (const bad of ['', 'plain-text-password', h.replace(':16384:', ':1024:'), h.replace(':16384:', ':16385:'), h.replace(/:[^:]+$/, ':AAAA'), `bcrypt${h.slice(6)}`]) {
    assert.equal(parseHash(bad), null, bad);
  }
});

test('the hash script prints both values: scrypt for the hub, bcrypt for Education', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/hash-builtin-admin-password.js')], { input: PASSWORD, encoding: 'utf8' });
  const [scryptLine, bcryptLine] = out.trim().split('\n');
  assert.match(scryptLine, /^BUILTIN_ADMIN_PASSWORD_HASH=scrypt:32768:8:1:/);
  assert.ok(parseHash(scryptLine.split('=')[1]));
  const m = bcryptLine.match(/^BUILTIN_ADMIN_PASSWORD_BCRYPT='(\$2y\$12\$[./A-Za-z0-9]{53})'$/);
  assert.ok(m, bcryptLine.replace(/\$2y\$12\$.*/, '$2y$12$…'));
  // PHP's password_verify reads $2y$; bcryptjs reads the same hash as $2b$.
  assert.equal(require('bcryptjs').compareSync(PASSWORD, m[1].replace(/^\$2y\$/, '$2b$')), true);
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '../scripts/hash-builtin-admin-password.js')], { input: 'short', stdio: 'pipe' }));
});
