/**
 * Enforcement at the hub, before a request reaches any project.
 *
 * edge()      for every gated tab (/milk/, /edu/, /ladwani/, /tasks/):
 *               logged out        page → sign-in redirect   API → 401
 *               not subscribed    page → "Subscribe / request access" (403), never the content
 *                                 API  → 403
 *             TaskList additionally needs tasklist.view to read and
 *             tasklist.manage to write.
 *
 * atip()      the owner gate. Anyone but the owner gets exactly what an
 *             unknown path gets: the request leaves the ATIP routes and falls
 *             through to the hub's ordinary 404.
 *
 * This is the first of two layers. Each project validates the session
 * again itself, because each is also reachable on its own origin.
 */
const express = require('express');
const rbac = require('./rbac');

const TAB_FEATURE = Object.freeze({ milk: 'MILK_DAIRY', edu: 'EDUCATION', ladwani: 'LADWANI', tasks: 'TASKLIST' });

function isApiRequest(req, tabPath) {
  const rest = req.path.slice(tabPath.length - 1);
  if (/^\/api(\/|$)/.test(rest) || /\/api\//.test(rest)) return true;
  if (/^\/livewire\//.test(rest)) return true;
  const accept = String(req.headers.accept || '');
  if (req.headers['x-requested-with'] || req.headers['x-livewire']) return true;
  return accept.includes('application/json') && !accept.includes('text/html');
}

function sameOrigin(req, publicUrl) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // non-browser clients; the cookie is SameSite=Lax regardless
  try { return new URL(origin).origin === new URL(publicUrl).origin; } catch { return false; }
}

function createGate({ config, resolve, renderSubscribe, audit }) {
  const tabs = config.gateTabs
    .filter(name => TAB_FEATURE[name])
    .map(name => ({ name, path: `/${name}/`, base: `/${name}`, feature: TAB_FEATURE[name] }));

  function tabFor(path) {
    return tabs.find(t => path === t.base || path.startsWith(t.path)) || null;
  }

  function bypassed(path) {
    return config.gateBypass.some(prefix => path.startsWith(prefix));
  }

  async function edge(req, res, next) {
    try {
      const tab = tabFor(req.path);
      if (!tab || bypassed(req.path)) return next();
      const resolved = await resolve(req);
      const api = isApiRequest(req, tab.path);
      res.set('Cache-Control', 'private, no-store');
      if (!resolved) {
        if (api) return res.status(401).json({ error: 'login_required', login: '/auth/login' });
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(401).type('text').send('Sign in first.');
        return res.redirect(302, `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`);
      }
      if (!resolved.evaluation.features.includes(tab.feature)) {
        if (api) return res.status(403).json({ error: 'subscription_required', feature: tab.feature, subscribe: `/auth/subscribe/${tab.feature.toLowerCase()}` });
        return renderSubscribe(req, res, rbac.featureByCode(tab.feature), resolved);
      }
      if (tab.name === 'tasks') {
        const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        const need = write ? 'tasklist.manage' : 'tasklist.view';
        if (write && !sameOrigin(req, config.publicUrl)) return res.status(403).json({ error: 'cross_origin' });
        if (!resolved.evaluation.permissions.includes(need)) {
          return res.status(403).json({ error: 'forbidden', permission: need });
        }
      }
      next();
    } catch (err) { next(err); }
  }

  /**
   * A router for the ATIP routes. Mount the ATIP handlers on it AFTER this
   * gate; a non-owner leaves the router with next('router') and gets the
   * same 404 as any path that does not exist.
   *
   * `machine(req)` returns true for a request that carries the ATIP machine's
   * own credential (the snapshot upload); it is let through to its handler,
   * which checks that credential itself, and to nothing else.
   */
  function atipRouter({ machine = () => false } = {}) {
    const router = express.Router({ caseSensitive: false });
    router.use(async (req, res, next) => {
      try {
        if (!/^\/atip(\/|$)/i.test(req.path)) return next('router');
        if (machine(req)) return next();
        const resolved = await resolve(req);
        if (resolved && resolved.atip) {
          res.set('Cache-Control', 'no-store');
          await audit.record({ action: 'ATIP_ACCESS', actorId: resolved.user.id, subjectId: resolved.user.id, detail: { method: req.method, path: req.originalUrl.slice(0, 200) }, req });
          return next();
        }
        // The owner, signed in but without TOTP on this session, is asked for
        // a code. The step-up page itself never names ATIP.
        if (resolved && !resolved.mfa && rbac.isAtipOwner({ ...resolved, mfa: true }, config.ownerEmail) && req.method === 'GET') {
          return res.redirect(302, `/auth/step-up?return_to=${encodeURIComponent(req.originalUrl)}`);
        }
        return next('router');
      } catch (err) { next(err); }
    });
    return router;
  }

  return { edge, atipRouter, tabFor, isApiRequest };
}

module.exports = { createGate, TAB_FEATURE };
