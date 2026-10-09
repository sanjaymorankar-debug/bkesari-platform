const path = require('path');
const crypto = require('crypto');
const express = require('express');
const createDb = require('./db');
// The one definition of the top menu, shared with every browser page.
const menu = require('./public/shared/menu.js');
// Serves the projects that live in their own apps under their own tab paths.
const proxy = require('./proxy');
// Central login, RBAC and subscriptions. Off unless AUTH_ENABLED is set.
const { createAuth } = require('./auth');
const { tabsFor, accountFor } = require('./auth/menu-tabs');

/* ============================================================
   bkesari.com
     /            -> welcome portal (public/index.html)
     /tasks/      -> Task Tracker UI (public/tasks/index.html)
     /tasks/api/  -> Task Tracker REST API
     /atip/       -> read-only ATIP snapshot, menu rendered server-side
     /auth/       -> central login, admin panel, OpenID provider (AUTH_ENABLED)
     other tabs   -> served here when static, else a "not on this tier" page
   ============================================================ */

const STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const TYPES = { projects: 'project', tasks: 'task' };

// UTC "YYYY-MM-DD HH:MM:SS" - same format for MySQL DATETIME and SQLite TEXT.
function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (max && s.length > max) throw new HttpError(400, `Text is too long (max ${max} characters)`);
  return s;
}

function cleanDate(v, label) {
  const s = cleanText(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + 'T00:00:00Z'))) {
    throw new HttpError(400, `${label} must be a valid date`);
  }
  return s;
}

// Shared fields for projects and tasks; `nameField` is "name" or "title".
function readItem(body, nameField) {
  body = body || {};
  const item = {
    [nameField]: cleanText(body[nameField], 250),
    description: cleanText(body.description, 5000),
    owner: cleanText(body.owner, 120),
    status: cleanText(body.status) || 'Not Started',
    planned_start: cleanDate(body.planned_start, 'Planned start date'),
    planned_end: cleanDate(body.planned_end, 'Planned end date'),
    actual_start: cleanDate(body.actual_start, 'Actual start date'),
    actual_end: cleanDate(body.actual_end, 'Actual end date'),
    current_step: cleanText(body.current_step, 5000),
    next_step: cleanText(body.next_step, 5000),
  };
  if (!item[nameField]) throw new HttpError(400, nameField === 'name' ? 'Project name is required' : 'Task title is required');
  if (!STATUSES.includes(item.status)) throw new HttpError(400, 'Invalid status');
  if (item.planned_start && item.planned_end && item.planned_end < item.planned_start) {
    throw new HttpError(400, 'Planned end date cannot be before planned start date');
  }
  if (item.actual_start && item.actual_end && item.actual_end < item.actual_start) {
    throw new HttpError(400, 'Actual end date cannot be before actual start date');
  }
  return item;
}

const LATEST_COMMENT = (type, alias) => `
  (SELECT c.body FROM comments c WHERE c.id = (SELECT MAX(id) FROM comments WHERE entity_type='${type}' AND entity_id=${alias}.id)) AS latest_comment,
  (SELECT c.created_at FROM comments c WHERE c.id = (SELECT MAX(id) FROM comments WHERE entity_type='${type}' AND entity_id=${alias}.id)) AS latest_comment_at,
  (SELECT COUNT(*) FROM comments WHERE entity_type='${type}' AND entity_id=${alias}.id) AS comment_count`;

function same(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// HTTP Basic auth from two env vars. When they are unset, `failClosed`
// decides between letting everyone in (local use) and refusing everyone.
function basicAuth(userVar, passVar, realm, failClosed) {
  return (req, res, next) => {
    const user = process.env[userVar];
    const pass = process.env[passVar];
    if (!user || !pass) {
      if (!failClosed) return next();
      return res.status(503).send(`${realm} is not configured: set ${userVar} and ${passVar} on the server.`);
    }
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const i = decoded.indexOf(':');
      if (i >= 0 && same(decoded.slice(0, i), user) & same(decoded.slice(i + 1), pass)) return next();
    }
    res.set('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    res.status(401).send('Login required');
  };
}

/* ---------- ATIP read-only viewer ----------
   Served at both /atip/ (the path the menu links) and /ATIP/; every route below
   names both spellings.

   The ATIP machine pushes its rendered dashboard page here (see ATIP-DEV's
   publish_snapshot.py). This server never talks back to it. The page is served
   with a CSP that forbids network calls, and the order controls are hidden, so
   the hosted copy is view-only.

   If ATIP is instead hosted as the full interactive app, /ATIP/ is proxied to
   that server and this viewer is bypassed -- see ATIP-DEV/docs/HOSTED_DEPLOYMENT.md,
   which also lists the controls that exposure requires. */
const ATIP_READONLY_CSS = `<style id="bk-readonly">
  .acts,#pendBox,#modalBg,#brokerBanner,#brokerBanner2,button[onclick^="deleteRule"]{display:none!important}
  /* The shared menu takes the sticky slot above this, so the banner scrolls. */
  #bk-banner{position:static;z-index:9000;background:#1e293b;color:#e2e8f0;border-bottom:1px solid #334155;
    font:13px system-ui,sans-serif;padding:8px 14px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between}
  #bk-banner a{color:#93c5fd;text-decoration:none}
  #bk-banner b{color:#fbbf24}
</style>`;
const ATIP_CSP = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * Which tier this process is serving, for the menu's badge.
 *
 * APP_ENV wins when set; otherwise it is read from the Host header, so one
 * deployment artifact serves dev, test and production unchanged.
 */
function currentEnv(req) {
  const host = String((req && req.headers && req.headers.host) || '').split(':')[0];
  return menu.resolveEnv(host, process.env.APP_ENV);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

/**
 * Builds the hub without starting to listen, so tests can drive the real app.
 * Reads its settings from process.env, exactly as `npm start` does.
 */
async function createApp() {
  const db = await createDb();
  // null unless AUTH_ENABLED: every `if (auth)` below keeps the hub exactly as
  // it was on a tier that has not switched central login on.
  const auth = await createAuth();
  const app = express();
  app.disable('x-powered-by');
  // Rate limits and the audit log need the visitor's address, not the
  // hosting proxy's. Only set with auth on; nothing else reads req.ip.
  if (auth) app.set('trust proxy', auth.config.trustProxy);

  // Keep every tier but production out of search indexes. dev.bkesari.com and
  // test.bkesari.com carry the same real-looking content as production, so
  // without this they compete with it in search results and expose work in
  // progress. Driven by the tier rather than hard-coded, so one build still
  // serves all three and production is left untouched. A static robots.txt
  // could not do this: it would have to differ per tier.
  //
  // First, so it also covers the proxied projects below.
  //
  // The tier is also stated outright in a header. It decides which database
  // every project opens, so being able to ask a running site which tier it
  // thinks it is — `curl -I https://dev.bkesari.com` — is worth one header.
  // scripts/smoke-dev.sh checks it: before this existed it had to infer the
  // tier from the badge on an undeployed tab's placeholder, which quietly
  // stopped being possible as soon as the tabs were deployed.
  app.use((req, res, next) => {
    const env = currentEnv(req);
    res.set('X-Bkesari-Env', env);
    if (env !== 'prod') res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // Central login's edge gate: before a request reaches any project, the
  // session and the tab's subscription are checked (see portal/auth/gate.js).
  // Before the proxy for the reason given below, and it reads no body.
  if (auth) app.use(auth.gate.edge);

  // The hosted, interactive ATIP (ATIP_ORIGIN), behind the owner gate: the
  // owner is forwarded, everyone else falls through to the routes below and
  // ends in the same 404 as any missing path. Only with central login on —
  // without it there is no owner to recognise, so it is never exposed.
  if (auth && process.env.ATIP_ORIGIN) {
    const hosted = auth.gate.atipRouter();
    hosted.use(proxy.atipProxy(process.env.ATIP_ORIGIN));
    app.use(hosted);
  }

  // The projects that live in their own apps, each served under its own tab
  // path. Off until its origin is set, in which case its tab keeps falling
  // through to the "not on this tier yet" page further down.
  //
  // BEFORE THE BODY PARSERS, and that is not a style choice: express.json()
  // consumes the request stream, and the forwarded request still carries the
  // original Content-Length — so the app waits for bytes that never arrive and
  // the visitor hangs until the proxy timeout hands them a 502. Every POST
  // into a proxied project would do it. tests/proxy.test.js covers both
  // orders, so moving this fails the suite.
  const proxied = proxy.mount(app, {
    // The bar for the proxy's own error page. Takes the request so the tier
    // badge comes from the same place every other page gets it.
    renderMenu: (pathname, req) => menu.renderHtml({ pathname, env: currentEnv(req) }),
  });

  // The ATIP snapshot is a full HTML page, so its route gets a larger limit.
  // Both spellings are listed on every ATIP route below. Express's routing is
  // case-insensitive by default, so /ATIP/ already resolves -- but that is a
  // default someone can flip with `case sensitive routing`, and uploaders may be
  // configured with either /atip/api/snapshot or /ATIP/api/snapshot.
  // Naming both keeps old publishers working whatever that setting says.
  app.use(['/atip/api/snapshot', '/ATIP/api/snapshot'], express.json({ limit: '15mb' }));
  app.use(express.json({ limit: '1mb' }));

  if (auth) app.use('/auth', auth.router);

  const api = express.Router();

  async function findProject(id) {
    return db.get(`SELECT p.*, ${LATEST_COMMENT('project', 'p')},
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
      FROM projects p WHERE p.id = ?`, [id]);
  }

  async function findTask(id) {
    return db.get(`SELECT t.*, p.name AS project_name, ${LATEST_COMMENT('task', 't')}
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`, [id]);
  }

  async function requireProjectId(value) {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || !(await db.get('SELECT id FROM projects WHERE id = ?', [id]))) {
      throw new HttpError(400, 'Selected project does not exist');
    }
    return id;
  }

  api.get('/meta', (req, res) => res.json({ statuses: STATUSES }));

  // Everything the dashboard needs in one call.
  api.get('/overview', wrap(async (req, res) => {
    const projects = await db.all(`SELECT p.*, ${LATEST_COMMENT('project', 'p')},
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
      FROM projects p ORDER BY p.id DESC`);
    const tasks = await db.all(`SELECT t.*, p.name AS project_name, ${LATEST_COMMENT('task', 't')}
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id ORDER BY t.id DESC`);
    res.json({ projects, tasks, statuses: STATUSES });
  }));

  /* ---------- Projects ---------- */
  api.get('/projects/:id', wrap(async (req, res) => {
    const project = await findProject(req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    const tasks = await db.all(`SELECT t.*, ${LATEST_COMMENT('task', 't')} FROM tasks t WHERE t.project_id = ? ORDER BY t.id DESC`, [project.id]);
    res.json({ ...project, tasks });
  }));

  api.post('/projects', wrap(async (req, res) => {
    const p = readItem(req.body, 'name');
    const now = nowUtc();
    const r = await db.run(`INSERT INTO projects (name, description, owner, status, planned_start, planned_end, actual_start, actual_end, current_step, next_step, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.name, p.description, p.owner, p.status, p.planned_start, p.planned_end, p.actual_start, p.actual_end, p.current_step, p.next_step, now, now]);
    res.status(201).json(await findProject(r.insertId));
  }));

  api.put('/projects/:id', wrap(async (req, res) => {
    if (!(await findProject(req.params.id))) throw new HttpError(404, 'Project not found');
    const p = readItem(req.body, 'name');
    await db.run(`UPDATE projects SET name=?, description=?, owner=?, status=?, planned_start=?, planned_end=?, actual_start=?, actual_end=?, current_step=?, next_step=?, updated_at=? WHERE id=?`,
      [p.name, p.description, p.owner, p.status, p.planned_start, p.planned_end, p.actual_start, p.actual_end, p.current_step, p.next_step, nowUtc(), req.params.id]);
    res.json(await findProject(req.params.id));
  }));

  // Deleting a project keeps its tasks; they become independent tasks.
  api.delete('/projects/:id', wrap(async (req, res) => {
    await db.run('UPDATE tasks SET project_id = NULL WHERE project_id = ?', [req.params.id]);
    await db.run("DELETE FROM comments WHERE entity_type='project' AND entity_id = ?", [req.params.id]);
    await db.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  }));

  /* ---------- Tasks ---------- */
  api.get('/tasks/:id', wrap(async (req, res) => {
    const task = await findTask(req.params.id);
    if (!task) throw new HttpError(404, 'Task not found');
    res.json(task);
  }));

  api.post('/tasks', wrap(async (req, res) => {
    const t = readItem(req.body, 'title');
    const projectId = await requireProjectId(req.body.project_id);
    const now = nowUtc();
    const r = await db.run(`INSERT INTO tasks (project_id, title, description, owner, status, planned_start, planned_end, actual_start, actual_end, current_step, next_step, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [projectId, t.title, t.description, t.owner, t.status, t.planned_start, t.planned_end, t.actual_start, t.actual_end, t.current_step, t.next_step, now, now]);
    res.status(201).json(await findTask(r.insertId));
  }));

  api.put('/tasks/:id', wrap(async (req, res) => {
    if (!(await findTask(req.params.id))) throw new HttpError(404, 'Task not found');
    const t = readItem(req.body, 'title');
    const projectId = await requireProjectId(req.body.project_id);
    await db.run(`UPDATE tasks SET project_id=?, title=?, description=?, owner=?, status=?, planned_start=?, planned_end=?, actual_start=?, actual_end=?, current_step=?, next_step=?, updated_at=? WHERE id=?`,
      [projectId, t.title, t.description, t.owner, t.status, t.planned_start, t.planned_end, t.actual_start, t.actual_end, t.current_step, t.next_step, nowUtc(), req.params.id]);
    res.json(await findTask(req.params.id));
  }));

  api.delete('/tasks/:id', wrap(async (req, res) => {
    await db.run("DELETE FROM comments WHERE entity_type='task' AND entity_id = ?", [req.params.id]);
    await db.run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  }));

  /* ---------- Comments (status updates), newest first ---------- */
  api.get('/:kind(projects|tasks)/:id/comments', wrap(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
    const rows = await db.all(
      `SELECT id, body, created_at FROM comments WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC${limit ? ' LIMIT ' + limit : ''}`,
      [TYPES[req.params.kind], req.params.id]);
    res.json(rows);
  }));

  // The timestamp is always taken from the server clock at the moment of posting.
  api.post('/:kind(projects|tasks)/:id/comments', wrap(async (req, res) => {
    const type = TYPES[req.params.kind];
    const table = req.params.kind;
    if (!(await db.get(`SELECT id FROM ${table} WHERE id = ?`, [req.params.id]))) throw new HttpError(404, `${type} not found`);
    const body = cleanText((req.body || {}).body, 5000);
    if (!body) throw new HttpError(400, 'Comment cannot be empty');
    const now = nowUtc();
    const r = await db.run('INSERT INTO comments (entity_type, entity_id, body, created_at) VALUES (?,?,?,?)', [type, req.params.id, body, now]);
    await db.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, [now, req.params.id]);
    res.status(201).json({ id: r.insertId, body, created_at: now });
  }));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  api.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  // Express treats /tasks and /tasks/ as the same route, so check the raw path.
  const addSlash = (req, res, next) => {
    if (req.path.endsWith('/')) return next();
    res.redirect(302, req.path + '/');
  };
  app.get('/tasks', addSlash);
  // With central login gating /tasks/ (TASKLIST, tasklist.view / .manage),
  // the edge gate has already decided; otherwise the Basic auth login as before.
  if (!(auth && auth.config.gateTabs.includes('tasks'))) {
    app.use('/tasks', basicAuth('TRACKER_USER', 'TRACKER_PASSWORD', 'bkesari Task Tracker', false));
  }
  app.use('/tasks/api', api);

  // The ATIP routes. Without central login: Basic auth, as before. With it:
  // the owner gate, under which ATIP answers 404 to everyone but the owner,
  // exactly like a path that does not exist.
  const validPublishToken = (req) => {
    const token = process.env.ATIP_PUBLISH_TOKEN;
    const [scheme, given] = (req.headers.authorization || '').split(' ');
    return Boolean(token) && scheme === 'Bearer' && Boolean(given) && same(given, token);
  };
  const atip = auth
    ? auth.gate.atipRouter({ machine: (req) => req.method === 'POST' && /^\/atip\/api\/snapshot$/i.test(req.path) && validPublishToken(req) })
    : app;
  atip.get(['/atip', '/ATIP'], addSlash);
  const atipViewerAuth = auth ? (req, res, next) => next() : basicAuth('ATIP_USER', 'ATIP_PASSWORD', 'bkesari ATIP', true);
  // The bar on the ATIP page: the owner's own tabs when central login is on.
  const atipMenu = (req) => menu.renderHtml(auth
    ? { pathname: '/atip/', env: currentEnv(req), tabs: tabsFor(req._bkResolved), account: accountFor(req._bkResolved) }
    : { pathname: '/ATIP/', env: currentEnv(req) });

  // Upload from the ATIP machine: bearer token, not the viewer login.
  atip.post(['/atip/api/snapshot', '/ATIP/api/snapshot'], wrap(async (req, res) => {
    const token = process.env.ATIP_PUBLISH_TOKEN;
    const [scheme, given] = (req.headers.authorization || '').split(' ');
    if (!token) return res.status(503).json({ error: 'ATIP_PUBLISH_TOKEN is not set on the server' });
    if (scheme !== 'Bearer' || !given || !same(given, token)) return res.status(401).json({ error: 'Invalid token' });
    const { html, trade_date, generated_at } = req.body || {};
    if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) return res.status(400).json({ error: 'html is required' });
    const now = nowUtc();
    await db.run('INSERT INTO atip_snapshots (html, trade_date, generated_at, received_at) VALUES (?,?,?,?)',
      [html, cleanText(trade_date, 20), cleanText(generated_at, 40), now]);
    await db.run('DELETE FROM atip_snapshots WHERE id < (SELECT m FROM (SELECT MAX(id) AS m FROM atip_snapshots) AS latest)');
    if (auth) await auth.audit.record({ action: 'ATIP_SNAPSHOT_UPLOADED', detail: { trade_date: cleanText(trade_date, 20) }, req });
    res.json({ ok: true, received_at: now });
  }));

  atip.get(['/ATIP/', '/atip/'], atipViewerAuth, wrap(async (req, res) => {
    res.set('Content-Security-Policy', ATIP_CSP);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    const snap = await db.get('SELECT html, trade_date, generated_at, received_at FROM atip_snapshots ORDER BY id DESC LIMIT 1');
    if (!snap) {
      return res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATIP</title>
        <body style="font:15px system-ui;background:#0f172a;color:#e2e8f0;min-height:100vh;margin:0">
        ${atipMenu(req)}
        <div style="display:grid;place-items:center;padding:64px 16px;text-align:center">
        <div><h1 style="margin:0 0 8px">ATIP</h1><p>No dashboard snapshot has been published yet.</p></div></div>`);
    }
    const ageMin = Math.round((Date.now() - Date.parse(snap.received_at.replace(' ', 'T') + 'Z')) / 60000);
    const age = ageMin < 1 ? 'just now' : ageMin < 120 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} h ago`;
    const banner = `<div id="bk-banner"><span><a href="/">← bkesari</a> &nbsp; <b>Read-only view</b> · trade date ${escapeHtml(snap.trade_date)} · built ${escapeHtml((snap.generated_at || '').slice(0, 16))} IST · uploaded ${age}</span><span>Orders can only be placed on the ATIP machine.</span></div>`;
    // Rendered here rather than by the browser script: this page's CSP allows
    // inline scripts but not 'self', so an external <script> would be blocked.
    const top = atipMenu(req) + banner;
    let html = snap.html.replace(/<\/head>/i, `${ATIP_READONLY_CSS}</head>`);
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, m => m + top) : top + html;
    res.type('html').send(html);
  }));
  if (auth) app.use(atip);
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  // A tab whose destination is not deployed on this tier yet. Answer with a
  // short page carrying the menu, so navigation continues instead of
  // dead-ending on a bare 404 while the estate is still being assembled.
  //
  // Registered after express.static on purpose: the moment real files exist for
  // a tab — or an app is put behind its path — static or that route wins and
  // this stops firing for it, with nothing to remember to remove.
  app.get(menu.TABS.map((tab) => tab.path), (req, res) => {
    const tab = menu.TABS.find((t) => t.path === req.path) || { name: 'This project' };
    res.status(404).set('X-Robots-Tag', 'noindex').type('html').send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(tab.name)} — not on this tier yet</title></head>
<body style="margin:0;font:15px/1.5 'Inter',system-ui,sans-serif;background:#F6F4EF;color:#1B1D24">
${menu.renderHtml({ pathname: req.path, env: currentEnv(req) })}
<div style="max-width:620px;margin:0 auto;padding:56px 16px">
  <h1 style="font-size:26px;letter-spacing:-.02em;margin:0 0 10px">${escapeHtml(tab.name)}</h1>
  <p style="color:#5F6472;margin:0 0 6px">This tab is in the menu, but nothing is serving
  <code>${escapeHtml(req.path)}</code> on this tier yet.</p>
  <p style="color:#9A9EA9;margin:0">Everything else in the menu above still works.</p>
</div></body></html>`,
    );
  });

  return { app, auth, db, proxied };
}

async function main() {
  const { app, auth, proxied } = await createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`bkesari portal running at http://localhost:${port}`);
    console.log(`Task Tracker at http://localhost:${port}/tasks/`);
    if (auth) console.log(`Central login at http://localhost:${port}/auth/ (tier ${auth.config.tier}; gating ${auth.config.gateTabs.join(', ') || 'nothing'})`);
    if (!auth && !process.env.TRACKER_PASSWORD) console.warn('WARNING: TRACKER_USER/TRACKER_PASSWORD not set - the tracker is open to anyone who can reach it.');
    for (const route of proxied) console.log(`${route.path} -> ${route.target}`);
    if (!proxied.length) {
      console.log('No project origins set (MILK_ORIGIN, EDU_ORIGIN, LADWANI_ORIGIN);');
      console.log('those tabs will show the "not on this tier yet" page.');
    }
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { createApp };
