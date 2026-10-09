/**
 * The central auth service for bkesari.com, assembled.
 *
 *   const auth = await createAuth({ env });     // null when AUTH_ENABLED is off
 *   app.use(auth.gate.edge)                     // before the proxy
 *   app.use('/auth', express.urlencoded(...), auth.router)
 *
 * See docs/auth/DESIGN.md for the design, and the tests under tests/auth*.
 */
const express = require('express');
const createDb = require('../db');
const { loadConfig } = require('./config');
const { migrate } = require('./migrate');
const { createService } = require('./service');
const { createAudit } = require('./audit');
const { createMailer } = require('./mailer');
const { createCsrf } = require('./csrf');
const { createLimiter } = require('./ratelimit');
const { createClients } = require('./clients');
const { createOidc } = require('./oidc');
const { createGoogle } = require('./google');
const { createGate } = require('./gate');
const { createAdmin } = require('./admin');
const { createRoutes } = require('./routes');
const views = require('./views');
const { parseCookies, serializeCookie, appendCookie } = require('./util');

/**
 * Builds the service. Returns null when auth is not enabled, so callers can
 * keep their pre-existing behaviour with a single `if (auth)`.
 *
 * `db` may be passed in (tests); otherwise one is opened from AUTH_DB_*.
 */
async function createAuth({ env = process.env, db = null, log = console, mailer = null, fetchImpl } = {}) {
  const config = loadConfig(env, { log });
  if (!config.enabled) return null;

  const database = db || await createDb({ env, prefix: 'AUTH_', schema: false });
  if (config.autoMigrate) await migrate(database, { log });

  const audit = createAudit(database, { log });
  const mail = mailer || createMailer(config, { log });
  const service = createService({ db: database, config, mailer: mail, audit, log });
  const csrf = createCsrf(config);
  const limiter = createLimiter();
  const clients = createClients({ db: database, config });

  const cookies = {
    setSession(res, token) {
      appendCookie(res, serializeCookie(config.cookieName, token, {
        secure: config.secure, sameSite: 'Lax', path: '/', domain: config.cookieDomain || undefined,
        maxAge: config.session.absoluteSeconds,
      }));
    },
    clearSession(res) {
      appendCookie(res, serializeCookie(config.cookieName, '', {
        secure: config.secure, sameSite: 'Lax', path: '/', domain: config.cookieDomain || undefined, maxAge: 0,
      }));
    },
  };

  /** The session behind this request's cookie, resolved once per request. */
  async function resolve(req) {
    if (req._bkResolved !== undefined) return req._bkResolved;
    const token = parseCookies(req.headers.cookie)[config.cookieName];
    req._bkResolved = token ? await service.resolveToken(token) : null;
    return req._bkResolved;
  }

  const ctx = { config, db: database, service, audit, csrf, limiter, clients, cookies, views, resolve, log };
  ctx.oidc = createOidc(ctx);
  ctx.google = config.google ? createGoogle({ config, fetchImpl }) : null;
  ctx.admin = createAdmin(ctx);
  const routes = createRoutes(ctx);
  const gate = createGate({ config, resolve, audit, renderSubscribe: (req, res, feature, resolved) => routes.renderSubscribe(req, res, feature, resolved, 403) });

  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '50kb' }));
  router.use(routes.router);

  return { config, db: database, service, audit, clients, mailer: mail, resolve, router, gate, oidc: ctx.oidc, cookies, csrf, limiter };
}

module.exports = { createAuth };
