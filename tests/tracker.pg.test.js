/**
 * The Task Tracker and the ATIP snapshot store, end to end against a real
 * PostgreSQL: every DB-backed route, through HTTP, on the schema the app
 * creates for itself.
 *
 * Needs a database it may WIPE, named by TEST_DATABASE_URL, for example
 *
 *   TEST_DATABASE_URL=postgresql://bk_portal:pw@127.0.0.1:5432/bk_portal_test npm test
 *
 * Without TEST_DATABASE_URL these tests are skipped (and say so); CI always
 * sets it, against a PostgreSQL service container.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const URL_ = process.env.TEST_DATABASE_URL;
const skip = URL_ ? false : 'TEST_DATABASE_URL is not set (point it at a PostgreSQL database this test may wipe)';

const createDb = require('../portal/db.js');
const { createApp } = require('../portal/server.js');

let db;
let server;
let base;

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}

describe('Task Tracker on PostgreSQL', { skip }, () => {
  before(async () => {
    // Start from nothing, so the app's own CREATE TABLE runs.
    const { Client } = require('pg');
    const c = new Client({ connectionString: URL_ });
    await c.connect();
    await c.query('DROP TABLE IF EXISTS comments, tasks, projects, atip_snapshots CASCADE');
    await c.end();

    // Two processes starting at once (Passenger can do that) must not trip
    // over each other creating the tables.
    const env = { DATABASE_URL: URL_ };
    const [a, b] = await Promise.all([createDb({ env, quiet: true }), createDb({ env, quiet: true })]);
    await b.end();
    db = a;

    for (const k of ['TRACKER_USER', 'TRACKER_PASSWORD']) delete process.env[k];
    process.env.ATIP_USER = 'viewer';
    process.env.ATIP_PASSWORD = 'viewer-pw';
    process.env.ATIP_PUBLISH_TOKEN = 'publish-token';

    const { app } = createApp(db);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.end();
  });

  test('the schema is the PostgreSQL one, and re-running it is harmless', async () => {
    const cols = await db.all(`SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name IN ('id', 'created_at', 'planned_start', 'html')
      ORDER BY table_name, column_name`);
    const type = (t, c) => cols.find((r) => r.table_name === t && r.column_name === c)?.data_type;
    assert.equal(type('projects', 'id'), 'integer');
    assert.equal(type('projects', 'created_at'), 'timestamp without time zone');
    assert.equal(type('tasks', 'planned_start'), 'date');
    assert.equal(type('atip_snapshots', 'html'), 'text');
    const again = await createDb({ env: { DATABASE_URL: URL_ }, quiet: true });
    await again.end();
  });

  let projectId;
  let taskId;

  test('a project is created, read back with plain-text dates, and updated', async () => {
    const created = await call('POST', '/tasks/api/projects', {
      name: 'Hostel block', owner: 'Asha', status: 'In Progress',
      planned_start: '2026-10-01', planned_end: '2026-12-31', description: 'Phase 1',
    });
    assert.equal(created.status, 201, created.text);
    projectId = created.json.id;
    assert.ok(Number.isInteger(projectId));
    assert.equal(created.json.planned_start, '2026-10-01');
    assert.equal(created.json.planned_end, '2026-12-31');
    assert.match(created.json.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(created.json.task_count, 0);
    assert.equal(created.json.comment_count, 0);
    assert.equal(created.json.latest_comment, null);

    const updated = await call('PUT', `/tasks/api/projects/${projectId}`, {
      name: 'Hostel block A', status: 'On Hold', planned_start: '2026-10-02',
    });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json.name, 'Hostel block A');
    assert.equal(updated.json.status, 'On Hold');
    assert.equal(updated.json.planned_start, '2026-10-02');
    assert.equal(updated.json.planned_end, null);
  });

  test('a task is created inside the project and counted there', async () => {
    const created = await call('POST', '/tasks/api/tasks', {
      title: 'Pour foundation', project_id: projectId, actual_start: '2026-10-05',
    });
    assert.equal(created.status, 201, created.text);
    taskId = created.json.id;
    assert.equal(created.json.project_id, projectId);
    assert.equal(created.json.project_name, 'Hostel block A');
    assert.equal(created.json.actual_start, '2026-10-05');

    const project = await call('GET', `/tasks/api/projects/${projectId}`);
    assert.equal(project.json.task_count, 1);
    assert.deepEqual(project.json.tasks.map((t) => t.id), [taskId]);

    const moved = await call('PUT', `/tasks/api/tasks/${taskId}`, { title: 'Pour foundation (east)', project_id: '' });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.json.project_id, null);
    await call('PUT', `/tasks/api/tasks/${taskId}`, { title: 'Pour foundation (east)', project_id: projectId });
  });

  test('bad input is a 400 or a 404, never a 500', async () => {
    const cases = [
      ['POST', '/tasks/api/tasks', { title: 'x', project_id: 999999 }, 400],
      ['POST', '/tasks/api/tasks', { title: 'x', project_id: 'abc' }, 400],
      ['POST', '/tasks/api/tasks', { title: 'x', project_id: '99999999999' }, 400],
      ['POST', '/tasks/api/projects', { name: 'n'.repeat(201) }, 400],
      ['POST', '/tasks/api/projects', { name: 'n', planned_start: '2026-02-30' }, 400],
      ['POST', '/tasks/api/projects', { name: 'n', status: 'Nope' }, 400],
      ['GET', '/tasks/api/projects/abc', null, 404],
      ['GET', '/tasks/api/projects/99999999999', null, 404],
      ['GET', '/tasks/api/tasks/0', null, 404],
      ['PUT', '/tasks/api/tasks/abc', { title: 'x' }, 404],
      ['POST', '/tasks/api/tasks/abc/comments', { body: 'x' }, 404],
    ];
    for (const [method, path, body, want] of cases) {
      const r = await call(method, path, body);
      assert.equal(r.status, want, `${method} ${path} -> ${r.status} ${r.text}`);
    }
    const none = await call('GET', '/tasks/api/projects/abc/comments');
    assert.deepEqual(none.json, []);
  });

  test('status updates are stamped by the server, newest first, and summarised', async () => {
    for (const body of ['first', 'second', 'third']) {
      const r = await call('POST', `/tasks/api/tasks/${taskId}/comments`, { body });
      assert.equal(r.status, 201, r.text);
      assert.match(r.json.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    const all = await call('GET', `/tasks/api/tasks/${taskId}/comments`);
    assert.deepEqual(all.json.map((c) => c.body), ['third', 'second', 'first']);
    const two = await call('GET', `/tasks/api/tasks/${taskId}/comments?limit=2`);
    assert.equal(two.json.length, 2);

    const task = await call('GET', `/tasks/api/tasks/${taskId}`);
    assert.equal(task.json.latest_comment, 'third');
    assert.equal(task.json.comment_count, 3);
    assert.equal(task.json.updated_at, all.json[0].created_at);

    await call('POST', `/tasks/api/projects/${projectId}/comments`, { body: 'on hold for rain' });
    const overview = await call('GET', '/tasks/api/overview');
    assert.equal(overview.status, 200);
    const p = overview.json.projects.find((x) => x.id === projectId);
    assert.equal(p.latest_comment, 'on hold for rain');
    assert.equal(p.comment_count, 1);
    assert.equal(p.task_count, 1);
    assert.ok(overview.json.tasks.some((t) => t.id === taskId && t.project_name === 'Hostel block A'));
  });

  test('deleting a project keeps its tasks as independent tasks', async () => {
    const r = await call('DELETE', `/tasks/api/projects/${projectId}`);
    assert.deepEqual(r.json, { ok: true });
    assert.equal((await call('GET', `/tasks/api/projects/${projectId}`)).status, 404);
    const task = await call('GET', `/tasks/api/tasks/${taskId}`);
    assert.equal(task.status, 200);
    assert.equal(task.json.project_id, null);
    const left = await db.get("SELECT COUNT(*) AS n FROM comments WHERE entity_type = 'project'");
    assert.equal(left.n, 0);

    assert.deepEqual((await call('DELETE', `/tasks/api/tasks/${taskId}`)).json, { ok: true });
    assert.equal((await call('GET', `/tasks/api/tasks/${taskId}`)).status, 404);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM comments')).n, 0);
    assert.deepEqual((await call('DELETE', '/tasks/api/tasks/abc')).json, { ok: true });
  });

  test('an ATIP snapshot upload replaces the previous one and is served behind the login', async () => {
    const auth = { authorization: 'Bearer publish-token' };
    const page = (n) => `<html><head><title>t</title></head><body><p>snapshot ${n}</p></body></html>`;
    assert.equal((await call('POST', '/ATIP/api/snapshot', { html: page(1) }, { authorization: 'Bearer nope' })).status, 401);
    for (const n of [1, 2]) {
      const r = await call('POST', '/atip/api/snapshot', { html: page(n), trade_date: '2026-10-09', generated_at: '2026-10-09T15:30:00' }, auth);
      assert.equal(r.status, 200, r.text);
    }
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM atip_snapshots')).n, 1);

    const viewer = { authorization: 'Basic ' + Buffer.from('viewer:viewer-pw').toString('base64') };
    const shown = await call('GET', '/ATIP/', null, viewer);
    assert.equal(shown.status, 200);
    assert.match(shown.text, /snapshot 2/);
    assert.match(shown.text, /trade date 2026-10-09/);
    assert.match(shown.text, /uploaded just now/);
    assert.equal((await call('GET', '/ATIP/')).status, 401);
  });
});
