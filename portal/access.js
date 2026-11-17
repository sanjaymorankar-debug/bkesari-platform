'use strict';

/* ============================================================
   Project access for the bkesari ID (decision D-039,
   docs/design/bkesari-id.md): who may open which project, how they ask,
   how the bkesari admin decides, and the gate in front of every project.

     /access/request?project=   ask for a project (role + note)
     /account                   my projects: role, who approved and when (IST), my requests
     /admin/access              the admin's queue, decisions, grants and users
     /hub/api/me                the shell's account menu and the home tiles

   Tables (hub database): hub_projects, project_access (grants),
   access_requests, audit_log (every decision), users (portal/bkesari-id.js).

   The gate runs before LadWani, Education and TaskList on every request. It
   removes any X-Bkesari-* header the client sent, checks the bkesari ID
   session and an active grant (read from the database on this request), then
   tells the project who the person is in signed headers (HUB_PROXY_SECRET).
   ============================================================ */

const crypto = require('crypto');
const express = require('express');

const DECLINE_COOLDOWN_HOURS = 24;
const TILE_TO_PROJECT = { education: 'edu' };
const IDENTITY_HEADERS = ['x-bkesari-user', 'x-bkesari-email', 'x-bkesari-role', 'x-bkesari-name', 'x-bkesari-project', 'x-bkesari-ts', 'x-bkesari-sig', 'x-bkesari-project-state'];
const rowId = (v) => (/^\d{1,15}$/.test(String(v ?? '')) ? Number(v) : 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A UTC instant (Date, ISO text, or the 'YYYY-MM-DD HH:MM:SS' of a TIMESTAMP column) in IST. */
function ist(value) {
  const ms = utcMs(value);
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, (m) => m.toUpperCase())} IST`;
}

/** Milliseconds of a UTC instant: a Date, ISO text, or a TIMESTAMP column's 'YYYY-MM-DD HH:MM:SS'; 0 when empty. */
function utcMs(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  // TIMESTAMPTZ comes back as text such as '2026-11-17 17:38:00.12+00' (db.js keeps the text).
  let s = String(value).trim().replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** The signature over the identity headers (contract §3). */
function identitySignature(secret, { project, user, email, role, name, ts }) {
  const msg = ['bkesari-id-v1', project, user, email, role, name, ts].join('\n');
  return crypto.createHmac('sha256', secret).update(msg).digest('base64url');
}

/** The identity headers for one request, or null when there is no secret to sign them with. */
function identityHeaders(secret, { project, userId, email, role, name, now = Date.now() }) {
  if (!secret) return null;
  const values = {
    project, user: String(userId), email: String(email || '').toLowerCase(), role: String(role || ''),
    name: Buffer.from(String(name || ''), 'utf8').toString('base64url'), ts: String(Math.floor(now / 1000)),
  };
  return {
    'x-bkesari-user': values.user, 'x-bkesari-email': values.email, 'x-bkesari-role': values.role,
    'x-bkesari-name': values.name, 'x-bkesari-project': project, 'x-bkesari-ts': values.ts,
    'x-bkesari-sig': identitySignature(secret, values),
  };
}

/** What a project does with them: the verified identity, or null (contract §3). */
function verifyIdentityHeaders(secret, headers, project, now = Date.now()) {
  if (!secret) return null;
  const h = (n) => (typeof headers[n] === 'string' ? headers[n] : '');
  const values = { project: h('x-bkesari-project'), user: h('x-bkesari-user'), email: h('x-bkesari-email'), role: h('x-bkesari-role'), name: h('x-bkesari-name'), ts: h('x-bkesari-ts') };
  if (values.project !== project || !/^\d{1,15}$/.test(values.user) || !values.email || !/^\d{9,11}$/.test(values.ts)) return null;
  if (Math.abs(now / 1000 - Number(values.ts)) >= 60) return null;
  const want = Buffer.from(identitySignature(secret, values));
  const got = Buffer.from(h('x-bkesari-sig'));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return { userId: Number(values.user), email: values.email, role: values.role, name: Buffer.from(values.name, 'base64url').toString('utf8'), project };
}

class AccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/**
 * @param db        the hub database
 * @param id        createBkesariId() (sessions, currentUser, CSRF)
 * @param notify    { mail(to, subject, text) } for the emails (code@agtci.com, D-034)
 * @param pages     portal/hub-pages.js (layout, t, langOf)
 * @param envName   (req) => tier
 */
function createAccess({ db, id, env = process.env, notify = {}, log = console, pages, envName = () => 'prod' }) {
  const secret = () => String(env.HUB_PROXY_SECRET || '').trim();
  const adminNotify = () => [...new Set([...id.ownerEmails, ...String(env.HUB_ADMIN_NOTIFY_EMAILS || '').split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)])];
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  let cache = { at: 0, rows: [] };
  async function projects() {
    if (Date.now() - cache.at > 30_000) cache = { at: Date.now(), rows: await db.all('SELECT * FROM hub_projects ORDER BY sort_order, key') };
    return cache.rows;
  }
  const projectByKey = async (key) => (await projects()).find((p) => p.key === key) || null;
  const rolesOf = (p) => String(p.roles || '').split(',').map((r) => r.trim()).filter(Boolean);
  const topRole = (p) => rolesOf(p).slice(-1)[0] || 'owner';

  const audit = (actor, action, target, detail) =>
    db.run('INSERT INTO audit_log (actor, action, target, detail) VALUES ($1,$2,$3,$4)',
      [String(actor || 'system').slice(0, 254), action, String(target || '').slice(0, 254) || null, String(detail || '').slice(0, 500) || null])
      .catch((err) => log.error('access audit failed:', err.message));

  function mail(to, subject, text) {
    if (!notify.mail || !to) return;
    Promise.resolve(notify.mail(to, subject, text)).catch((err) => log.error(`access email to ${String(to).replace(/^(.).*@/, '$1***@')} failed:`, err.message));
  }
  const siteOrigin = (req) => `${req && id.auth.plainLocal(req) ? 'http' : 'https'}://${(req && req.headers.host) || 'bkesari.com'}`;

  /** The active grant for (user, project), or a top-role stand-in for the built-in administrators. */
  async function activeGrant(user, key) {
    const project = await projectByKey(key);
    if (!project) return null;
    if (user.role === 'owner') return { role: topRole(project), project_key: key, owner: true, project_state: 'verified' };
    if (project.visibility === 'owner') return null;
    return db.get("SELECT * FROM project_access WHERE user_id = $1 AND project_key = $2 AND status = 'active'", [String(user.id), key]);
  }

  /** Every project with this person's state on it: open, signin, request, pending, approved, awaiting, declined, revoked. */
  async function statusList(user) {
    const list = await projects();
    const grants = user ? await db.all('SELECT * FROM project_access WHERE user_id = $1', [String(user.id)]) : [];
    const requests = user ? await db.all('SELECT * FROM access_requests WHERE user_id = $1 ORDER BY id DESC', [String(user.id)]) : [];
    return list.map((p) => {
      const base = { key: p.key, name: p.name, path: p.path, visibility: p.visibility, roles: rolesOf(p), twoStep: Boolean(p.two_step) };
      if (p.visibility === 'open') return { ...base, state: 'open' };
      if (p.visibility === 'owner') return user && user.role === 'owner' ? { ...base, state: 'approved', role: topRole(p) } : { ...base, state: 'hidden' };
      if (!user) return { ...base, state: 'signin' };
      if (user.role === 'owner') return { ...base, state: 'approved', role: topRole(p), owner: true };
      const grant = grants.find((g) => g.project_key === p.key);
      const mine = requests.filter((r) => r.project_key === p.key);
      const pending = mine.find((r) => r.status === 'pending');
      if (grant && grant.status === 'active') {
        const awaiting = p.two_step && grant.project_state !== 'verified';
        return { ...base, state: awaiting ? 'awaiting' : 'approved', role: grant.role, approvedBy: grant.approved_by, approvedAt: grant.approved_at || grant.created_at };
      }
      if (pending) return { ...base, state: 'pending', role: pending.role_wanted, requestedAt: pending.created_at };
      const declined = mine.find((r) => r.status === 'declined');
      const revokedAt = grant && grant.status === 'revoked' ? utcMs(grant.revoked_at) : 0;
      const declinedAt = declined ? utcMs(declined.decided_at) : 0;
      if (revokedAt && revokedAt >= declinedAt) return { ...base, state: 'revoked', reason: grant.revoke_reason, at: grant.revoked_at };
      if (declined) return { ...base, state: 'declined', reason: declined.decline_reason, at: declined.decided_at, canRequestAt: declinedAt + DECLINE_COOLDOWN_HOURS * 3600 * 1000 };
      return { ...base, state: 'request' };
    });
  }

  /* ---------- the person's side ---------- */
  async function requestAccess(user, key, role, note, req) {
    // The admin decides on the address shown in the request: it must be the person's own, confirmed.
    if (!user.email || !user.email_verified) throw new AccessError(403, 'unconfirmed', 'Confirm your email address before asking for a project.');
    const project = await projectByKey(key);
    if (!project || project.visibility !== 'approval') throw new AccessError(404, 'project', 'There is no such project to ask for.');
    if (!rolesOf(project).includes(role)) throw new AccessError(400, 'role', 'Choose one of the roles offered.');
    if (await activeGrant(user, key)) throw new AccessError(409, 'granted', 'You already have access to this project.');
    const last = await db.get(`SELECT decided_at FROM access_requests WHERE user_id = $1 AND project_key = $2 AND status = 'declined'
      AND decided_at > (now() AT TIME ZONE 'utc') - make_interval(hours => $3) ORDER BY id DESC LIMIT 1`, [String(user.id), key, DECLINE_COOLDOWN_HOURS]);
    if (last) {
      const at = utcMs(last.decided_at) + DECLINE_COOLDOWN_HOURS * 3600 * 1000;
      throw new AccessError(429, 'cooldown', `Your last request was declined. You can ask again after ${ist(new Date(at))}.`);
    }
    const cleanNote = String(note || '').trim().slice(0, 500) || null;
    let row;
    try {
      row = await db.get(`INSERT INTO access_requests (user_id, email, project_key, role_wanted, note) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [String(user.id), user.email, key, role, cleanNote]);
    } catch (err) {
      if (err.code === '23505') throw new AccessError(409, 'pending', 'You already have a request waiting for this project.');
      throw err;
    }
    await audit(user.email, 'request', `${key}:${user.email}`, `role ${role}${cleanNote ? `; note: ${cleanNote}` : ''}`);
    const link = `${siteOrigin(req)}/admin/access`;
    for (const to of adminNotify()) {
      mail(to, `bkesari: ${user.email} asks for ${project.name}`,
        `${user.name || user.email} (${user.email}) asks for access to ${project.name} as ${role}.\n${cleanNote ? `Note: ${cleanNote}\n` : ''}\nDecide at ${link}\n\n— bkesari.com`);
    }
    return row;
  }

  /* ---------- the admin's side ---------- */
  async function userById(userId) { return db.get('SELECT * FROM users WHERE id = $1', [rowId(userId)]); }

  async function approve(admin, requestId, role, req) {
    const out = await db.tx(async (q) => {
      const r = await q.get("SELECT * FROM access_requests WHERE id = $1 AND status = 'pending' FOR UPDATE", [rowId(requestId)]);
      if (!r) throw new AccessError(404, 'request', 'No such pending request.');
      const project = await q.get('SELECT * FROM hub_projects WHERE key = $1', [r.project_key]);
      const granted = role || r.role_wanted;
      if (!rolesOf(project).includes(granted)) throw new AccessError(400, 'role', 'Unknown role for this project.');
      await q.run(`UPDATE access_requests SET status = 'approved', role_granted = $2, decided_by = $3, decided_at = now() AT TIME ZONE 'utc' WHERE id = $1`, [r.id, granted, admin.email]);
      await q.run(`INSERT INTO project_access (user_id, email, project_key, role, status, approved_by, approved_at, request_id, project_state, updated_at)
        VALUES ($1,$2,$3,$4,'active',$5, now(), $6, $7, now())
        ON CONFLICT (user_id, project_key) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email, status = 'active', approved_by = EXCLUDED.approved_by,
          approved_at = now(), request_id = EXCLUDED.request_id, revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
          project_state = COALESCE(project_access.project_state, EXCLUDED.project_state), updated_at = now()`,
      [r.user_id, r.email, r.project_key, granted, admin.email, r.id, project.two_step ? 'pending' : null]);
      return { r, project, granted };
    });
    await audit(admin.email, 'approve', `${out.r.project_key}:${out.r.email}`, `role ${out.granted}${out.granted !== out.r.role_wanted ? ` (asked for ${out.r.role_wanted})` : ''}`);
    mail(out.r.email, `bkesari: access to ${out.project.name} approved`,
      `You can now open ${out.project.name} as ${out.granted}.${out.project.two_step ? `\n${out.project.name} will also verify your community profile before everything opens.` : ''}\n\nOpen it: ${siteOrigin(req)}${out.project.path}\nYour projects: ${siteOrigin(req)}/account\n\n— bkesari.com`);
    return out;
  }

  async function decline(admin, requestId, reason, req) {
    const why = String(reason || '').trim().slice(0, 500);
    if (!why) throw new AccessError(400, 'reason', 'A reason is required to decline.');
    const r = await db.get(`UPDATE access_requests SET status = 'declined', decline_reason = $2, decided_by = $3, decided_at = now() AT TIME ZONE 'utc'
      WHERE id = $1 AND status = 'pending' RETURNING *`, [rowId(requestId), why, admin.email]);
    if (!r) throw new AccessError(404, 'request', 'No such pending request.');
    const project = await projectByKey(r.project_key);
    await audit(admin.email, 'decline', `${r.project_key}:${r.email}`, why);
    mail(r.email, `bkesari: your request for ${project ? project.name : r.project_key}`,
      `Your request for ${project ? project.name : r.project_key} was declined.\nReason: ${why}\n\nYou can ask again after ${DECLINE_COOLDOWN_HOURS} hours: ${siteOrigin(req)}/account\n\n— bkesari.com`);
    return r;
  }

  async function revoke(admin, grantId, reason, req) {
    const why = String(reason || '').trim().slice(0, 500) || null;
    const g = await db.get(`UPDATE project_access SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3, updated_at = now()
      WHERE id = $1 AND status = 'active' RETURNING *`, [rowId(grantId), admin.email, why]);
    if (!g) throw new AccessError(404, 'grant', 'No such active access.');
    const project = await projectByKey(g.project_key);
    await audit(admin.email, 'revoke', `${g.project_key}:${g.email}`, why || '');
    mail(g.email, `bkesari: access to ${project ? project.name : g.project_key} removed`,
      `Your access to ${project ? project.name : g.project_key} has been removed.${why ? `\nReason: ${why}` : ''}\n\nYour projects: ${siteOrigin(req)}/account\n\n— bkesari.com`);
    return g;
  }

  async function changeRole(admin, grantId, role) {
    const g = await db.get("SELECT * FROM project_access WHERE id = $1 AND status = 'active'", [rowId(grantId)]);
    if (!g) throw new AccessError(404, 'grant', 'No such active access.');
    const project = await projectByKey(g.project_key);
    if (!rolesOf(project).includes(role)) throw new AccessError(400, 'role', 'Unknown role for this project.');
    await db.run('UPDATE project_access SET role = $2, updated_at = now() WHERE id = $1', [g.id, role]);
    await audit(admin.email, 'change-role', `${g.project_key}:${g.email}`, `${g.role} -> ${role}`);
    return { ...g, role };
  }

  async function grant(admin, userId, key, role, req) {
    const user = await userById(userId);
    if (!user || !user.email) throw new AccessError(404, 'user', 'No such person.');
    const project = await projectByKey(key);
    if (!project || project.visibility !== 'approval') throw new AccessError(404, 'project', 'Only projects that need approval can be granted.');
    if (!rolesOf(project).includes(role)) throw new AccessError(400, 'role', 'Unknown role for this project.');
    const g = await db.get(`INSERT INTO project_access (user_id, email, project_key, role, status, approved_by, approved_at, project_state, updated_at)
      VALUES ($1,$2,$3,$4,'active',$5, now(), $6, now())
      ON CONFLICT (user_id, project_key) DO UPDATE SET role = EXCLUDED.role, status = 'active', approved_by = EXCLUDED.approved_by, approved_at = now(),
        revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL, project_state = COALESCE(project_access.project_state, EXCLUDED.project_state), updated_at = now()
      RETURNING *`, [String(user.id), String(user.email).toLowerCase(), key, role, admin.email, project.two_step ? 'pending' : null]);
    // A request still waiting for the same project is answered by this grant.
    await db.run(`UPDATE access_requests SET status = 'approved', role_granted = $3, decided_by = $4, decided_at = now() AT TIME ZONE 'utc'
      WHERE user_id = $1 AND project_key = $2 AND status = 'pending'`, [String(user.id), key, role, admin.email]);
    await audit(admin.email, 'grant', `${key}:${user.email}`, `role ${role}`);
    mail(user.email, `bkesari: access to ${project.name}`, `You can now open ${project.name} as ${role}.\n\nOpen it: ${siteOrigin(req)}${project.path}\n\n— bkesari.com`);
    return g;
  }

  async function setStatus(admin, userId, status) {
    if (!['active', 'suspended'].includes(status)) throw new AccessError(400, 'status', 'status must be active or suspended');
    const user = await userById(userId);
    if (!user) throw new AccessError(404, 'user', 'No such person.');
    if (user.role === 'owner') throw new AccessError(403, 'owner', 'The built-in administrators cannot be suspended here.');
    if (Number(user.id) === Number(admin.id)) throw new AccessError(403, 'self', 'You cannot suspend yourself.');
    await db.tx(async (q) => {
      await q.run('UPDATE users SET status = $2 WHERE id = $1', [user.id, status]);
      if (status === 'suspended') await q.run('DELETE FROM hub_sessions WHERE user_id = $1', [user.id]);
    });
    await audit(admin.email, status === 'suspended' ? 'suspend' : 'unsuspend', `user:${user.email}`, '');
    return { ...user, status };
  }

  async function listRequests({ project, status, from, to } = {}) {
    const where = []; const vals = [];
    if (project) { vals.push(project); where.push(`r.project_key = $${vals.length}`); }
    if (status && ['pending', 'approved', 'declined'].includes(status)) { vals.push(status); where.push(`r.status = $${vals.length}`); }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { vals.push(from); where.push(`r.created_at >= ($${vals.length}::date - interval '330 minutes')`); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { vals.push(to); where.push(`r.created_at < ($${vals.length}::date + interval '1 day' - interval '330 minutes')`); }
    return db.all(`SELECT r.*, u.name AS user_name, u.status AS user_status FROM access_requests r
      LEFT JOIN users u ON u.id::text = r.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 300`, vals);
  }
  const pendingCount = async () => Number((await db.get("SELECT count(*)::int AS n FROM access_requests WHERE status = 'pending' AND user_id ~ '^[0-9]+$'")).n);

  async function listUsers() {
    const users = await db.all('SELECT id, email, name, role, status, created_at, last_login_at, google_sub IS NOT NULL AS google FROM users ORDER BY id DESC LIMIT 500');
    const grants = await db.all("SELECT * FROM project_access WHERE user_id ~ '^[0-9]+$' ORDER BY project_key");
    return users.map((u) => ({ ...u, grants: grants.filter((g) => g.user_id === String(u.id)) }));
  }

  /* ---------- the gate (contract §3) ---------- */
  // A HEAD asks about the page a GET would get, so it is answered the same way.
  const wantsJson = (req) => /\/api(\/|$)/.test(req.path) || /\bjson\b/.test(String(req.headers.accept || '')) || !['GET', 'HEAD'].includes(req.method);

  function stripIdentity(req) { for (const h of IDENTITY_HEADERS) delete req.headers[h]; }

  /**
   * Middleware for one project's whole path. `exempt` is a test on req.path
   * (relative to the mount) for files any visitor may load.
   */
  function gate(key, { exempt } = {}) {
    return wrap(async (req, res, next) => {
      stripIdentity(req);
      delete req.bkesariIdentity;
      if (exempt && exempt(req.path)) return next();
      const project = await projectByKey(key);
      if (!project || project.visibility === 'open') return next();
      const user = await id.currentUser(req);
      res.set('Cache-Control', 'private, no-store');
      if (!user) {
        return wantsJson(req) ? res.status(401).json({ error: 'Sign in required', signIn: `/auth/sign-in?next=${encodeURIComponent(req.originalUrl)}` })
          : res.redirect(302, `/auth/sign-in?next=${encodeURIComponent(req.originalUrl)}`);
      }
      // Only a confirmed email is anyone's identity in a project: the projects
      // link their own accounts by it (contract §3). An address added to an
      // account without a code to that inbox opens nothing, grant or not.
      if (!user.email || !user.email_verified) {
        return wantsJson(req) ? res.status(403).json({ error: 'Confirm your email address first', code: 'unconfirmed', account: '/account' })
          : res.redirect(302, '/account');
      }
      const g = await activeGrant(user, key);
      if (!g) {
        return wantsJson(req) ? res.status(403).json({ error: 'No access to this project', request: `/access/request?project=${key}` })
          : res.redirect(302, `/access/request?project=${encodeURIComponent(key)}`);
      }
      // In this process only (TaskList): the hub session's CSRF token travels with it, never in a header.
      req.bkesariIdentity = { userId: user.id, email: user.email, role: g.role, name: user.name || '', project: key, owner: user.role === 'owner', csrf: user.csrf };
      const headers = identityHeaders(secret(), { project: key, userId: user.id, email: user.email, role: g.role, name: user.name || '' });
      if (headers) Object.assign(req.headers, headers);
      if (project.two_step && !g.owner) captureProjectState(res, g);
      return next();
    });
  }

  /** The project's second-step state, from its response header, onto the grant; the header never reaches the browser. */
  function captureProjectState(res, g) {
    const writeHead = res.writeHead;
    res.writeHead = function patched(...args) {
      const raw = String(res.getHeader('x-bkesari-project-state') || '').toLowerCase();
      res.removeHeader('x-bkesari-project-state');
      if ((raw === 'verified' || raw === 'pending') && raw !== g.project_state) {
        db.run('UPDATE project_access SET project_state = $2, updated_at = now() WHERE id = $1', [g.id, raw])
          .then(() => audit('project', 'project-state', `${g.project_key}:${g.email}`, raw)).catch((err) => log.error('project state not saved:', err.message));
      }
      return writeHead.apply(this, args);
    };
  }

  /* ---------- pages ---------- */
  function send(req, res, { title, body, status = 200, scripts = [], csrf }) {
    const lang = pages.langOf(req);
    res.status(status).set({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }).type('html').send(pages.layout({
      req, lang, env: envName(req), title, body: body(lang), scripts,
      head: csrf ? `<meta name="bk-csrf" content="${esc(csrf)}">` : '',
    }));
  }
  const t = (lang, k, v) => pages.t(lang, k, v);
  const STATE_CHIP = { open: 'k-chip--live', approved: 'k-chip--live', awaiting: 'k-chip--beta', pending: 'k-chip--beta', declined: 'k-chip--plain', revoked: 'k-chip--plain', request: 'k-chip--soon', signin: 'k-chip--soon' };

  function stateLabel(lang, s) {
    if (s.state === 'approved') return t(lang, 'access.state.approved', { role: s.role });
    if (s.state === 'awaiting') return t(lang, 'access.state.awaiting', { role: s.role });
    if (s.state === 'pending') return t(lang, 'access.state.pending');
    if (s.state === 'declined') return t(lang, 'access.state.declined');
    if (s.state === 'revoked') return t(lang, 'access.state.revoked');
    if (s.state === 'signin') return t(lang, 'access.state.signin');
    if (s.state === 'open') return t(lang, 'access.state.open');
    return t(lang, 'access.state.request');
  }

  function mount(app) {
    // The home page's tiles and the shell's account menu.
    app.get('/hub/api/me', wrap(async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      const user = await id.currentUser(req);
      const list = await statusList(user);
      res.json({
        user: user ? { id: user.id, email: user.email, name: user.name, picture: user.picture, role: user.role } : null,
        owner: Boolean(user && user.role === 'owner'), admin: Boolean(user && (user.role === 'owner' || user.role === 'admin')),
        signIn: '/auth/sign-in', signOut: user ? { url: '/account/api/auth/sign-out', csrf: user.csrf, next: '/' } : null,
        projects: list.filter((p) => p.state !== 'hidden'),
      });
    }));

    app.get('/access/request', wrap(async (req, res) => {
      const user = await id.currentUser(req);
      if (!user) return res.redirect(302, `/auth/sign-in?next=${encodeURIComponent(req.originalUrl)}`);
      const key = String(req.query.project || '');
      const list = await statusList(user);
      const s = list.find((p) => p.key === key);
      if (!s || s.visibility !== 'approval') return res.redirect(302, '/account');
      if (s.state === 'approved' || s.state === 'awaiting') return res.redirect(302, s.path);
      send(req, res, {
        title: `${t(pages.langOf(req), 'access.title', { name: s.name })} — bkesari`, csrf: user.csrf, scripts: ['/shared/access.js'],
        body: (lang) => `<div class="k-main--narrow"><h1>${esc(t(lang, 'access.title', { name: s.name }))}</h1>
<p class="k-muted">${esc(t(lang, 'access.lead', { email: user.email }))}</p>
${s.state === 'pending' ? `<div class="k-banner k-banner--info" role="status"><p>${esc(t(lang, 'access.waiting'))}</p></div><p><a class="k-btn" href="/account">${esc(t(lang, 'account.title'))}</a></p>` : `
${s.state === 'declined' ? `<div class="k-banner k-banner--warning" role="status"><p>${esc(t(lang, 'access.declinedWas', { reason: s.reason || '—' }))}</p></div>` : ''}
${s.state === 'revoked' ? `<div class="k-banner k-banner--warning" role="status"><p>${esc(t(lang, 'access.revokedWas', { reason: s.reason || '—' }))}</p></div>` : ''}
<form class="k-card hub-form" data-access-request="${esc(s.key)}" novalidate>
<div class="k-field"><label class="k-label" for="ar-role">${esc(t(lang, 'access.role'))}</label>
<select class="k-input" id="ar-role">${s.roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select></div>
<div class="k-field"><label class="k-label" for="ar-note">${esc(t(lang, 'access.note'))}</label>
<textarea class="k-input" id="ar-note" rows="3" maxlength="500"></textarea></div>
<p class="k-error" id="ar-err" role="alert"></p>
<button class="k-btn k-btn--brand k-btn--block" type="submit">${esc(t(lang, 'access.send'))}</button></form>`}
<p><a href="/">${esc(t(lang, 'access.back'))}</a></p></div>`,
      });
    }));

    const api = express.Router();
    api.use(express.json({ limit: '20kb' }), (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    api.use(id.auth.requireUser, id.auth.csrfGuard);
    const me = async (req) => id.currentUser(req);
    api.post('/requests', wrap(async (req, res) => {
      const user = await me(req);
      const b = req.body || {};
      const r = await requestAccess(user, String(b.project || ''), String(b.role || ''), b.note, req);
      res.status(201).json({ id: Number(r.id) });
    }));
    api.use((err, req, res, next) => {
      if (err instanceof AccessError) return res.status(err.status).json({ error: err.message, code: err.code });
      if (err instanceof id.auth.AuthError) return res.status(err.status).json({ error: err.message, code: err.code });
      return next(err);
    });
    app.use('/hub/api/access', api);

    app.get(['/account', '/account/'], wrap(async (req, res) => {
      const user = await id.currentUser(req);
      if (!user) return res.redirect(302, '/auth/sign-in?next=%2Faccount');
      const list = (await statusList(user)).filter((p) => p.state !== 'hidden');
      const requests = await db.all('SELECT * FROM access_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [String(user.id)]);
      const names = Object.fromEntries(list.map((p) => [p.key, p.name]));
      send(req, res, {
        title: `${t(pages.langOf(req), 'account.title')} — bkesari`, csrf: user.csrf,
        body: (lang) => `<h1>${esc(t(lang, 'account.title'))}</h1>
<div class="k-card hub-me">${user.picture ? `<img class="hub-avatar" src="${esc(user.picture)}" alt="" width="48" height="48" referrerpolicy="no-referrer">` : ''}
<p><strong>${esc(user.name || user.email)}</strong><br><span class="k-muted">${esc(user.email)}</span>${user.role !== 'member' ? ` <span class="k-chip">${esc(user.role)}</span>` : ''}</p></div>
<h2>${esc(t(lang, 'account.projects'))}</h2>
<div class="k-table-wrap"><table class="k-table"><thead><tr><th>${esc(t(lang, 'account.project'))}</th><th>${esc(t(lang, 'account.status'))}</th><th>${esc(t(lang, 'account.approvedBy'))}</th><th></th></tr></thead><tbody>
${list.map((p) => `<tr><td>${esc(p.name)}</td><td><span class="k-chip ${STATE_CHIP[p.state] || ''}">${esc(stateLabel(lang, p))}</span>${p.reason ? `<br><span class="k-small k-muted">${esc(p.reason)}</span>` : ''}</td>
<td>${p.approvedBy ? `${esc(p.approvedBy)}<br><span class="k-small k-muted">${esc(ist(p.approvedAt))}</span>` : (p.owner ? esc(t(lang, 'account.builtin')) : '—')}</td>
<td>${['approved', 'awaiting', 'open'].includes(p.state) ? `<a class="k-btn k-btn--sm" href="${esc(p.path)}">${esc(t(lang, 'tile.open'))}</a>`
    : ['request', 'declined', 'revoked'].includes(p.state) && p.visibility === 'approval' ? `<a class="k-btn k-btn--sm k-btn--secondary" href="/access/request?project=${esc(p.key)}">${esc(t(lang, 'access.state.request'))}</a>` : ''}</td></tr>`).join('')}
</tbody></table></div>
<h2>${esc(t(lang, 'account.history'))}</h2>
${requests.length ? `<div class="k-table-wrap"><table class="k-table"><thead><tr><th>${esc(t(lang, 'account.when'))}</th><th>${esc(t(lang, 'account.project'))}</th><th>${esc(t(lang, 'access.role'))}</th><th>${esc(t(lang, 'account.status'))}</th></tr></thead><tbody>
${requests.map((r) => `<tr><td>${esc(ist(r.created_at))}</td><td>${esc(names[r.project_key] || r.project_key)}</td><td>${esc(r.role_granted || r.role_wanted)}</td>
<td>${esc(r.status)}${r.decided_by ? ` · ${esc(r.decided_by)} · ${esc(ist(r.decided_at))}` : ''}${r.decline_reason ? `<br><span class="k-small k-muted">${esc(r.decline_reason)}</span>` : ''}</td></tr>`).join('')}
</tbody></table></div>` : `<p class="k-muted">${esc(t(lang, 'account.noHistory'))}</p>`}
${user.role === 'owner' || user.role === 'admin' ? `<p><a class="k-btn k-btn--brand" href="/admin/access">${esc(t(lang, 'account.adminLink'))}</a></p>` : ''}
<form data-signout><button class="k-btn k-btn--ghost" type="button" data-signout-btn>${esc(t(lang, 'id.signOut'))}</button></form>`,
        scripts: ['/shared/access.js'],
      });
    }));

    /* ---------- the admin ---------- */
    async function adminOf(req) {
      const user = await id.currentUser(req);
      return user && (user.role === 'owner' || user.role === 'admin') ? user : null;
    }

    app.get(['/admin/access', '/admin/access/'], wrap(async (req, res) => {
      const admin = await adminOf(req);
      if (!admin) {
        const user = await id.currentUser(req);
        return user ? res.status(404).type('text/plain').send('Not found') : res.redirect(302, '/auth/sign-in?next=%2Fadmin%2Faccess');
      }
      const q = req.query || {};
      const filters = { project: typeof q.project === 'string' ? q.project : '', status: typeof q.status === 'string' ? q.status : 'pending', from: q.from, to: q.to };
      const [list, reqs, users, pending] = await Promise.all([projects(), listRequests(filters), listUsers(), pendingCount()]);
      const approvalProjects = list.filter((p) => p.visibility === 'approval');
      const roleSelect = (p, selected, attrs = '') => `<select class="k-input k-input--sm" ${attrs}>${rolesOf(p).map((r) => `<option${r === selected ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>`;
      const byKey = Object.fromEntries(list.map((p) => [p.key, p]));
      send(req, res, {
        title: 'Access requests — bkesari admin', csrf: admin.csrf, scripts: ['/shared/access-admin.js'],
        body: () => `<h1>Access requests <span class="k-chip k-chip--beta" aria-label="${pending} waiting">${pending}</span></h1>
<p class="k-muted">Signed in as ${esc(admin.email)} (${esc(admin.role)}). Times are IST. <a href="/admin">Tiles, banner and inbox</a></p>
<form class="k-row hub-filters" method="get" action="/admin/access">
<label>Project <select class="k-input k-input--sm" name="project"><option value="">All</option>${approvalProjects.map((p) => `<option value="${esc(p.key)}"${filters.project === p.key ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
<label>Status <select class="k-input k-input--sm" name="status">${['pending', 'approved', 'declined', ''].map((s) => `<option value="${s}"${filters.status === s ? ' selected' : ''}>${s || 'All'}</option>`).join('')}</select></label>
<label>From <input class="k-input k-input--sm" type="date" name="from" value="${esc(q.from || '')}"></label>
<label>To <input class="k-input k-input--sm" type="date" name="to" value="${esc(q.to || '')}"></label>
<button class="k-btn k-btn--sm" type="submit">Filter</button></form>
<p class="k-error" id="ax-err" role="alert"></p>
<div class="k-table-wrap"><table class="k-table"><thead><tr><th>When</th><th>Person</th><th>Project</th><th>Role wanted</th><th>Note</th><th>Status / decision</th></tr></thead><tbody>
${reqs.map((r) => {
    const p = byKey[r.project_key];
    return `<tr data-request="${Number(r.id)}"><td>${esc(ist(r.created_at))}</td><td>${esc(r.user_name || '')}<br><span class="k-small">${esc(r.email)}</span></td><td>${esc(p ? p.name : r.project_key)}</td>
<td>${esc(r.role_wanted)}</td><td>${esc(r.note || '')}</td><td>${r.status === 'pending' && p ? `<div class="k-row">${roleSelect(p, r.role_wanted, 'data-role')}
<button class="k-btn k-btn--sm k-btn--brand" type="button" data-approve>Approve</button>
<input class="k-input k-input--sm" data-reason placeholder="Reason to decline" maxlength="500" aria-label="Reason to decline">
<button class="k-btn k-btn--sm k-btn--secondary" type="button" data-decline>Decline</button></div>`
    : `${esc(r.status)}${r.role_granted ? ` as ${esc(r.role_granted)}` : ''}${r.decided_by ? `<br><span class="k-small">${esc(r.decided_by)}, ${esc(ist(r.decided_at))}</span>` : ''}${r.decline_reason ? `<br><span class="k-small k-muted">${esc(r.decline_reason)}</span>` : ''}`}</td></tr>`;
  }).join('') || '<tr><td colspan="6">Nothing here.</td></tr>'}
</tbody></table></div>
<h2>People</h2>
<div class="k-table-wrap"><table class="k-table"><thead><tr><th>Person</th><th>Signed in</th><th>Access</th><th>Grant</th><th>Account</th></tr></thead><tbody>
${users.map((u) => `<tr data-user="${Number(u.id)}"><td>${esc(u.name || '')}<br><span class="k-small">${esc(u.email)}</span>${u.role !== 'member' ? ` <span class="k-chip">${esc(u.role)}</span>` : ''}</td>
<td class="k-small">${u.google ? 'Google · ' : ''}${esc(ist(u.last_login_at)) || '—'}</td>
<td>${u.grants.map((g) => `<div class="k-row k-small" data-grant="${Number(g.id)}">${esc(byKey[g.project_key] ? byKey[g.project_key].name : g.project_key)}: ${g.status === 'active' ? `${byKey[g.project_key] ? roleSelect(byKey[g.project_key], g.role, 'data-grant-role') : esc(g.role)}
<button class="k-btn k-btn--sm" type="button" data-change-role>Change</button><button class="k-btn k-btn--sm k-btn--secondary" type="button" data-revoke>Revoke</button>${byKey[g.project_key] && byKey[g.project_key].two_step ? ` <span class="k-chip">${g.project_state === 'verified' ? 'verified in project' : 'awaiting project'}</span>` : ''}` : `revoked ${esc(ist(g.revoked_at))}`}</div>`).join('') || '<span class="k-muted">none</span>'}</td>
<td><div class="k-row"><select class="k-input k-input--sm" data-grant-project>${approvalProjects.map((p) => `<option value="${esc(p.key)}" data-roles="${esc(rolesOf(p).join(','))}">${esc(p.name)}</option>`).join('')}</select>
<input class="k-input k-input--sm" data-grant-new-role placeholder="role" aria-label="Role" value="${esc(rolesOf(approvalProjects[0] || { roles: '' })[0] || '')}"><button class="k-btn k-btn--sm" type="button" data-grant-btn>Grant</button></div></td>
<td>${u.role === 'owner' ? 'built-in' : `${esc(u.status)} <button class="k-btn k-btn--sm k-btn--secondary" type="button" data-status="${u.status === 'suspended' ? 'active' : 'suspended'}">${u.status === 'suspended' ? 'Restore' : 'Suspend'}</button>`}</td></tr>`).join('')}
</tbody></table></div>`,
      });
    }));

    const adminApi = express.Router();
    adminApi.use(express.json({ limit: '20kb' }), (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    adminApi.use(id.auth.requireUser, id.auth.csrfGuard, wrap(async (req, res, next) => {
      const admin = await adminOf(req);
      if (!admin) return res.status(403).json({ error: 'Only the bkesari admin can do this', code: 'admin' });
      req.admin = admin;
      return next();
    }));
    adminApi.get('/requests', wrap(async (req, res) => res.json({ requests: await listRequests(req.query || {}), pending: await pendingCount() })));
    adminApi.get('/users', wrap(async (req, res) => res.json({ users: await listUsers() })));
    adminApi.post('/requests/:id/approve', wrap(async (req, res) => { await approve(req.admin, req.params.id, (req.body || {}).role, req); res.json({ ok: true }); }));
    adminApi.post('/requests/:id/decline', wrap(async (req, res) => { await decline(req.admin, req.params.id, (req.body || {}).reason, req); res.json({ ok: true }); }));
    adminApi.post('/grants/:id/revoke', wrap(async (req, res) => { await revoke(req.admin, req.params.id, (req.body || {}).reason, req); res.json({ ok: true }); }));
    adminApi.post('/grants/:id/role', wrap(async (req, res) => { await changeRole(req.admin, req.params.id, String((req.body || {}).role || '')); res.json({ ok: true }); }));
    adminApi.post('/users/:id/grant', wrap(async (req, res) => {
      const b = req.body || {};
      await grant(req.admin, req.params.id, String(b.project || ''), String(b.role || ''), req);
      res.json({ ok: true });
    }));
    adminApi.post('/users/:id/status', wrap(async (req, res) => { await setStatus(req.admin, req.params.id, String((req.body || {}).status || '')); res.json({ ok: true }); }));
    adminApi.use((err, req, res, next) => {
      if (err instanceof AccessError) return res.status(err.status).json({ error: err.message, code: err.code });
      if (err instanceof id.auth.AuthError) return res.status(err.status).json({ error: err.message, code: err.code });
      return next(err);
    });
    app.use('/hub/api/admin/access', adminApi);
  }

  return {
    mount, gate, statusList, activeGrant, requestAccess, approve, decline, revoke, changeRole, grant, setStatus, listRequests, listUsers, pendingCount,
    stripIdentity, AccessError, invalidate: () => { cache = { at: 0, rows: [] }; },
  };
}

module.exports = { createAccess, identityHeaders, verifyIdentityHeaders, identitySignature, ist, IDENTITY_HEADERS, DECLINE_COOLDOWN_HOURS, TILE_TO_PROJECT };
