/**
 * Password hashing: bcrypt, cost 12, via bcryptjs (pure JavaScript, so there
 * is nothing to compile on shared hosting).
 *
 * bcrypt only reads the first 72 bytes of its input. Rather than silently
 * ignoring the rest, longer passwords are refused.
 */
const bcrypt = require('bcryptjs');

const COST = 12;
const MIN_LENGTH = 10;
const MAX_BYTES = 72;

// Compared against when the account does not exist, so a miss costs as long
// as a hit and response times do not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-placeholder', COST);

function validatePassword(password) {
  const s = String(password ?? '');
  if (s.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (Buffer.byteLength(s, 'utf8') > MAX_BYTES) return `Use at most ${MAX_BYTES} bytes (about ${MAX_BYTES} plain characters).`;
  if (/^\s|\s$/.test(s)) return 'The password cannot start or end with a space.';
  return null;
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), COST);
}

async function verifyPassword(password, hash) {
  const target = hash || DUMMY_HASH;
  const ok = await bcrypt.compare(String(password ?? ''), target);
  return Boolean(hash) && ok;
}

module.exports = { validatePassword, hashPassword, verifyPassword, MIN_LENGTH, COST };
