'use strict';

/* ============================================================
   TaskList at /tasklist/ — its own accounts, its own database.

     /tasklist/sign-in, /sign-up, /forgot-password, /reset-password, /verify
                           the sign-in pages (public/tasklist/auth.html)
     /tasklist/            the app (public/tasklist/app.html): Today,
                           Upcoming, Lists, Tags, Board, Search, Archive,
                           Settings; a signed-out visitor is sent to sign in
     /tasklist/api/auth/*  TaskList's own sign-in API (project-auth.js,
                           tables tl_*, cookie tl_sid on Path=/tasklist)
     /tasklist/api/*       the person's lists and tasks, nobody else's

   Every query is scoped to the signed-in user. A row from the old shared
   tracker (user_id NULL) belongs to nobody until tools/migrate_shared_id.mjs
   hands it to its owner, so it is never shown to anyone by accident.
   ============================================================ */

const path = require('path');
const express = require('express');
const { createProjectAuth } = require('./project-auth');
const quick = require('./public/tasklist/quickadd.js');

const BASE = '/tasklist';
const PUBLIC = path.join(__dirname, 'public', 'tasklist');
const STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const OPEN = ['Not Started', 'In Progress', 'On Hold'];
const AUTH_PAGES = ['sign-in', 'sign-up', 'forgot-password', 'reset-password', 'verify'];
const APP_PAGES = ['', 'today', 'upcoming', 'lists', 'tags', 'board', 'search', 'archive', 'settings', 'task', 'list', 'tag'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const nowUtc = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const MAX_ID = 2147483647;
function toId(v) {
  const s = String(v ?? '');
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_ID ? n : null;
}
function text(v, max, label) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters)`);
  return s;
}
function date(v, label) {
  const s = text(v, 10, label);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
  return s;
}
function time(v) {
  const s = text(v, 8, 'Time');
  if (!s) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(s);
  if (!m) throw new HttpError(400, 'Time must be HH:MM (24-hour, IST)');
  return `${m[1]}:${m[2]}`;
}
function tags(v) {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : String(v).split(/[\s,]+/);
  const out = [];
  for (const raw of list) {
    const t = String(raw || '').replace(/^#/, '').trim().toLowerCase();
    if (!t) continue;
    if (t.length > 40 || !/^[\p{L}\p{M}\p{N}_-]+$/u.test(t)) throw new HttpError(400, `Tag "${t.slice(0, 40)}" may use letters, numbers, - and _ only`);
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > 20) throw new HttpError(400, 'At most 20 tags');
  return out;
}
function attachments(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 20) throw new HttpError(400, 'Attachments must be a list of at most 20 links');
  return v.map((a) => {
    const url = String((a && a.url) || '').trim();
    if (!/^https:\/\/[^\s"<>]{3,500}$/.test(url)) throw new HttpError(400, 'An attachment link must start with https://');
    return { name: String((a && a.name) || url).trim().slice(0, 120), url };
  });
}

/** The fields a create or update may carry. `partial` keeps absent ones out. */
function readTask(body, { partial }) {
  const b = body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const out = {};
  if (!partial || has('title')) {
    out.title = text(b.title, 250, 'Title');
    if (!out.title) throw new HttpError(400, 'Give the task a title');
  }
  if (has('notes') || has('description')) out.description = text(has('notes') ? b.notes : b.description, 5000, 'Notes');
  if (has('due_date')) out.due_date = date(b.due_date, 'Due date');
  if (has('due_time')) out.due_time = time(b.due_time);
  if (has('priority')) {
    const p = Number(b.priority);
    if (!Number.isInteger(p) || p < 0 || p > 3) throw new HttpError(400, 'Priority is 0 (none) to 3 (high)');
    out.priority = p;
  }
  if (has('tags')) out.tags = tags(b.tags);
  if (has('recurrence')) {
    const r = b.recurrence || null;
    if (r && !quick.RECURRENCES.includes(r)) throw new HttpError(400, 'Unknown repeat rule');
    out.recurrence = r;
  }
  if (has('attachments')) out.attachments = JSON.stringify(attachments(b.attachments));
  if (has('status')) {
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Invalid status');
    out.status = b.status;
  }
  if (has('remind_at')) {
    const r = b.remind_at ? new Date(b.remind_at) : null;
    if (r && Number.isNaN(r.getTime())) throw new HttpError(400, 'Invalid reminder time');
    out.remind_at = r ? r.toISOString() : null;
  }
  if (has('position')) out.position = Number.isInteger(Number(b.position)) ? Number(b.position) : 0;
  // The old tracker's fields stay editable.
  for (const k of ['planned_start', 'planned_end', 'actual_start', 'actual_end']) if (has(k)) out[k] = date(b[k], k.replace('_', ' '));
  for (const k of ['current_step', 'next_step']) if (has(k)) out[k] = text(b[k], 5000, k.replace('_', ' '));
  if (has('owner')) out.owner = text(b.owner, 120, 'Owner');
  return out;
}

const TASK_COLS = `t.id, t.project_id AS list_id, t.parent_id, t.title, t.description AS notes, t.status, t.priority, t.tags,
  to_char(t.due_date, 'YYYY-MM-DD') AS due_date, to_char(t.due_time, 'HH24:MI') AS due_time, t.recurrence, t.attachments, t.position,
  t.completed_at, t.remind_at, t.created_at, t.updated_at, t.client_id, t.owner, t.planned_start, t.planned_end, t.actual_start, t.actual_end,
  t.current_step, t.next_step,
  (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id) AS subtask_count,
  (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.status = 'Completed') AS subtask_done,
  (SELECT COUNT(*) FROM comments WHERE entity_type = 'task' AND entity_id = t.id) AS comment_count`;

function createTaskList({ db, notify = {}, tier = () => 'prod', log = console, secret, realtime, report }) {
  const auth = createProjectAuth({
    db, key: 'tasklist', name: 'TaskList', base: BASE, cookie: 'tl_sid', prefix: 'tl_',
    allowSignUp: true, methods: ['otp', 'password'], notify, tier, log, secret,
    accountLinks: [{ label: 'Settings', href: `${BASE}/settings` }],
  });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  async function findTask(userId, id, q = db) {
    id = toId(id);
    if (!id) return null;
    return q.get(`SELECT ${TASK_COLS} FROM tasks t WHERE t.id = $1 AND t.user_id = $2`, [id, userId]);
  }
  async function ownList(userId, listId, q = db) {
    if (listId === undefined || listId === null || listId === '') return null;
    const id = toId(listId);
    if (!id || !(await q.get('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [id, userId]))) throw new HttpError(400, 'That list does not exist');
    return id;
  }

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }), (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(auth.requireUser, auth.csrfGuard);

  api.get('/bootstrap', wrap(async (req, res) => {
    const uid = req.user.id;
    const lists = await db.all(`SELECT p.id, p.name, p.color, p.sort_order,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = ANY($2) AND t.parent_id IS NULL) AS open_count
      FROM projects p WHERE p.user_id = $1 ORDER BY p.sort_order, p.name`, [uid, OPEN]);
    const tagRows = await db.all(`SELECT tag, COUNT(*) AS n FROM tasks, unnest(tags) AS tag WHERE user_id = $1 AND status = ANY($2) GROUP BY tag ORDER BY tag`, [uid, OPEN]);
    res.json({
      user: auth.publicUser(req.user), csrf: req.session.csrf, settings: req.user.settings || {},
      lists, tags: tagRows.map((r) => ({ tag: r.tag, count: r.n })), statuses: STATUSES, today: quick.istDay(Date.now()),
      features: { live: Boolean(realtime && realtime.enabled()), report: Boolean(report && req.user.role === 'owner') },
    });
  }));

  // Open tasks (default), done (archive), or all; filters by list, tag and text.
  api.get('/tasks', wrap(async (req, res) => {
    const where = ['t.user_id = $1'];
    const vals = [req.user.id];
    const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
    const status = String(req.query.status || 'open');
    if (status === 'open') add('t.status = ANY(?)', OPEN);
    else if (status === 'done') add('t.status = ANY(?)', ['Completed', 'Cancelled']);
    if (req.query.list) add('t.project_id = ?', toId(req.query.list) || 0);
    if (req.query.tag) add('? = ANY(t.tags)', String(req.query.tag).toLowerCase().slice(0, 40));
    if (req.query.q) {
      const q = `%${String(req.query.q).slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      vals.push(q);
      where.push(`(t.title ILIKE $${vals.length} OR t.description ILIKE $${vals.length})`);
    }
    if (req.query.parent) add('t.parent_id = ?', toId(req.query.parent) || 0);
    else if (!req.query.q) where.push('t.parent_id IS NULL');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
    const order = status === 'done' ? 't.completed_at DESC NULLS LAST, t.id DESC' : 't.due_date ASC NULLS LAST, t.due_time ASC NULLS LAST, t.priority DESC, t.position, t.id';
    const rows = await db.all(`SELECT ${TASK_COLS} FROM tasks t WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`, vals);
    res.json({ tasks: rows, today: quick.istDay(Date.now()) });
  }));

  api.get('/tasks/:id', wrap(async (req, res) => {
    const task = await findTask(req.user.id, req.params.id);
    if (!task) throw new HttpError(404, 'Task not found');
    const subtasks = await db.all(`SELECT ${TASK_COLS} FROM tasks t WHERE t.parent_id = $1 AND t.user_id = $2 ORDER BY t.position, t.id`, [task.id, req.user.id]);
    const comments = await db.all("SELECT id, body, created_at FROM comments WHERE entity_type = 'task' AND entity_id = $1 ORDER BY id DESC LIMIT 200", [task.id]);
    res.json({ ...task, subtasks, comments });
  }));

  async function insertTask(q, uid, body) {
    const t = readTask(body, { partial: false });
    const listId = await ownList(uid, body.list_id, q);
    let parentId = null;
    if (body.parent_id) {
      const parent = await q.get('SELECT id, project_id FROM tasks WHERE id = $1 AND user_id = $2', [toId(body.parent_id) || 0, uid]);
      if (!parent) throw new HttpError(400, 'The parent task does not exist');
      parentId = parent.id;
    }
    const clientId = text(body.client_id, 40, 'client_id');
    if (clientId && !/^[A-Za-z0-9_-]+$/.test(clientId)) throw new HttpError(400, 'client_id may use letters, numbers, - and _');
    const now = nowUtc();
    const cols = { user_id: uid, project_id: listId, parent_id: parentId, client_id: clientId, status: t.status || 'Not Started', created_at: now, updated_at: now, ...t };
    if (cols.status === 'Completed') cols.completed_at = now;
    const keys = Object.keys(cols);
    // Replaying a create that already arrived (an offline queue retrying) returns the first one.
    const row = await q.get(`INSERT INTO tasks (${keys.join(', ')}) VALUES (${keys.map((k, i) => (k === 'tags' ? `$${i + 1}::text[]` : k === 'attachments' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})
      ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id`, keys.map((k) => cols[k]));
    if (row) return row.id;
    const existing = await q.get('SELECT id FROM tasks WHERE user_id = $1 AND client_id = $2', [uid, clientId]);
    return existing.id;
  }

  api.post('/tasks', wrap(async (req, res) => {
    const id = await db.tx((q) => insertTask(q, req.user.id, req.body || {}));
    res.status(201).json(await findTask(req.user.id, id));
  }));

  // One line: "Call vendor tomorrow 5pm #gokesari" (the app parses as you type; this is for other clients).
  api.post('/quick-add', wrap(async (req, res) => {
    const parsed = quick.parse(String((req.body || {}).text || '').slice(0, 500));
    if (!parsed.title) throw new HttpError(400, 'Give the task a title');
    let listId = null;
    if (parsed.list) {
      const l = await db.get('SELECT id FROM projects WHERE user_id = $1 AND lower(name) = lower($2)', [req.user.id, parsed.list.replace(/[-_]/g, ' ')]);
      listId = l ? l.id : null;
    }
    const id = await db.tx((q) => insertTask(q, req.user.id, { ...parsed, list_id: listId, client_id: (req.body || {}).client_id }));
    res.status(201).json({ task: await findTask(req.user.id, id), parsed });
  }));

  api.patch('/tasks/:id', wrap(async (req, res) => {
    const uid = req.user.id;
    const before = await findTask(uid, req.params.id);
    if (!before) throw new HttpError(404, 'Task not found');
    const b = req.body || {};
    const t = readTask(b, { partial: true });
    if (Object.prototype.hasOwnProperty.call(b, 'list_id')) t.project_id = await ownList(uid, b.list_id);
    const now = nowUtc();
    let next = null;
    if (t.status) {
      if (t.status === 'Completed' && before.status !== 'Completed') {
        t.completed_at = now;
        // A repeating task: this one is done, the next one is due.
        const rec = t.recurrence !== undefined ? t.recurrence : before.recurrence;
        const due = t.due_date !== undefined ? t.due_date : before.due_date;
        if (rec) next = { due: quick.nextDue(due || quick.istDay(Date.now()), rec), rec };
      } else if (t.status !== 'Completed') t.completed_at = null;
    }
    t.updated_at = now;
    const keys = Object.keys(t);
    await db.tx(async (q) => {
      await q.run(`UPDATE tasks SET ${keys.map((k, i) => `${k} = $${i + 1}${k === 'tags' ? '::text[]' : k === 'attachments' ? '::jsonb' : ''}`).join(', ')}
        WHERE id = $${keys.length + 1} AND user_id = $${keys.length + 2}`, [...keys.map((k) => t[k]), before.id, uid]);
      if (next && next.due) {
        await q.run(`INSERT INTO tasks (user_id, project_id, title, description, status, priority, tags, due_date, due_time, recurrence, attachments, created_at, updated_at)
          SELECT user_id, project_id, title, description, 'Not Started', priority, tags, $2, due_time, recurrence, attachments, $3, $3 FROM tasks WHERE id = $1`,
        [before.id, next.due, now]);
        await q.run('UPDATE tasks SET recurrence = NULL WHERE id = $1', [before.id]);
      }
    });
    res.json({ ...(await findTask(uid, before.id)), nextDue: next ? next.due : null });
  }));

  api.delete('/tasks/:id', wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (id) {
      await db.tx(async (q) => {
        await q.run("DELETE FROM comments WHERE entity_type = 'task' AND entity_id IN (SELECT id FROM tasks WHERE (id = $1 OR parent_id = $1) AND user_id = $2)", [id, req.user.id]);
        await q.run('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      });
    }
    res.json({ ok: true });
  }));

  // Board: the cards of one column, in their new order (drag and drop, or the keyboard).
  api.post('/board/move', wrap(async (req, res) => {
    const { status, ids } = req.body || {};
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid column');
    if (!Array.isArray(ids) || ids.length > 500) throw new HttpError(400, 'Send the column\'s task ids in order');
    const clean = ids.map(toId);
    if (clean.some((x) => !x)) throw new HttpError(400, 'Invalid task id');
    const now = nowUtc();
    await db.tx(async (q) => {
      for (let i = 0; i < clean.length; i++) {
        await q.run(`UPDATE tasks SET position = $1, status = $2, updated_at = $3,
          completed_at = CASE WHEN $6 THEN COALESCE(completed_at, $3) ELSE NULL END
          WHERE id = $4 AND user_id = $5`, [i, status, now, clean[i], req.user.id, status === 'Completed']);
      }
    });
    res.json({ ok: true });
  }));

  /* ---------- lists ---------- */
  api.post('/lists', wrap(async (req, res) => {
    const name = text((req.body || {}).name, 200, 'List name');
    if (!name) throw new HttpError(400, 'Name the list');
    const color = /^#[0-9a-fA-F]{6}$/.test((req.body || {}).color || '') ? req.body.color : null;
    const now = nowUtc();
    const r = await db.get(`INSERT INTO projects (user_id, name, color, status, created_at, updated_at) VALUES ($1,$2,$3,'In Progress',$4,$4) RETURNING id, name, color, sort_order`,
      [req.user.id, name, color, now]);
    res.status(201).json(r);
  }));
  api.patch('/lists/:id', wrap(async (req, res) => {
    const id = await ownList(req.user.id, req.params.id).catch(() => null);
    if (!id) throw new HttpError(404, 'List not found');
    const b = req.body || {};
    const name = b.name !== undefined ? text(b.name, 200, 'List name') : undefined;
    if (b.name !== undefined && !name) throw new HttpError(400, 'Name the list');
    const r = await db.get(`UPDATE projects SET name = COALESCE($1, name), sort_order = COALESCE($2, sort_order), updated_at = $3 WHERE id = $4 AND user_id = $5 RETURNING id, name, color, sort_order`,
      [name ?? null, Number.isInteger(b.sort_order) ? b.sort_order : null, nowUtc(), id, req.user.id]);
    res.json(r);
  }));
  // Deleting a list keeps its tasks: they move to the inbox.
  api.delete('/lists/:id', wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (id) {
      await db.tx(async (q) => {
        await q.run('UPDATE tasks SET project_id = NULL WHERE project_id = $1 AND user_id = $2', [id, req.user.id]);
        await q.run("DELETE FROM comments WHERE entity_type = 'project' AND entity_id = $1 AND EXISTS (SELECT 1 FROM projects WHERE id = $1 AND user_id = $2)", [id, req.user.id]);
        await q.run('DELETE FROM projects WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      });
    }
    res.json({ ok: true });
  }));

  /* ---------- status updates (the tracker's comments) ---------- */
  api.post('/tasks/:id/comments', wrap(async (req, res) => {
    const task = await findTask(req.user.id, req.params.id);
    if (!task) throw new HttpError(404, 'Task not found');
    const body = text((req.body || {}).body, 5000, 'Update');
    if (!body) throw new HttpError(400, 'Write the update first');
    const now = nowUtc();
    const r = await db.tx(async (q) => {
      const row = await q.get("INSERT INTO comments (entity_type, entity_id, body, created_at) VALUES ('task',$1,$2,$3) RETURNING id", [task.id, body, now]);
      await q.run('UPDATE tasks SET updated_at = $1 WHERE id = $2', [now, task.id]);
      return row;
    });
    res.status(201).json({ id: r.id, body, created_at: now });
  }));

  /* ---------- settings, export, delete (DPDP) ---------- */
  api.put('/settings', wrap(async (req, res) => {
    const b = req.body || {};
    const s = {
      reminders: Boolean(b.reminders),
      reminderLead: [0, 5, 10, 15, 30, 60].includes(Number(b.reminderLead)) ? Number(b.reminderLead) : 10,
      emailDigest: Boolean(b.emailDigest),
      startView: ['today', 'upcoming', 'board'].includes(b.startView) ? b.startView : 'today',
      defaultList: toId(b.defaultList) || null,
    };
    await db.run('UPDATE tl_users SET settings = $1::jsonb WHERE id = $2', [JSON.stringify(s), req.user.id]);
    res.json({ settings: s });
  }));

  api.get('/export', wrap(async (req, res) => {
    const uid = req.user.id;
    const data = {
      exported_at: new Date().toISOString(), project: 'TaskList (bkesari.com)',
      account: auth.publicUser(req.user),
      lists: await db.all('SELECT id, name, color, created_at FROM projects WHERE user_id = $1 ORDER BY id', [uid]),
      tasks: await db.all(`SELECT ${TASK_COLS} FROM tasks t WHERE t.user_id = $1 ORDER BY t.id`, [uid]),
      updates: await db.all("SELECT c.entity_id AS task_id, c.body, c.created_at FROM comments c JOIN tasks t ON t.id = c.entity_id AND c.entity_type = 'task' WHERE t.user_id = $1 ORDER BY c.id", [uid]),
    };
    await auth.audit(uid, req.user.email || req.user.mobile, 'data-export', null, req);
    res.set('Content-Disposition', 'attachment; filename="tasklist-export.json"').json(data);
  }));

  api.post('/account/delete', wrap(async (req, res) => {
    if ((req.body || {}).confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm');
    const uid = req.user.id;
    await db.tx(async (q) => {
      await q.run("DELETE FROM comments WHERE entity_type = 'task' AND entity_id IN (SELECT id FROM tasks WHERE user_id = $1)", [uid]);
      await q.run("DELETE FROM comments WHERE entity_type = 'project' AND entity_id IN (SELECT id FROM projects WHERE user_id = $1)", [uid]);
      await q.run('DELETE FROM tasks WHERE user_id = $1', [uid]);
      await q.run('DELETE FROM projects WHERE user_id = $1', [uid]);
      await q.run('DELETE FROM tl_users WHERE id = $1', [uid]); // sessions, resets cascade
    });
    await auth.audit(null, `user ${uid}`, 'account-deleted', null, req);
    auth.setCookie(req, res, 'tl_sid=', { maxAge: 0 });
    res.json({ ok: true });
  }));

  /* ---------- optional Neon services ---------- */
  api.get('/live', wrap(async (req, res) => {
    if (!realtime || !realtime.enabled()) throw new HttpError(404, 'Live updates are not configured');
    res.json(await realtime.sealTrackerChanges());
  }));
  api.get('/report', wrap(async (req, res) => {
    if (!report || req.user.role !== 'owner') throw new HttpError(404, 'The report is not available');
    try { res.json(await report()); } catch (err) { throw new HttpError(err.status || 502, err.message); }
  }));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  api.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof auth.AuthError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON' });
    const PG_BAD_INPUT = { 22001: 'Text is too long', 22003: 'A number is out of range', 22007: 'Invalid date', 22008: 'Invalid date', '22P02': 'Invalid value', 23503: 'A referenced record does not exist' };
    if (err && PG_BAD_INPUT[err.code]) return res.status(400).json({ error: PG_BAD_INPUT[err.code] });
    log.error(err);
    return res.status(500).json({ error: 'Server error' });
  });

  /** Mounts everything under /tasklist. Call after the hub's own body parsers are fine: each router parses its own. */
  function mount(app) {
    // The old Task Tracker's address: pages go to TaskList, its API is gone.
    app.all(['/tasks/api', '/tasks/api/*'], (req, res) => res.status(410).json({ error: 'The Task Tracker moved to TaskList at /tasklist/, with its own sign-in.', moved: `${BASE}/` }));
    app.get(['/tasks', '/tasks/*'], (req, res) => res.redirect(301, `${BASE}/`));
    // Express matches /tasklist/ here too, so check the exact path.
    app.get(BASE, (req, res, next) => (req.path === BASE ? res.redirect(301, `${BASE}/${req.url.slice(BASE.length)}`) : next()));

    auth.mount(app, `${BASE}/api/auth`);
    app.use(`${BASE}/api`, api);

    const send = (file) => (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(PUBLIC, file));
    };
    app.get(AUTH_PAGES.map((p) => `${BASE}/${p}`), send('auth.html'));
    // App pages need a session; a visitor without one goes to sign in first.
    app.get(APP_PAGES.map((p) => (p === 'task' || p === 'list' || p === 'tag' ? `${BASE}/${p}/:id` : `${BASE}/${p}`)), wrap(async (req, res) => {
      const s = await auth.currentSession(req);
      if (!s) return res.redirect(302, `${BASE}/sign-in${req.path === `${BASE}/` ? '' : `?next=${encodeURIComponent(req.originalUrl)}`}`);
      res.set('Cache-Control', 'private, no-cache');
      res.sendFile(path.join(PUBLIC, 'app.html'));
    }));
    // The worker must be re-checked on every visit.
    app.get(`${BASE}/sw.js`, (req, res) => { res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': `${BASE}/` }); res.sendFile(path.join(PUBLIC, 'sw.js')); });
  }

  return { mount, auth, BASE };
}

module.exports = { createTaskList, readTask, STATUSES, BASE, HttpError };
