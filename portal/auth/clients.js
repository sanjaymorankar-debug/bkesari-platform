/**
 * OAuth / OIDC clients, and the redirect-URI allow-list.
 *
 * Two kinds:
 *   oidc      a relying party on another site (agtci.com), authorization code + PKCE
 *   internal  a bkesari project that may introspect the session cookie
 *
 * Client secrets are 256-bit random values, stored as SHA-256 and shown once.
 */
const { nowUtc, randomToken, sha256hex, safeEqual } = require('./util');

/**
 * Hosts a redirect may ever point at. gokesari.com is deliberately not here,
 * and cannot be: suffix matching is on a label boundary.
 */
function hostAllowed(hostname, { allowLocalhost }) {
  const h = String(hostname || '').toLowerCase();
  if (allowLocalhost && (h === 'localhost' || h === '127.0.0.1')) return true;
  return ['bkesari.com', 'agtci.com'].some(d => h === d || h.endsWith(`.${d}`));
}

/** Throws unless `uri` is an absolute https URL on an allowed host (http for localhost in dev). */
function assertAllowedUri(uri, opts) {
  let u;
  try { u = new URL(uri); } catch { throw new Error(`Not a URL: ${uri}`); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error(`Must be https: ${uri}`);
  if (u.username || u.password || u.hash) throw new Error(`No credentials or fragment allowed: ${uri}`);
  if (!hostAllowed(u.hostname, opts)) throw new Error(`Host not on the allow-list (bkesari.com, agtci.com): ${uri}`);
  return u.toString();
}

function parseList(text) {
  try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function createClients({ db, config }) {
  const opts = { allowLocalhost: config.allowLocalhostRedirects };

  async function get(clientId) {
    if (!clientId) return null;
    const row = await db.get('SELECT * FROM auth_oauth_clients WHERE client_id = ? AND active = 1', [String(clientId)]);
    if (!row) return null;
    return { ...row, redirect_uris: parseList(row.redirect_uris), post_logout_redirect_uris: parseList(row.post_logout_redirect_uris) };
  }

  /** Client authentication: HTTP Basic (preferred) or client_id/client_secret in the body. */
  async function authenticate(req, { kind } = {}) {
    let id, secret;
    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const i = decoded.indexOf(':');
      if (i > 0) {
        id = decodeURIComponent(decoded.slice(0, i));
        secret = decodeURIComponent(decoded.slice(i + 1));
      }
    } else if (req.body && req.body.client_id && req.body.client_secret) {
      id = req.body.client_id; secret = req.body.client_secret;
    }
    const client = await get(id);
    // Compare even when the client is unknown, so timing says nothing.
    const ok = safeEqual(sha256hex(secret || ''), client ? client.secret_hash : sha256hex('no-such-client'));
    if (!client || !ok) return null;
    if (kind && client.kind !== kind) return null;
    return client;
  }

  async function register({ clientId, name, kind, tier, feature = null, redirectUris = [], postLogoutRedirectUris = [], backchannelLogoutUri = null }) {
    if (!/^[a-z0-9][a-z0-9_.-]{2,79}$/.test(clientId || '')) throw new Error('client id: 3-80 of a-z 0-9 _ . -');
    if (!['oidc', 'internal'].includes(kind)) throw new Error('kind must be oidc or internal');
    if (!['dev', 'test', 'prod'].includes(tier)) throw new Error('tier must be dev, test or prod');
    const redirects = redirectUris.map(u => assertAllowedUri(u, opts));
    const postLogout = postLogoutRedirectUris.map(u => assertAllowedUri(u, opts));
    const backchannel = backchannelLogoutUri ? assertAllowedUri(backchannelLogoutUri, opts) : null;
    if (kind === 'oidc' && !redirects.length) throw new Error('an oidc client needs at least one redirect URI');
    const secret = randomToken(32);
    await db.run(`INSERT INTO auth_oauth_clients (client_id, name, secret_hash, kind, tier, feature_code, redirect_uris,
      post_logout_redirect_uris, backchannel_logout_uri, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
    [clientId, name || clientId, sha256hex(secret), kind, tier, feature, JSON.stringify(redirects), JSON.stringify(postLogout), backchannel, nowUtc()]);
    return { clientId, secret };
  }

  async function rotateSecret(clientId) {
    const secret = randomToken(32);
    const r = await db.run('UPDATE auth_oauth_clients SET secret_hash = ? WHERE client_id = ?', [sha256hex(secret), clientId]);
    if (!r.changes) throw new Error(`no client ${clientId}`);
    return secret;
  }

  async function list() {
    return db.all('SELECT client_id, name, kind, tier, feature_code, redirect_uris, post_logout_redirect_uris, backchannel_logout_uri, active, created_at FROM auth_oauth_clients ORDER BY client_id');
  }

  async function withBackchannel() {
    const rows = await db.all("SELECT client_id, backchannel_logout_uri FROM auth_oauth_clients WHERE active = 1 AND kind = 'oidc' AND backchannel_logout_uri IS NOT NULL");
    return rows.filter(r => r.backchannel_logout_uri);
  }

  return { get, authenticate, register, rotateSecret, list, withBackchannel, hostAllowed: (h) => hostAllowed(h, opts), assertAllowedUri: (u) => assertAllowedUri(u, opts) };
}

module.exports = { createClients, hostAllowed, assertAllowedUri };
