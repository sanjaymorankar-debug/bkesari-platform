/**
 * Just enough JWT for an OpenID provider: RS256 signing with the provider's
 * key, verification, and the public JWK for discovery. Node's crypto only.
 */
const crypto = require('crypto');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function loadKey(pem) {
  const privateKey = crypto.createPrivateKey(pem);
  const publicKey = crypto.createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  // RFC 7638 thumbprint as the key id, so a rotated key gets a new kid.
  const kid = crypto.createHash('sha256').update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).digest('base64url');
  return { privateKey, publicKey, kid, jwk: { ...jwk, kid, use: 'sig', alg: 'RS256' } };
}

function generatePem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

function sign(payload, key, header = {}) {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header });
  const body = b64(payload);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/** Returns { header, payload } or throws. Checks the signature only. */
function verify(token, publicKey) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error('Unexpected alg');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('Bad signature');
  return { header, payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()) };
}

module.exports = { loadKey, generatePem, sign, verify };
