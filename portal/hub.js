/* ============================================================
   The hub's access layer (blueprint sheet A-02).

   One bkesari ID (Neon Auth) answers "who are you". This module answers
   "what may you open": a permission per project in project_access, requested
   on /access/request and decided on /admin/access.

   - Open projects (Driving Simulator, Environmental Activities) need nothing.
   - ATIP is the owner's alone. Anyone else gets a plain 404, with no request
     path and no hint that the page exists.
   - LadWani and Education forward the request with a short-lived signed token
     (RS256, 60 s): user id, email and the role for that project. The apps
     verify it against /.well-known/jwks.json and map `sub` to a hub_user_id
     on their own users table. The hub database is never read by an app.

   The signing key is HUB_TOKEN_PRIVATE_KEY (PEM). Without it a key is made at
   start-up: fine for one dev process, but tokens then die on every restart and
   two processes cannot verify each other's, so set it on every real tier.
   ============================================================ */

const crypto = require('crypto');
const express = require('express');
const menu = require('./public/shared/menu.js');
const neonAuth = require('./neon-auth');

const TOKEN_TTL_SECONDS = 60;
const TOKEN_HEADER = 'x-bkesari-token';
// The role that may decide requests for a project, besides the owner.
const PROJECT_ADMIN_ROLE = { ladwani: 'admin', edu: 'admin', tasklist: 'owner' };

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ownerEmails(env = process.env) {
  return new Set(String(env.HUB_OWNER_EMAILS || 'agtcipl@gmail.com')
    .split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));
}

function loadKeys(env = process.env, log = console) {
  let privateKey;
  if (env.HUB_TOKEN_PRIVATE_KEY) {
    privateKey = crypto.createPrivateKey(env.HUB_TOKEN_PRIVATE_KEY.replace(/\\n/g, '\n'));
  } else {
    log.warn('HUB_TOKEN_PRIVATE_KEY is not set: using a key made at start-up. Set it so tokens survive restarts.');
    privateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const kid = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
  return { privateKey, publicKey, kid, jwks: { keys: [jwk] } };
}

function signToken(keys, claims, { now = Date.now(), issuer = 'bkesari-hub' } = {}) {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: keys.kid };
  const payload = { iss: issuer, iat, exp: iat + TOKEN_TTL_SECONDS, ...claims };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), keys.privateKey);
  return `${input}.${b64u(sig)}`;
}

/** What an app does with a token, kept here so the tests can play the app. */
function verifyToken(jwks, token, { audience, now = Date.now() } = {}) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) throw new Error('malformed token');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (header.alg !== 'RS256' || !jwk) throw new Error('unknown key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) throw new Error('bad signature');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (claims.exp * 1000 < now) throw new Error('token expired');
  if (audience && claims.aud !== audience) throw new Error('token is for another project');
  return claims;
}

const STYLE = `<style>
:root{--bg:#F6F4EF;--surface:#fff;--ink:#1B1D24;--soft:#5F6472;--line:#E6E2D9;--accent:#C2560A;--accent-d:#9A4308;--ok:#1F7A4D;--bad:#A3321F}
@media (prefers-color-scheme:dark){:root{--bg:#111315;--surface:#181B1E;--ink:#ECEDEE;--soft:#B9BFC6;--line:#30353A;--accent:#F08A3C;--accent-d:#F5A869;--ok:#6FCF9B;--bad:#F29484}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 'Inter',system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 6px}p{margin:0 0 12px;color:var(--soft)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;margin:12px 0}
label{display:block;font-weight:600;font-size:14px;margin:12px 0 4px}select,textarea,input{width:100%;padding:10px;border:1.5px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);font:inherit}
button,.btn{display:inline-block;min-height:44px;padding:10px 16px;border:0;border-radius:9px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.alt{background:transparent;color:var(--ink);border:1.5px solid var(--line)}button:disabled{opacity:.6}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.msg{min-height:22px;margin-top:10px;font-size:14px}.ok{color:var(--ok)}.bad{color:var(--bad)}
.tag{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid var(--line);font-size:13px}
</style>`;

function page({ title, body, user, req, envName }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} — bkesari</title>${STYLE}</head><body>
${menu.renderHtml({ pathname: req.path, env: envName, isOwner: user && user.isOwner })}
<main>${body}</main></body></html>`;
}

/**
 * @param db        the hub database (hub_schema.sql applied)
 * @param getUser   async (req, res) => { id, email, name, emailVerified } | null
 */
function createHub({ db, getUser = neonAuth.currentUser, env = process.env, log = console, envName = () => 'prod' } = {}) {
  const keys = loadKeys(env, log);
  const owners = ownerEmails(env);

  const isOwnerEmail = (email) => owners.has(String(email || '').toLowerCase());

  let cache = { at: 0, rows: [] };
  async function projects() {
    if (Date.now() - cache.at > 30_000) cache = { at: Date.now(), rows: await db.all('SELECT * FROM hub_projects ORDER BY sort_order') };
    return cache.rows;
  }
  const projectByKey = async (key) => (await projects()).find((p) => p.key === key) || null;

  /** The request's user with isOwner set; only a verified address counts as the owner. */
  async function whoami(req, res) {
    if (req.hubUser !== undefined) return req.hubUser;
    const u = await getUser(req, res);
    req.hubUser = u && u.email ? {
      id: String(u.id), email: String(u.email).toLowerCase(), name: u.name || null,
      emailVerified: Boolean(u.emailVerified), isOwner: Boolean(u.emailVerified) && isOwnerEmail(u.email),
    } : null;
    return req.hubUser;
  }

  async function accessFor(user) {
    const rows = await db.all("SELECT project_key, role FROM project_access WHERE user_id = $1 AND status = 'active'", [user.id]);
    return Object.fromEntries(rows.map((r) => [r.project_key, r.role]));
  }

  async function roleFor(user, key) {
    const project = await projectByKey(key);
    if (!project) return null;
    if (user.isOwner) return project.roles.split(',').pop(); // the owner holds the top role everywhere
    if (project.visibility === 'owner') return null;
    return (await accessFor(user))[key] || null;
  }

  const wantsJson = (req) => /\bjson\b/.test(req.headers.accept || '') || req.originalUrl.includes('/api/');
  const signInUrl = (req) => `/auth/sign-in?next=${encodeURIComponent(req.originalUrl)}`;
  const notFound = (res) => res.status(404).type('text/plain').send('Not found');

  /** Middleware for one project: sign-in, permission, then the signed token. */
  function gate(key) {
    return async (req, res, next) => {
      try {
        delete req.headers[TOKEN_HEADER];
        const project = await projectByKey(key);
        if (!project) return notFound(res);
        if (project.visibility === 'open') return next();
        const user = await whoami(req, res);
        // ATIP never reveals itself: signed in or not, a non-owner sees a 404.
        if (project.visibility === 'owner') return user && user.isOwner ? next() : notFound(res);
        if (!user) return wantsJson(req) ? res.status(401).json({ error: 'Sign in required' }) : res.redirect(302, signInUrl(req));
        if (!user.emailVerified) return wantsJson(req) ? res.status(401).json({ error: 'Verify your email first' }) : res.redirect(302, `/auth/sign-in?verify=1&next=${encodeURIComponent(req.originalUrl)}`);
        const role = project.visibility === 'signed_in' ? project.roles.split(',')[0] : await roleFor(user, key);
        if (!role) {
          return wantsJson(req) ? res.status(403).json({ error: 'No access to this project', request: `/access/request?project=${key}` })
            : res.redirect(302, `/access/request?project=${encodeURIComponent(key)}`);
        }
        req.headers[TOKEN_HEADER] = signToken(keys, { sub: user.id, email: user.email, role, project: key, aud: key });
        res.set('Cache-Control', 'private, no-store');
        return next();
      } catch (err) { return next(err); }
    };
  }

  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser callers carry no Origin
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };
  const audit = (actor, action, target, detail) =>
    db.run('INSERT INTO audit_log (actor, action, target, detail) VALUES ($1,$2,$3,$4)', [actor, action, target, String(detail || '').slice(0, 500)]);

  async function adminProjects(user) {
    const all = await projects();
    if (user.isOwner) return all.filter((p) => p.visibility === 'approval').map((p) => p.key);
    const mine = await accessFor(user);
    return all.filter((p) => p.visibility === 'approval' && mine[p.key] === PROJECT_ADMIN_ROLE[p.key]).map((p) => p.key);
  }

  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  function mount(app) {
    app.get('/.well-known/jwks.json', (req, res) => { res.set('Cache-Control', 'public, max-age=300').json(keys.jwks); });

    app.get('/hub/api/me', wrap(async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      const user = await whoami(req, res);
      const list = await projects();
      if (!user) return res.json({ user: null, owner: false, projects: list.filter((p) => p.visibility !== 'owner').map((p) => ({ key: p.key, name: p.name, path: p.path, state: p.visibility === 'open' ? 'open' : 'signin' })) });
      const access = await accessFor(user);
      const pending = new Set((await db.all("SELECT project_key FROM access_requests WHERE user_id = $1 AND status = 'pending'", [user.id])).map((r) => r.project_key));
      const admin = await adminProjects(user);
      res.json({
        user: { email: user.email, name: user.name }, owner: user.isOwner, canAdmin: admin.length > 0,
        projects: list.filter((p) => p.visibility !== 'owner' || user.isOwner).map((p) => ({
          key: p.key, name: p.name, path: p.path,
          state: p.visibility === 'open' || user.isOwner || access[p.key] ? 'open' : pending.has(p.key) ? 'pending' : 'request',
          role: user.isOwner ? p.roles.split(',').pop() : access[p.key] || null,
        })),
      });
    }));

    app.get('/access/request', wrap(async (req, res) => {
      const user = await whoami(req, res);
      if (!user) return res.redirect(302, signInUrl(req));
      const project = await projectByKey(String(req.query.project || ''));
      if (!project || project.visibility !== 'approval') return notFound(res);
      const existing = await roleFor(user, project.key);
      if (existing) return res.redirect(302, project.path);
      const pending = await db.get("SELECT id FROM access_requests WHERE user_id = $1 AND project_key = $2 AND status = 'pending'", [user.id, project.key]);
      const roles = project.roles.split(',');
      const body = `<h1>Request access to ${esc(project.name)}</h1>
<p>You are signed in as <strong>${esc(user.email)}</strong>. Your bkesari ID works everywhere, but each project decides who may enter.</p>
<div class="card">${pending ? '<p class="ok"><strong>Your request is waiting for a decision.</strong> You will be able to open the project as soon as it is approved.</p><a class="btn alt" href="/">Back to home</a>' : `
<form id="f"><label for="role">Role you need</label>
<select id="role">${roles.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
<label for="note">Why do you need it? (optional)</label><textarea id="note" rows="3" maxlength="500"></textarea>
<div class="row" style="margin-top:14px"><button type="submit" id="go">Send request</button><a href="/">Cancel</a></div>
<div class="msg" id="msg" role="status"></div></form>`}</div>
<script>
const f=document.getElementById('f');if(f)f.onsubmit=async(e)=>{e.preventDefault();const m=document.getElementById('msg');const b=document.getElementById('go');b.disabled=true;
const r=await fetch('/hub/api/access-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:${JSON.stringify(project.key)},role:document.getElementById('role').value,note:document.getElementById('note').value})});
const d=await r.json().catch(()=>({}));if(r.ok){f.outerHTML='<p class="ok"><strong>Request sent.</strong> You will be able to open the project once it is approved.</p><a class="btn alt" href="/">Back to home</a>';}else{m.className='msg bad';m.textContent=d.error||'Could not send the request';b.disabled=false;}};
</script>`;
      res.set('Cache-Control', 'private, no-store').type('html').send(page({ title: 'Request access', body, user, req, envName: envName(req) }));
    }));

    app.post('/hub/api/access-requests', wrap(async (req, res) => {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused' });
      const user = await whoami(req, res);
      if (!user) return res.status(401).json({ error: 'Sign in required' });
      if (!user.emailVerified) return res.status(401).json({ error: 'Verify your email first' });
      const { project: key, role, note } = req.body || {};
      const project = await projectByKey(String(key || ''));
      if (!project || project.visibility !== 'approval') return res.status(404).json({ error: 'Unknown project' });
      if (!project.roles.split(',').includes(role)) return res.status(400).json({ error: 'Unknown role' });
      if (await roleFor(user, project.key)) return res.status(409).json({ error: 'You already have access' });
      try {
        const r = await db.get('INSERT INTO access_requests (user_id, email, project_key, role_wanted, note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [user.id, user.email, project.key, role, String(note || '').trim().slice(0, 500) || null]);
        await audit(user.email, 'request', project.key, `role ${role}`);
        res.status(201).json({ id: r.id });
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'You already have a request waiting' });
        throw err;
      }
    }));

    async function adminUser(req, res) {
      const user = await whoami(req, res);
      if (!user || !user.emailVerified) { res.status(user ? 401 : 401).json({ error: 'Sign in required' }); return null; }
      const keys = await adminProjects(user);
      if (!keys.length) { res.status(403).json({ error: 'Not an access admin' }); return null; }
      return { user, keys };
    }

    app.get('/hub/api/admin/requests', wrap(async (req, res) => {
      const a = await adminUser(req, res); if (!a) return;
      const status = ['pending', 'approved', 'declined'].includes(req.query.status) ? req.query.status : 'pending';
      const rows = await db.all('SELECT id, email, project_key, role_wanted, note, status, decided_by, created_at FROM access_requests WHERE status = $1 AND project_key = ANY($2) ORDER BY id', [status, a.keys]);
      res.set('Cache-Control', 'private, no-store').json({ requests: rows });
    }));

    app.post('/hub/api/admin/requests/:id', wrap(async (req, res) => {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused' });
      const a = await adminUser(req, res); if (!a) return;
      const id = Number(req.params.id);
      const { decision, role } = req.body || {};
      if (!['approve', 'decline'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or decline' });
      const out = await db.tx(async (q) => {
        const r = await q.get("SELECT * FROM access_requests WHERE id = $1 AND status = 'pending' FOR UPDATE", [Number.isInteger(id) ? id : 0]);
        if (!r || !a.keys.includes(r.project_key)) return null;
        if (decision === 'decline') {
          await q.run("UPDATE access_requests SET status = 'declined', decided_by = $1, decided_at = now() AT TIME ZONE 'utc' WHERE id = $2", [a.user.email, r.id]);
          return r;
        }
        const project = await q.get('SELECT roles FROM hub_projects WHERE key = $1', [r.project_key]);
        const granted = role || r.role_wanted;
        if (!project.roles.split(',').includes(granted)) return { bad: true };
        await q.run("UPDATE access_requests SET status = 'approved', decided_by = $1, decided_at = now() AT TIME ZONE 'utc' WHERE id = $2", [a.user.email, r.id]);
        await q.run(`INSERT INTO project_access (user_id, email, project_key, role, status, approved_by) VALUES ($1,$2,$3,$4,'active',$5)
          ON CONFLICT (user_id, project_key) DO UPDATE SET role = EXCLUDED.role, status = 'active', approved_by = EXCLUDED.approved_by`,
        [r.user_id, r.email, r.project_key, granted, a.user.email]);
        return { ...r, granted };
      });
      if (!out) return res.status(404).json({ error: 'No such pending request' });
      if (out.bad) return res.status(400).json({ error: 'Unknown role' });
      await audit(a.user.email, decision, out.project_key, `${out.email}${out.granted ? ` as ${out.granted}` : ''}`);
      res.json({ ok: true });
    }));

    app.get('/hub/api/admin/access', wrap(async (req, res) => {
      const a = await adminUser(req, res); if (!a) return;
      const rows = await db.all("SELECT id, email, project_key, role, created_at FROM project_access WHERE status = 'active' AND project_key = ANY($1) ORDER BY project_key, email", [a.keys]);
      res.set('Cache-Control', 'private, no-store').json({ access: rows });
    }));

    app.post('/hub/api/admin/access/:id/revoke', wrap(async (req, res) => {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused' });
      const a = await adminUser(req, res); if (!a) return;
      const r = await db.get("UPDATE project_access SET status = 'revoked' WHERE id = $1 AND status = 'active' AND project_key = ANY($2) RETURNING email, project_key",
        [Number(req.params.id) || 0, a.keys]);
      if (!r) return res.status(404).json({ error: 'No such access' });
      await audit(a.user.email, 'revoke', r.project_key, r.email);
      res.json({ ok: true });
    }));

    app.get('/admin/access', wrap(async (req, res) => {
      const user = await whoami(req, res);
      if (!user) return res.redirect(302, signInUrl(req));
      if (!(await adminProjects(user)).length) return notFound(res);
      const body = `<h1>Access admin</h1><p>Approve or decline requests, and see who can open what.</p>
<h2 style="font-size:18px">Waiting for a decision</h2><div id="pending" aria-live="polite">Loading…</div>
<h2 style="font-size:18px;margin-top:28px">Who has access</h2><div id="access">Loading…</div>
<script>
const E=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(u,b){const r=await fetch(u,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{});return r.json().catch(()=>({}));}
async function load(){
 const p=await api('/hub/api/admin/requests');const el=document.getElementById('pending');
 el.innerHTML=(p.requests||[]).map(r=>'<div class="card"><div class="row"><div><strong>'+E(r.email)+'</strong><br><span class="tag">'+E(r.project_key)+'</span> wants <span class="tag">'+E(r.role_wanted)+'</span>'+(r.note?'<p>'+E(r.note)+'</p>':'')+'</div><div><button data-i="'+r.id+'" data-d="approve">Approve</button> <button class="alt" data-i="'+r.id+'" data-d="decline">Decline</button></div></div></div>').join('')||'<p>Nothing is waiting.</p>';
 const a=await api('/hub/api/admin/access');
 document.getElementById('access').innerHTML=(a.access||[]).map(r=>'<div class="card"><div class="row"><div><strong>'+E(r.email)+'</strong> <span class="tag">'+E(r.project_key)+'</span> <span class="tag">'+E(r.role)+'</span></div><button class="alt" data-r="'+r.id+'">Revoke</button></div></div>').join('')||'<p>No one has been approved yet.</p>';
}
document.addEventListener('click',async(e)=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.d){b.disabled=true;await api('/hub/api/admin/requests/'+b.dataset.i,{decision:b.dataset.d});load();}
 if(b.dataset.r){b.disabled=true;await api('/hub/api/admin/access/'+b.dataset.r+'/revoke',{});load();}});
load();
</script>`;
      res.set('Cache-Control', 'private, no-store').type('html').send(page({ title: 'Access admin', body, user, req, envName: envName(req) }));
    }));
  }

  /** For TaskList: may this signed-in user open /tasks/ through the permission table? */
  async function allowsTasklist(u) {
    if (!u || !u.emailVerified) return false;
    if (isOwnerEmail(u.email)) return true;
    return Boolean(await db.get("SELECT 1 AS ok FROM project_access WHERE user_id = $1 AND project_key = 'tasklist' AND status = 'active'", [String(u.id)]));
  }

  return { mount, gate, whoami, keys, isOwnerEmail, allowsTasklist, roleFor };
}

module.exports = { createHub, signToken, verifyToken, ownerEmails, TOKEN_HEADER, TOKEN_TTL_SECONDS };
