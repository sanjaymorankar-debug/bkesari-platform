/**
 * Sealed values for cookies that must survive a round trip through another
 * site (Google sign-in): JSON, an expiry, and an HMAC. Tamper-evident, not
 * secret, so nothing confidential goes in.
 */
const { hmac } = require('./crypto');
const { safeEqual } = require('./util');

function seal(key, value, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ v: value, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac(key, body)}`;
}

function unseal(key, sealed) {
  const [body, sig] = String(sealed || '').split('.');
  if (!body || !sig || !safeEqual(sig, hmac(key, body))) return null;
  try {
    const { v, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!exp || exp * 1000 < Date.now()) return null;
    return v;
  } catch { return null; }
}

module.exports = { seal, unseal };
