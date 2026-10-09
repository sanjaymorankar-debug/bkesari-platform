/**
 * The admin panel: users, roles, subscriptions, audit log.
 *
 * Every route needs an admin permission AND a session that passed TOTP. The
 * rules about who may change whom live in rbac.roleChangeDenied() and the
 * service, not here, so the panel cannot be the weak point.
 */
const express = require('express');
const rbac = require('./rbac');
const { escapeHtml: e } = require('./util');

function createAdmin({ service, audit, csrf, views, config }) {
  const router = express.Router();

  function send(req, res, page, status = 200) {
    res.status(status).set('Content-Security-Policy', views.CSP).set('Cache-Control', 'no-store').type('html')
      .send(views.layout({ ...page, req, resolved: req.bkAuth, env: config.tier, wide: true }));
  }

  // Gate for the whole panel.
  router.use((req, res, next) => {
    const r = req.bkAuth;
    if (!r) return res.redirect(302, `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`);
    if (!r.evaluation.permissions.includes('admin.view_users')) {
      return send(req, res, views.pages.message({ title: 'Not allowed', text: 'This area is for admins.', kind: 'error' }), 403);
    }
    if (!r.mfa) {
      if (req.method !== 'GET') return res.status(403).type('text').send('Confirm with your authenticator code first.');
      return res.redirect(302, `/auth/step-up?return_to=${encodeURIComponent(req.originalUrl)}`);
    }
    next();
  });

  const can = (req, p) => req.bkAuth.evaluation.permissions.includes(p);
  const pill = (s) => `<span class="pill ${e(s)}">${e(s)}</span>`;
  const back = (id, msg, err) => `/auth/admin/users/${encodeURIComponent(id)}?${err ? 'error' : 'info'}=${encodeURIComponent(msg)}`;

  router.get('/', async (req, res, next) => {
    try {
      const q = String(req.query.q || '').slice(0, 100);
      const [users, pending] = await Promise.all([service.listUsers({ q, limit: 100 }), service.pendingRequests()]);
      const token = csrf.token(req, res);
      const pendingRows = pending.map(p => `<tr><td><a href="/auth/admin/users/${e(p.user_id)}">${e(p.email)}</a></td><td>${e(rbac.featureByCode(p.feature_code)?.name || p.feature_code)}</td>
        <td>${e(p.requested_at || '')}</td><td>${e(p.note || '')}</td><td>${can(req, 'admin.manage_subscriptions') ? `
        <form method="post" action="/auth/admin/users/${e(p.user_id)}/subscriptions" class="row">${`<input type="hidden" name="_csrf" value="${e(token)}">`}
          <input type="hidden" name="feature" value="${e(p.feature_code)}"><input type="hidden" name="return" value="list">
          <input type="date" name="expires_at" aria-label="Expiry (optional)" style="width:auto">
          <button name="action" value="approve">Approve</button><button name="action" value="revoke" class="secondary">Decline</button></form>` : ''}</td></tr>`).join('');
      const userRows = users.map(u => `<tr><td><a href="/auth/admin/users/${e(u.id)}">${e(u.email)}</a><br><span class="muted">${e(u.name || '')}</span></td>
        <td>${u.roles.map(r => `<span class="pill">${e(r.role_code)}${r.feature_code ? ':' + e(r.feature_code) : ''}</span>`).join('')}</td>
        <td>${u.subscriptions.map(s => `<span class="pill ${e(s.status)}">${e(s.feature_code)} ${e(s.status)}</span>`).join('')}</td>
        <td>${u.status === 'ACTIVE' ? '' : pill(u.status.toLowerCase())}${u.email_verified_at ? '' : ' <span class="muted">unverified</span>'}${u.totp_enabled_at ? ' <span class="pill">2FA</span>' : ''}</td>
        <td class="muted">${e((u.last_login_at || '').slice(0, 16))}</td></tr>`).join('');
      send(req, res, {
        title: 'Admin',
        body: `<h1>Admin</h1><p><a href="/auth/admin/audit">Audit log</a></p>
${views.notice('ok', req.query.info)}${views.notice('error', req.query.error)}
<h2>Access requests (${pending.length})</h2><div class="card">${pending.length ? `<table><thead><tr><th>User</th><th>Feature</th><th>Requested</th><th>Note</th><th></th></tr></thead><tbody>${pendingRows}</tbody></table>` : '<p class="muted">None waiting.</p>'}</div>
<h2>Users</h2><form method="get" class="row"><input type="text" name="q" value="${e(q)}" placeholder="Search email or name" style="max-width:320px"><button class="secondary">Search</button></form>
<div class="card"><table><thead><tr><th>User</th><th>Roles</th><th>Subscriptions</th><th>State</th><th>Last sign-in</th></tr></thead><tbody>${userRows}</tbody></table></div>`,
      });
    } catch (err) { next(err); }
  });

  router.get('/users/:id', async (req, res, next) => {
    try {
      const user = await service.findUserById(req.params.id);
      if (!user) return send(req, res, views.pages.message({ title: 'No such user', text: 'That user does not exist.', kind: 'error' }), 404);
      const [roles, subs, log] = await Promise.all([service.rolesOf(user.id), service.subscriptionsOf(user.id), audit.list({ userId: user.id, limit: 30, includeOwnerOnly: Boolean(req.bkAuth.atip) })]);
      const token = csrf.token(req, res);
      const hidden = `<input type="hidden" name="_csrf" value="${e(token)}">`;
      const self = user.id === req.bkAuth.user.id;
      const targetEval = rbac.evaluate({ roles });
      const ownerAccount = targetEval.isSuperAdmin;
      const mayRoles = can(req, 'admin.manage_users') && !self && !ownerAccount;
      const maySubs = can(req, 'admin.manage_subscriptions');

      const roleRows = roles.map(r => `<tr><td>${e(r.role_code)}${r.feature_code ? ` of ${e(r.feature_code)}` : ''}</td><td class="muted">${e(r.created_at)}</td><td>${
        mayRoles && r.role_code !== 'SUPER_ADMIN' && (r.role_code !== 'ADMIN' || can(req, 'admin.manage_admins')) ? `<form method="post" action="/auth/admin/users/${e(user.id)}/roles">${hidden}
          <input type="hidden" name="role" value="${e(r.role_code)}"><input type="hidden" name="feature" value="${e(r.feature_code)}">
          <button name="action" value="revoke" class="danger">Remove</button></form>` : ''}</td></tr>`).join('');
      const grantable = ['USER', 'MODERATOR', ...(can(req, 'admin.manage_admins') ? ['ADMIN'] : [])];
      const grantForm = mayRoles ? `<form method="post" action="/auth/admin/users/${e(user.id)}/roles" class="row">${hidden}
        <select name="role" aria-label="Role" style="width:auto">${grantable.map(r => `<option>${r}</option>`).join('')}</select>
        <select name="feature" aria-label="Feature (moderator only)" style="width:auto"><option value="">(feature, for moderator)</option>${rbac.FEATURES.map(f => `<option value="${e(f.code)}">${e(f.name)}</option>`).join('')}</select>
        <button name="action" value="grant">Grant</button></form>`
        : `<p class="muted">${self ? 'You cannot change your own role.' : ownerAccount ? 'The owner account is managed from the server only.' : ''}</p>`;

      const byFeature = new Map(subs.map(s => [s.feature_code, s]));
      const subRows = rbac.FEATURES.map(f => {
        const s = byFeature.get(f.code);
        const status = s ? rbac.effectiveStatus(s) : null;
        return `<tr><td>${e(f.name)}</td><td>${status ? pill(status) : '<span class="muted">none</span>'}${s && s.expires_at ? ` <span class="muted">until ${e(s.expires_at)}</span>` : ''}${s && s.source === 'payment' ? ` <span class="muted">paid (${e(s.payment_provider)})</span>` : ''}</td>
        <td>${maySubs ? `<form method="post" action="/auth/admin/users/${e(user.id)}/subscriptions" class="row">${hidden}<input type="hidden" name="feature" value="${e(f.code)}">
          <input type="date" name="expires_at" aria-label="Expiry (optional)" style="width:auto" value="${s && s.expires_at ? e(s.expires_at.slice(0, 10)) : ''}">
          <button name="action" value="approve">${status === 'active' ? 'Update' : 'Activate'}</button>
          ${s && status !== 'revoked' ? '<button name="action" value="revoke" class="secondary">Revoke</button>' : ''}</form>` : ''}</td></tr>`;
      }).join('');

      const statusForm = can(req, 'admin.manage_users') && !self && !ownerAccount
        ? `<form method="post" action="/auth/admin/users/${e(user.id)}/status" class="inline">${hidden}
            ${user.status === 'ACTIVE' ? '<button name="status" value="SUSPENDED" class="danger">Suspend and sign out</button>' : '<button name="status" value="ACTIVE">Reactivate</button>'}</form>` : '';
      const logRows = log.map(a => `<tr><td class="muted">${e(a.at)}</td><td>${e(a.action)}</td><td>${e(a.feature_code || '')}</td><td>${e(a.actor_email || '')}</td><td class="mono">${e(a.detail || '')}</td></tr>`).join('');

      send(req, res, {
        title: user.email,
        body: `<p><a href="/auth/admin">← Users</a></p><h1>${e(user.name || user.email)}</h1><p class="muted">${e(user.email)} · ${pill(user.status.toLowerCase() === 'active' ? 'active' : 'revoked')} ${user.email_verified_at ? 'verified' : 'unverified'} · joined ${e(user.created_at.slice(0, 10))}</p>
${views.notice('ok', req.query.info)}${views.notice('error', req.query.error)}
<div class="row">${statusForm}</div>
<h2>Roles</h2><div class="card"><table><tbody>${roleRows}</tbody></table>${grantForm}</div>
<h2>Subscriptions</h2><div class="card"><table><thead><tr><th>Feature</th><th>Status</th><th></th></tr></thead><tbody>${subRows}</tbody></table>
<p class="muted">Leave the date empty for no expiry.</p></div>
<h2>Recent activity</h2><div class="card"><table><thead><tr><th>When (UTC)</th><th>Action</th><th>Feature</th><th>By</th><th>Detail</th></tr></thead><tbody>${logRows}</tbody></table></div>`,
      });
    } catch (err) { next(err); }
  });

  router.post('/users/:id/roles', csrf.check, async (req, res, next) => {
    try {
      const { role, feature, action } = req.body || {};
      await service.changeRole({ actor: req.bkAuth.user, targetId: req.params.id, role: String(role || ''), feature: String(feature || ''), grant: action === 'grant', req });
      res.redirect(303, back(req.params.id, action === 'grant' ? 'Role granted.' : 'Role removed.'));
    } catch (err) {
      if (err instanceof service.AuthError) return res.redirect(303, back(req.params.id, err.message, true));
      next(err);
    }
  });

  router.post('/users/:id/subscriptions', csrf.check, async (req, res, next) => {
    const { feature, action, expires_at: expiresAt, note } = req.body || {};
    const ret = (msg, err) => (req.body && req.body.return === 'list'
      ? `/auth/admin?${err ? 'error' : 'info'}=${encodeURIComponent(msg)}` : back(req.params.id, msg, err));
    try {
      if (action === 'approve') {
        await service.approveSubscription({ actor: req.bkAuth.user, userId: req.params.id, feature: String(feature || ''), expiresAt, req });
        return res.redirect(303, ret('Subscription active.'));
      }
      if (action === 'revoke') {
        await service.revokeSubscription({ actor: req.bkAuth.user, userId: req.params.id, feature: String(feature || ''), note, req });
        return res.redirect(303, ret('Subscription revoked.'));
      }
      res.redirect(303, ret('Unknown action.', true));
    } catch (err) {
      if (err instanceof service.AuthError) return res.redirect(303, ret(err.message, true));
      next(err);
    }
  });

  router.post('/users/:id/status', csrf.check, async (req, res, next) => {
    try {
      await service.setUserStatus({ actor: req.bkAuth.user, userId: req.params.id, status: String((req.body || {}).status || ''), req });
      res.redirect(303, back(req.params.id, 'Account updated.'));
    } catch (err) {
      if (err instanceof service.AuthError) return res.redirect(303, back(req.params.id, err.message, true));
      next(err);
    }
  });

  router.get('/audit', async (req, res, next) => {
    try {
      if (!can(req, 'admin.view_audit')) return send(req, res, views.pages.message({ title: 'Not allowed', text: 'Not allowed.', kind: 'error' }), 403);
      const actions = audit.visibleActions(Boolean(req.bkAuth.atip));
      const action = actions.includes(req.query.action) ? req.query.action : null;
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const rows = await audit.list({ action, limit: 200, offset, includeOwnerOnly: Boolean(req.bkAuth.atip) });
      const body = rows.map(a => `<tr><td class="muted">${e(a.at)}</td><td>${e(a.action)}</td><td>${e(a.feature_code || '')}</td>
        <td>${e(a.actor_email || '')}</td><td>${a.subject_user_id ? `<a href="/auth/admin/users/${e(a.subject_user_id)}">${e(a.subject_email || a.subject_user_id)}</a>` : ''}</td>
        <td class="mono">${e(a.ip || '')}</td><td class="mono">${e(a.detail || '')}</td></tr>`).join('');
      const nextLink = rows.length === 200 ? `<p><a href="/auth/admin/audit?offset=${offset + 200}${action ? `&action=${e(action)}` : ''}">Older →</a></p>` : '';
      send(req, res, {
        title: 'Audit log',
        body: `<p><a href="/auth/admin">← Admin</a></p><h1>Audit log</h1>
<form method="get" class="row"><select name="action" style="width:auto"><option value="">All actions</option>${actions.map(a => `<option${a === action ? ' selected' : ''}>${a}</option>`).join('')}</select><button class="secondary">Filter</button></form>
<div class="card"><table><thead><tr><th>When (UTC)</th><th>Action</th><th>Feature</th><th>By</th><th>Subject</th><th>IP</th><th>Detail</th></tr></thead><tbody>${body}</tbody></table></div>${nextLink}`,
      });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createAdmin };
