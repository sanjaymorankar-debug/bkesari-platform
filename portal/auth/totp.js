/**
 * TOTP (RFC 6238): 30-second steps, 6 digits, HMAC-SHA1, as every
 * authenticator app expects. A code is accepted for the current step and one
 * step either side, and never twice: the caller stores the step that was used
 * and passes it back as `afterStep`.
 */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, step) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 15;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 1e6).padStart(6, '0');
}

function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP);
}

/** Returns the matched step, or null. */
function verify(secret, code, { afterStep = null, nowMs = Date.now(), window = 1 } = {}) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const now = currentStep(nowMs);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (afterStep !== null && afterStep !== undefined && step <= Number(afterStep)) continue;
    const expected = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return step;
  }
  return null;
}

function otpauthUri(secret, account, issuer = 'bkesari') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

module.exports = { generateSecret, codeAt, currentStep, verify, otpauthUri, base32Encode, base32Decode };
