/* ============================================================
   Built-in administrators: smorankar and sonalimorankar.

   Two owner accounts in every project, each one an account of that
   project's own (D-036): the hub admin at /admin (owner, which opens ATIP),
   TaskList (owner), LadWani (admin) and Education (system admin). They sign
   in on each project's own sign-in page with their username and one shared
   password, and each project keeps its own session for them, like for
   anyone else. Their addresses, <name>@builtin.bkesari.com, are reserved:
   nobody can sign up with one, get a code for one or put one on an account.

   THE PASSWORD IS NEVER IN THIS REPOSITORY. The repository is public, so a
   password or hash written here would let anyone sign in as an owner. The
   servers read:

     BUILTIN_ADMIN_PASSWORD_HASH    scrypt:N:r:p:salt:key   the hub process
                                    (hub admin, TaskList, LadWani)
     BUILTIN_ADMIN_PASSWORD_BCRYPT  $2y$...                 Education's .env
                                    (PHP has no scrypt)

   both printed by `node scripts/hash-builtin-admin-password.js`. Unset (or
   not a valid hash): the built-in sign-in is off in that project. Changing
   the password signs nobody out by itself; each project's sessions end as
   that project's own sessions do.

   This module holds what every project shares: the names, the address
   domain, and making and checking the scrypt hash.
   ============================================================ */

const crypto = require('crypto');

const USERNAMES = Object.freeze(['smorankar', 'sonalimorankar']);
const EMAIL_DOMAIN = 'builtin.bkesari.com';

// scrypt cost for new hashes: 2^15 x 8 x 1 is about 32 MiB and ~0.1 s per check.
const DEFAULT_COST = Object.freeze({ N: 2 ** 15, r: 8, p: 1 });
const KEY_BYTES = 32;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const maxmem = (N, r) => 256 * N * r;

function scrypt(password, salt, len, opts) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** A scrypt hash for BUILTIN_ADMIN_PASSWORD_HASH. Colons, not `$`, so no env parser expands it. */
async function hashPassword(password, { N, r, p } = DEFAULT_COST, salt = crypto.randomBytes(16)) {
  const key = await scrypt(String(password), salt, KEY_BYTES, { N, r, p, maxmem: maxmem(N, r) });
  return ['scrypt', N, r, p, b64u(salt), b64u(key)].join(':');
}

/** The parts of a stored hash, or null when it is not one this module made. */
function parseHash(value) {
  const parts = String(value || '').trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map((v) => (/^\d{1,7}$/.test(v) ? Number(v) : 0));
  const salt = Buffer.from(parts[4], 'base64url');
  const key = Buffer.from(parts[5], 'base64url');
  const powerOfTwo = N > 1 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N < 2 ** 14 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  if (salt.length < 16 || key.length < KEY_BYTES) return null;
  return { N, r, p, salt, key };
}

async function verifyPassword(password, parsed) {
  const got = await scrypt(String(password), parsed.salt, parsed.key.length,
    { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: maxmem(parsed.N, parsed.r) });
  return crypto.timingSafeEqual(got, parsed.key);
}

/** The canonical username, or null when it is not one of the built-in accounts. */
function normalizeUsername(value) {
  const name = String(value ?? '').trim().toLowerCase();
  return USERNAMES.includes(name) ? name : null;
}

/** True for an address on the reserved domain, however it is typed. */
function isReservedEmail(email) {
  return String(email ?? '').trim().toLowerCase().endsWith(`@${EMAIL_DOMAIN}`);
}

module.exports = { hashPassword, parseHash, verifyPassword, normalizeUsername, isReservedEmail, USERNAMES, EMAIL_DOMAIN };
