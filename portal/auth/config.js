/**
 * Reads the auth service's settings from the environment, once.
 *
 * Everything is off unless AUTH_ENABLED is set, so deploying this code changes
 * nothing on a tier until that tier is configured.
 *
 * Outside dev, a missing secret is a startup error rather than a quietly
 * generated stand-in: an ephemeral signing key would log everyone out and
 * break every agtci.com session on each restart.
 */
const { resolveEnv } = require('../public/shared/menu.js');
const jwt = require('./jwt');
const { deriveKey } = require('./crypto');
const { randomToken } = require('./util');

function flag(v, fallback = false) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function list(v) {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function loadConfig(env = process.env, { log = console } = {}) {
  const enabled = flag(env.AUTH_ENABLED);
  const publicUrl = String(env.AUTH_PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');
  let host = 'localhost';
  try { host = new URL(publicUrl).hostname; } catch { throw new Error(`AUTH_PUBLIC_URL is not a URL: ${publicUrl}`); }
  const tier = resolveEnv(host, env.APP_ENV);
  const secure = env.AUTH_COOKIE_SECURE !== undefined && env.AUTH_COOKIE_SECURE !== ''
    ? flag(env.AUTH_COOKIE_SECURE)
    : publicUrl.startsWith('https://');
  const problems = [];

  let secret = env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (enabled && tier !== 'dev') problems.push('AUTH_SECRET must be set (at least 32 characters).');
    if (enabled && tier === 'dev') log.warn('AUTH_SECRET not set: using a random one; sessions end when the process restarts.');
    secret = randomToken(32);
  }

  let pem = env.AUTH_OIDC_PRIVATE_KEY ? String(env.AUTH_OIDC_PRIVATE_KEY).replace(/\\n/g, '\n') : '';
  if (!pem) {
    if (enabled && tier !== 'dev') problems.push('AUTH_OIDC_PRIVATE_KEY must be set (generate with: npm run auth -- keygen).');
    pem = jwt.generatePem();
  }
  const signingKey = jwt.loadKey(pem);

  const cookieDomain = env.AUTH_COOKIE_DOMAIN ? String(env.AUTH_COOKIE_DOMAIN).trim() : '';
  let cookieName = env.AUTH_COOKIE_NAME ? String(env.AUTH_COOKIE_NAME).trim() : '';
  if (!cookieName) cookieName = secure && !cookieDomain ? '__Host-bk_sso' : 'bk_sso';
  if (cookieName.startsWith('__Host-') && (cookieDomain || !secure)) {
    problems.push('A __Host- cookie needs AUTH_COOKIE_SECURE and no AUTH_COOKIE_DOMAIN.');
  }

  const ownerEmail = String(env.AUTH_OWNER_EMAIL || '').trim().toLowerCase();
  if (enabled && !ownerEmail) log.warn('AUTH_OWNER_EMAIL not set: ATIP answers 404 to everyone.');

  const smtp = env.SMTP_HOST ? {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: flag(env.SMTP_SECURE, Number(env.SMTP_PORT) === 465),
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
    from: env.SMTP_FROM || env.SMTP_USER || `no-reply@${host}`,
  } : null;
  if (enabled && !smtp && tier !== 'dev') log.warn('SMTP_HOST not set: verification and reset emails cannot be delivered.');

  if (problems.length && enabled) {
    throw new Error(`Auth is enabled but misconfigured:\n  - ${problems.join('\n  - ')}`);
  }

  return Object.freeze({
    enabled,
    tier,
    publicUrl,
    issuer: `${publicUrl}/auth`,
    secure,
    cookieName,
    cookieDomain,
    csrfCookieName: secure && !cookieDomain ? '__Host-bk_csrf' : 'bk_csrf',
    ownerEmail,
    keys: {
      csrf: deriveKey(secret, 'csrf'),
      encryption: deriveKey(secret, 'encryption'),
      state: deriveKey(secret, 'state'),
    },
    signingKey,
    google: env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET
      ? { clientId: env.AUTH_GOOGLE_CLIENT_ID, clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET }
      : null,
    smtp,
    // Which hub tabs the edge gate covers. Each can be rolled out separately.
    gateTabs: env.AUTH_GATE_TABS !== undefined ? list(env.AUTH_GATE_TABS) : ['milk', 'edu', 'ladwani', 'tasks'],
    // Paths under a gated tab that machines call (cron, payment webhooks) and
    // that carry their own credentials. Matched as prefixes after the tab path.
    gateBypass: env.AUTH_GATE_BYPASS !== undefined ? list(env.AUTH_GATE_BYPASS) : [
      '/milk/api/cron/', '/milk/api/webhooks/',
      '/ladwani/api/cron/',
      '/milk/_next/static/', '/ladwani/_next/static/', '/edu/build/',
    ],
    privacyVersion: env.AUTH_PRIVACY_VERSION || '2026-10-09',
    autoMigrate: flag(env.AUTH_AUTO_MIGRATE, true),
    allowLocalhostRedirects: tier === 'dev',
    session: {
      idleSeconds: Number(env.AUTH_SESSION_IDLE_SECONDS || 2 * 3600),
      absoluteSeconds: Number(env.AUTH_SESSION_ABSOLUTE_SECONDS || 7 * 24 * 3600),
      ownerAbsoluteSeconds: Number(env.AUTH_OWNER_SESSION_SECONDS || 12 * 3600),
    },
    trustProxy: env.AUTH_TRUST_PROXY || 'loopback, linklocal, uniquelocal',
  });
}

module.exports = { loadConfig, flag, list };
