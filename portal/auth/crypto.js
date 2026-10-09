/**
 * Keys derived from AUTH_SECRET, and authenticated encryption for the few
 * secrets that must be stored reversibly (TOTP seeds).
 */
const crypto = require('crypto');

function deriveKey(secret, purpose) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.alloc(0), `bkesari-auth:${purpose}`, 32));
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(String(value)).digest('base64url');
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

function decrypt(key, blob) {
  const [v, iv, tag, ct] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unrecognised ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { deriveKey, hmac, encrypt, decrypt };
