const path = require('path');
const crypto = require('crypto');
const express = require('express');
const createDb = require('./db');
// The one definition of the top menu, shared with every browser page.
const menu = require('./public/shared/menu.js');
// Serves the projects that live in their own apps under their own tab paths.
const proxy = require('./proxy');

/* ============================================================
   bkesari.com
     /            -> welcome portal (public/index.html)
     /tasks/      -> Task Tracker UI (public/tasks/index.html)
     /tasks/api/  -> Task Tracker REST API
     /atip/       -> read-only ATIP snapshot, menu rendered server-side
     other tabs   -> served here when static, else a "not on this tier" page
   ============================================================ */

const STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const TYPES = { projects: 'project', tasks: 'task' };

// UTC "YYYY-MM-DD HH:MM:SS", stored in PostgreSQL TIMESTAMP columns and read back as
// the same text (see the type parsers in db.js).
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
    // The column limits: projects.name is VARCHAR(200), tasks.title VARCHAR(250).
    [nameField]: cleanText(body[nameField], nameField === 'name' ? 200 : 250),
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

// Route ids are INTEGER columns. Anything else cannot match a row, and handing
// it to PostgreSQL would be a type error rather than "not found".
const MAX_ID = 2147483647;
function toId(value) {
  const s = String(value ?? '');
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_ID ? n : null;
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
 * True when express.static would serve this request from public/tasks/.
 *
 * The router matches the RAW path, but the file server percent-decodes it and
 * folds dot segments and repeated slashes before it looks for the file. So
 * /%74asks/, //tasks/ and /shared/../tasks/ never matched app.use('/tasks')
 * and its login, yet still reached public/tasks/index.html. This answers for
 * the path the file server will actually open (lower-cased, because on a
 * case-insensitive disk /TASKS/ is the same folder).
 */
function servesTrackerFile(rawPath) {
  let p;
  try { p = path.posix.normalize(decodeURIComponent(rawPath)).toLowerCase(); } catch { return false; }
  return p === '/tasks' || p.startsWith('/tasks/');
}

// The whole site as an Express app, given an open database (db.js). Split
// from main() so tests can drive it against a database of their own.
function createApp(db) {
  const app = express();
  app.disable('x-powered-by');

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

  // The projects that live in their own apps, each served under its own tab
  // path. Off until its origin is set, in which case its tab keeps falling
  // through to the "not on this tier yet" page further down.
  //
  // BEFORE THE BODY PARSERS, and that is not a style choice: express.json()
  // consumes the request stream, and the forwarded request still carries the
  // original Content-Length — so the app waits for bytes that never arrive and
  // the visitor hangs until the proxy timeout hands them a 502. Every POST
  // into a proxied project would do it. tests/proxy.test.js shows both
  // orders on a copy; tests/server.test.js fails if this one moves.
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

  const api = express.Router();

  async function findProject(id, q = db) {
    id = toId(id);
    if (!id) return null;
    return q.get(`SELECT p.*, ${LATEST_COMMENT('project', 'p')},
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
      FROM projects p WHERE p.id = $1`, [id]);
  }

  async function findTask(id, q = db) {
    id = toId(id);
    if (!id) return null;
    return q.get(`SELECT t.*, p.name AS project_name, ${LATEST_COMMENT('task', 't')}
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = $1`, [id]);
  }

  async function requireProjectId(value, q = db) {
    if (value === undefined || value === null || value === '') return null;
    const id = toId(value);
    if (!id || !(await q.get('SELECT id FROM projects WHERE id = $1', [id]))) {
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
    const tasks = await db.all(`SELECT t.*, ${LATEST_COMMENT('task', 't')} FROM tasks t WHERE t.project_id = $1 ORDER BY t.id DESC`, [project.id]);
    res.json({ ...project, tasks });
  }));

  api.post('/projects', wrap(async (req, res) => {
    const p = readItem(req.body, 'name');
    const now = nowUtc();
    const r = await db.get(`INSERT INTO projects (name, description, owner, status, planned_start, planned_end, actual_start, actual_end, current_step, next_step, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [p.name, p.description, p.owner, p.status, p.planned_start, p.planned_end, p.actual_start, p.actual_end, p.current_step, p.next_step, now, now]);
    res.status(201).json(await findProject(r.id));
  }));

  api.put('/projects/:id', wrap(async (req, res) => {
    if (!(await findProject(req.params.id))) throw new HttpError(404, 'Project not found');
    const id = toId(req.params.id);
    const p = readItem(req.body, 'name');
    await db.run(`UPDATE projects SET name=$1, description=$2, owner=$3, status=$4, planned_start=$5, planned_end=$6, actual_start=$7, actual_end=$8, current_step=$9, next_step=$10, updated_at=$11 WHERE id=$12`,
      [p.name, p.description, p.owner, p.status, p.planned_start, p.planned_end, p.actual_start, p.actual_end, p.current_step, p.next_step, nowUtc(), id]);
    res.json(await findProject(id));
  }));

  // Deleting a project keeps its tasks; they become independent tasks.
  api.delete('/projects/:id', wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (id) {
      await db.tx(async (q) => {
        await q.run('UPDATE tasks SET project_id = NULL WHERE project_id = $1', [id]);
        await q.run("DELETE FROM comments WHERE entity_type='project' AND entity_id = $1", [id]);
        await q.run('DELETE FROM projects WHERE id = $1', [id]);
      });
    }
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
    const r = await db.get(`INSERT INTO tasks (project_id, title, description, owner, status, planned_start, planned_end, actual_start, actual_end, current_step, next_step, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [projectId, t.title, t.description, t.owner, t.status, t.planned_start, t.planned_end, t.actual_start, t.actual_end, t.current_step, t.next_step, now, now]);
    res.status(201).json(await findTask(r.id));
  }));

  api.put('/tasks/:id', wrap(async (req, res) => {
    if (!(await findTask(req.params.id))) throw new HttpError(404, 'Task not found');
    const id = toId(req.params.id);
    const t = readItem(req.body, 'title');
    const projectId = await requireProjectId(req.body.project_id);
    await db.run(`UPDATE tasks SET project_id=$1, title=$2, description=$3, owner=$4, status=$5, planned_start=$6, planned_end=$7, actual_start=$8, actual_end=$9, current_step=$10, next_step=$11, updated_at=$12 WHERE id=$13`,
      [projectId, t.title, t.description, t.owner, t.status, t.planned_start, t.planned_end, t.actual_start, t.actual_end, t.current_step, t.next_step, nowUtc(), id]);
    res.json(await findTask(id));
  }));

  api.delete('/tasks/:id', wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (id) {
      await db.tx(async (q) => {
        await q.run("DELETE FROM comments WHERE entity_type='task' AND entity_id = $1", [id]);
        await q.run('DELETE FROM tasks WHERE id = $1', [id]);
      });
    }
    res.json({ ok: true });
  }));

  /* ---------- Comments (status updates), newest first ---------- */
  api.get('/:kind(projects|tasks)/:id/comments', wrap(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
    const id = toId(req.params.id);
    if (!id) return res.json([]);
    const rows = await db.all(
      `SELECT id, body, created_at FROM comments WHERE entity_type = $1 AND entity_id = $2 ORDER BY id DESC${limit ? ' LIMIT ' + limit : ''}`,
      [TYPES[req.params.kind], id]);
    res.json(rows);
  }));

  // The timestamp is always taken from the server clock at the moment of posting.
  api.post('/:kind(projects|tasks)/:id/comments', wrap(async (req, res) => {
    const type = TYPES[req.params.kind];
    const table = req.params.kind; // 'projects' or 'tasks' only: the route pattern allows nothing else
    const id = toId(req.params.id);
    if (!id || !(await db.get(`SELECT id FROM ${table} WHERE id = $1`, [id]))) throw new HttpError(404, `${type} not found`);
    const body = cleanText((req.body || {}).body, 5000);
    if (!body) throw new HttpError(400, 'Comment cannot be empty');
    const now = nowUtc();
    const r = await db.tx(async (q) => {
      const row = await q.get('INSERT INTO comments (entity_type, entity_id, body, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [type, id, body, now]);
      await q.run(`UPDATE ${table} SET updated_at = $1 WHERE id = $2`, [now, id]);
      return row;
    });
    res.status(201).json({ id: r.id, body, created_at: now });
  }));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  api.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    // PostgreSQL SQLSTATEs that mean the request carried bad data, not that the
    // server broke. Validation above should catch these first; this is the net.
    const PG_BAD_INPUT = {
      '22001': 'Text is too long',          // string_data_right_truncation
      '22003': 'A number is out of range',  // numeric_value_out_of_range
      '22007': 'Invalid date',              // invalid_datetime_format
      '22008': 'Invalid date',              // datetime_field_overflow
      '22P02': 'Invalid value',             // invalid_text_representation
      '23503': 'A referenced record does not exist', // foreign_key_violation
    };
    if (err && PG_BAD_INPUT[err.code]) return res.status(400).json({ error: PG_BAD_INPUT[err.code] });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  // Express treats /tasks and /tasks/ as the same route, so check the raw path.
  app.get(['/tasks', '/atip', '/ATIP'], (req, res, next) => {
    if (req.path.endsWith('/')) return next();
    res.redirect(302, req.path + '/');
  });
  const trackerAuth = basicAuth('TRACKER_USER', 'TRACKER_PASSWORD', 'bkesari Task Tracker', false);
  app.use('/tasks', trackerAuth);
  app.use('/tasks/api', api);

  // Upload from the ATIP machine: bearer token, not the viewer login.
  app.post(['/atip/api/snapshot', '/ATIP/api/snapshot'], wrap(async (req, res) => {
    const token = process.env.ATIP_PUBLISH_TOKEN;
    const [scheme, given] = (req.headers.authorization || '').split(' ');
    if (!token) return res.status(503).json({ error: 'ATIP_PUBLISH_TOKEN is not set on the server' });
    if (scheme !== 'Bearer' || !given || !same(given, token)) return res.status(401).json({ error: 'Invalid token' });
    const { html, trade_date, generated_at } = req.body || {};
    if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) return res.status(400).json({ error: 'html is required' });
    const now = nowUtc();
    // One statement: store the new page and drop every older one.
    await db.run(`WITH latest AS (
        INSERT INTO atip_snapshots (html, trade_date, generated_at, received_at) VALUES ($1,$2,$3,$4) RETURNING id)
      DELETE FROM atip_snapshots WHERE id < (SELECT id FROM latest)`,
      [html, cleanText(trade_date, 20), cleanText(generated_at, 40), now]);
    res.json({ ok: true, received_at: now });
  }));

  app.get(['/ATIP/', '/atip/'], basicAuth('ATIP_USER', 'ATIP_PASSWORD', 'bkesari ATIP', true), wrap(async (req, res) => {
    res.set('Content-Security-Policy', ATIP_CSP);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    const snap = await db.get('SELECT html, trade_date, generated_at, received_at FROM atip_snapshots ORDER BY id DESC LIMIT 1');
    if (!snap) {
      return res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATIP</title>
        <body style="font:15px system-ui;background:#0f172a;color:#e2e8f0;min-height:100vh;margin:0">
        ${menu.renderHtml({ pathname: '/ATIP/', env: currentEnv(req) })}
        <div style="display:grid;place-items:center;padding:64px 16px;text-align:center">
        <div><h1 style="margin:0 0 8px">ATIP</h1><p>No dashboard snapshot has been published yet.</p></div></div>`);
    }
    const ageMin = Math.round((Date.now() - Date.parse(snap.received_at.replace(' ', 'T') + 'Z')) / 60000);
    const age = ageMin < 1 ? 'just now' : ageMin < 120 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} h ago`;
    const banner = `<div id="bk-banner"><span><a href="/">← bkesari</a> &nbsp; <b>Read-only view</b> · trade date ${escapeHtml(snap.trade_date)} · built ${escapeHtml((snap.generated_at || '').slice(0, 16))} IST · uploaded ${age}</span><span>Orders can only be placed on the ATIP machine.</span></div>`;
    // Rendered here rather than by the browser script: this page's CSP allows
    // inline scripts but not 'self', so an external <script> would be blocked.
    const top = menu.renderHtml({ pathname: '/ATIP/', env: currentEnv(req) }) + banner;
    // The stylesheet that hides the order controls goes in the head, after the
    // page's own styles. A page may have no </head> at all (it is optional in
    // HTML), and then the controls would show: put it at the top instead.
    const hasHead = /<\/head>/i.test(snap.html);
    let html = hasHead ? snap.html.replace(/<\/head>/i, `${ATIP_READONLY_CSS}</head>`) : snap.html;
    const lead = (hasHead ? '' : ATIP_READONLY_CSS) + top;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, m => m + lead) : lead + html;
    res.type('html').send(html);
  }));
  // The tracker's page, however its path is spelled, goes through the same
  // login as /tasks/ above (see servesTrackerFile).
  app.use((req, res, next) => (servesTrackerFile(req.path) ? trackerAuth(req, res, next) : next()));
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

  // Last: any error nothing above answered. Express's own handler sends the
  // stack trace whenever NODE_ENV is not "production" (locally, in CI, and on
  // any host that does not set it), and a malformed JSON body reached it on
  // every path, before any login. Answer with the status and a plain message.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number(err.status || err.statusCode) >= 400 ? Number(err.status || err.statusCode) : 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Server error'
      : err.type === 'entity.parse.failed' ? 'The request body is not valid JSON'
      : err.type === 'entity.too.large' ? 'The request body is too large'
      : 'Bad request';
    res.status(status).json({ error: message });
  });

  return { app, proxied };
}

async function main() {
  const db = await createDb();
  const { app, proxied } = createApp(db);
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`bkesari portal running at http://localhost:${port}`);
    console.log(`Task Tracker at http://localhost:${port}/tasks/`);
    if (!process.env.TRACKER_PASSWORD) console.warn('WARNING: TRACKER_USER/TRACKER_PASSWORD not set - the tracker is open to anyone who can reach it.');
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
