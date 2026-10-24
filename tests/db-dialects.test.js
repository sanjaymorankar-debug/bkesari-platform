/**
 * The database adapter, on both clients it claims to support.
 *
 * portal/db.js runs the same app SQL on MySQL (Hostinger production) and on
 * SQLite (local, zero-setup), against two hand-maintained schema files. Until
 * this file existed, only the SQLite half was ever executed: CI's smoke test
 * sets DB_CLIENT=sqlite, and tests/ covered the menu and the proxy but not the
 * database. So the MySQL schema, the MySQL branch of the adapter, and every
 * query's behaviour on MySQL were all unverified -- on the one client
 * production actually uses.
 *
 * The SQLite half of this file runs everywhere, with no setup. The MySQL half
 * runs only when TEST_MYSQL_NAME is set, and is skipped with a reason
 * otherwise, so `npm test` still works on a laptop with no server.
 *
 * Deliberately NOT the DB_* variables the app reads: this file deletes rows,
 * and if it took DB_NAME from the environment then a developer with a dev
 * database configured would have it emptied by running the tests. The
 * TEST_MYSQL_* names cannot be set by accident.
 *
 *   cp .env.test.example .env.test   # points at the local devstack
 *   npm run test:mysql
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const createDb = require('../portal/db.js');

const MYSQL_CONFIGURED = Boolean(process.env.TEST_MYSQL_NAME);
const POSTGRES_CONFIGURED = Boolean(process.env.TEST_PG_URL);

const BACKENDS = [
  {
    name: 'sqlite',
    skip: false,
    async open() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkesari-db-'));
      // db.js resolves SQLITE_PATH relative to portal/, so hand it an absolute path.
      return withEnv({ DB_CLIENT: 'sqlite', SQLITE_PATH: path.join(dir, 'test.db') }, createDb);
    },
  },
  {
    name: 'mysql',
    skip: MYSQL_CONFIGURED ? false : 'TEST_MYSQL_NAME is not set (see .env.test.example)',
    async open() {
      const db = await withEnv({
        DB_CLIENT: 'mysql',
        DB_HOST: process.env.TEST_MYSQL_HOST || '127.0.0.1',
        DB_PORT: process.env.TEST_MYSQL_PORT || '3306',
        DB_NAME: process.env.TEST_MYSQL_NAME,
        DB_USER: process.env.TEST_MYSQL_USER,
        DB_PASSWORD: process.env.TEST_MYSQL_PASSWORD,
      }, createDb);
      // Child rows first: tasks.project_id has a real foreign key on MySQL.
      await db.run('DELETE FROM comments');
      await db.run('DELETE FROM tasks');
      await db.run('DELETE FROM projects');
      await db.run('DELETE FROM atip_snapshots');
      return db;
    },
  },
  {
    // Neon. TEST_PG_URL, not DATABASE_URL, for the same reason as TEST_MYSQL_*:
    // `neon deploy` writes the real DATABASE_URL into .env.local.
    name: 'postgres',
    skip: POSTGRES_CONFIGURED ? false : 'TEST_PG_URL is not set (see .env.test.example)',
    async open() {
      const db = await withEnv({
        DB_CLIENT: 'postgres',
        DATABASE_URL: process.env.TEST_PG_URL,
        DATABASE_URL_UNPOOLED: process.env.TEST_PG_URL,
      }, createDb);
      await db.run('DELETE FROM comments');
      await db.run('DELETE FROM tasks');
      await db.run('DELETE FROM projects');
      await db.run('DELETE FROM atip_snapshots');
      return db;
    },
  },
];

/** Run `fn` with `vars` applied to process.env, then put the environment back. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NOW = '2026-03-04 05:06:07';          // exactly what server.js's nowUtc() produces
const A_DATE = '2026-03-04';                 // exactly what cleanDate() permits

/**
 * A row as a plain object, for comparing one client's rows against the other's.
 *
 * The two clients really do hand back different kinds of object: node:sqlite
 * returns null-prototype objects and mysql2 returns RowDataPacket instances.
 * Neither survives a strict deep-equal against an object literal. It makes no
 * difference to the app -- every row goes straight into res.json(), which only
 * walks own enumerable properties -- so this normalises the prototype away and
 * compares what is actually load-bearing: the keys and the values.
 */
const plain = (row) => (row === null ? null : { ...row });

/**
 * Opens a database for one test and closes it when that test ends.
 *
 * Every open() has to be paired with a close(): a MySQL pool holds the event
 * loop open, so a leaked one makes the whole run hang after the last
 * assertion rather than failing anything.
 */
async function open(backend, t) {
  const db = await backend.open();
  t.after(() => db.close());
  return db;
}

async function insertProject(db, name, overrides = {}) {
  const row = {
    description: null, owner: null, status: 'Not Started',
    planned_start: null, planned_end: null, actual_start: null, actual_end: null,
    current_step: null, next_step: null, ...overrides,
  };
  return db.run(
    `INSERT INTO projects (name, description, owner, status, planned_start, planned_end,
       actual_start, actual_end, current_step, next_step, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [name, row.description, row.owner, row.status, row.planned_start, row.planned_end,
     row.actual_start, row.actual_end, row.current_step, row.next_step, NOW, NOW]);
}

for (const backend of BACKENDS) {
  const opts = backend.skip ? { skip: backend.skip } : {};

  test(`${backend.name}: the schema bootstrap is idempotent`, opts, async (t) => {
    // createDb() applies the whole schema file on every startup, so a restart
    // against an existing database must not fail. On MySQL that also exercises
    // db.js splitting the file on ';' and running each statement separately.
    const first = await open(backend, t);
    await first.all('SELECT 1');
    const db = await open(backend, t);
    for (const table of ['projects', 'tasks', 'comments', 'atip_snapshots']) {
      assert.deepEqual(await db.all(`SELECT * FROM ${table} WHERE 1 = 0`), [],
        `${table} should exist and be selectable`);
    }
  });

  test(`${backend.name}: run() reports insertId and changes`, opts, async (t) => {
    const db = await open(backend, t);
    const first = await insertProject(db, 'First');
    const second = await insertProject(db, 'Second');

    assert.equal(typeof first.insertId, 'number');
    assert.equal(first.changes, 1);
    assert.equal(second.insertId, first.insertId + 1,
      'auto-increment ids must advance by one on both clients');

    // server.js calls findProject(r.insertId) straight after inserting, so a
    // wrong insertId would return somebody else's row rather than erroring.
    const row = await db.get('SELECT name FROM projects WHERE id = ?', [first.insertId]);
    assert.equal(row.name, 'First');

    const updated = await db.run('UPDATE projects SET owner = ? WHERE id = ?', ['Asha', second.insertId]);
    assert.equal(updated.changes, 1);
    const none = await db.run('UPDATE projects SET owner = ? WHERE id = ?', ['Asha', 99999]);
    assert.equal(none.changes, 0);
  });

  test(`${backend.name}: get() returns null, not undefined, when nothing matches`, opts, async (t) => {
    const db = await open(backend, t);
    // Every route tests `if (!row) throw 404`, which undefined would satisfy
    // too -- but `res.json(undefined)` and `res.json(null)` differ, so the
    // adapter normalising this is load-bearing.
    assert.equal(await db.get('SELECT id FROM projects WHERE id = ?', [99999]), null);
  });

  test(`${backend.name}: an undefined parameter binds as NULL`, opts, async (t) => {
    const db = await open(backend, t);
    // readItem() leaves absent optional fields undefined. The two drivers
    // disagree about that: node:sqlite throws ("Provided value cannot be
    // bound"), while mysql2 quietly coerces it to NULL. So toParams() is what
    // the SQLite path needs to not crash, and what keeps the MySQL path from
    // being the only one that works -- measured both ways, not assumed.
    const r = await db.run(
      `INSERT INTO projects (name, description, owner, status, planned_start, planned_end,
         actual_start, actual_end, current_step, next_step, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['Undefined fields', undefined, undefined, 'Not Started',
       undefined, undefined, undefined, undefined, undefined, undefined, NOW, NOW]);
    const row = await db.get('SELECT description, owner, planned_start FROM projects WHERE id = ?', [r.insertId]);
    assert.deepEqual(plain(row), { description: null, owner: null, planned_start: null });
  });

  test(`${backend.name}: dates and timestamps come back as the strings written`, opts, async (t) => {
    const db = await open(backend, t);
    // The MySQL columns are DATE and DATETIME while the SQLite ones are TEXT.
    // dateStrings:true in db.js is what keeps them identical -- without it
    // mysql2 returns Date objects and the API starts serialising
    // "2026-03-04T05:06:07.000Z" on one client and "2026-03-04 05:06:07" on
    // the other. nowUtc() and cleanDate() produce exactly these two formats.
    const r = await insertProject(db, 'Dated', { planned_start: A_DATE, planned_end: A_DATE });
    const row = await db.get(
      'SELECT planned_start, planned_end, created_at, updated_at FROM projects WHERE id = ?',
      [r.insertId]);
    assert.deepEqual(plain(row), {
      planned_start: A_DATE, planned_end: A_DATE, created_at: NOW, updated_at: NOW,
    });
  });

  test(`${backend.name}: the latest-comment subqueries agree`, opts, async (t) => {
    const db = await open(backend, t);
    const project = await insertProject(db, 'Commented');

    for (const body of ['oldest', 'middle', 'newest']) {
      await db.run('INSERT INTO comments (entity_type, entity_id, body, created_at) VALUES (?,?,?,?)',
        ['project', project.insertId, body, NOW]);
    }
    // A comment on a *task* with the same numeric id must not leak into the
    // project's latest comment: entity_id alone does not identify a row.
    await db.run('INSERT INTO comments (entity_type, entity_id, body, created_at) VALUES (?,?,?,?)',
      ['task', project.insertId, 'belongs to a task', NOW]);

    // The same correlated-subquery shape server.js builds in LATEST_COMMENT.
    const row = await db.get(`
      SELECT p.name,
        (SELECT c.body FROM comments c WHERE c.id = (SELECT MAX(id) FROM comments WHERE entity_type='project' AND entity_id=p.id)) AS latest_comment,
        (SELECT COUNT(*) FROM comments WHERE entity_type='project' AND entity_id=p.id) AS comment_count
      FROM projects p WHERE p.id = ?`, [project.insertId]);

    assert.equal(row.latest_comment, 'newest');
    assert.equal(Number(row.comment_count), 3);
  });

  test(`${backend.name}: the snapshot prune keeps only the newest row`, opts, async (t) => {
    const db = await open(backend, t);
    // This DELETE wraps MAX(id) in a derived table with an alias. The alias is
    // not decoration: MySQL rejects an unaliased derived table (errno 1248),
    // and reading the table you are deleting from directly is errno 1093.
    // SQLite accepts every form, so only MySQL proves this one is right.
    for (const day of ['2026-03-02', '2026-03-03', '2026-03-04']) {
      await db.run('INSERT INTO atip_snapshots (html, trade_date, generated_at, received_at) VALUES (?,?,?,?)',
        ['<html lang="en"></html>', day, day, NOW]);
    }
    await db.run('DELETE FROM atip_snapshots WHERE id < (SELECT m FROM (SELECT MAX(id) AS m FROM atip_snapshots) AS latest)');

    const rows = await db.all('SELECT trade_date FROM atip_snapshots');
    assert.deepEqual(rows.map((r) => r.trade_date), ['2026-03-04']);
  });

  test(`${backend.name}: deleting a project orphans its tasks rather than removing them`, opts, async (t) => {
    const db = await open(backend, t);
    const project = await insertProject(db, 'To delete');
    const task = await db.run(
      `INSERT INTO tasks (project_id, title, description, owner, status, planned_start, planned_end,
         actual_start, actual_end, current_step, next_step, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [project.insertId, 'Keeps going', null, null, 'Not Started',
       null, null, null, null, null, null, NOW, NOW]);

    // The documented behaviour of DELETE /api/projects/:id, in the order the
    // route does it. On MySQL the foreign key would reject the project delete
    // if the UPDATE had not run first, so the order is part of the contract.
    await db.run('UPDATE tasks SET project_id = NULL WHERE project_id = ?', [project.insertId]);
    await db.run("DELETE FROM comments WHERE entity_type='project' AND entity_id = ?", [project.insertId]);
    await db.run('DELETE FROM projects WHERE id = ?', [project.insertId]);

    const row = await db.get('SELECT title, project_id FROM tasks WHERE id = ?', [task.insertId]);
    assert.deepEqual(plain(row), { title: 'Keeps going', project_id: null });
  });
}

test('the three schema files declare the same tables and columns', async () => {
  // Nothing else keeps mysql_schema.sql and sqlite_schema.sql in step, and a
  // column added to one but not the other breaks only the client that is not
  // being tested -- which, before this file, was always the production one.
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'portal', 'sql', f), 'utf8');

  const tablesIn = (sql) => {
    const out = {};
    const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\)/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      out[m[1]] = m[2]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('--'))
        // Drop table-level clauses; only column names are being compared.
        .filter((line) => !/^(INDEX|CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY)\b/i.test(line))
        .map((line) => line.split(/\s+/)[0])
        .sort();
    }
    return out;
  };

  const mysql = tablesIn(read('mysql_schema.sql'));
  assert.ok(Object.keys(mysql).length >= 4, `expected the four tracker tables, got ${Object.keys(mysql)}`);

  for (const file of ['sqlite_schema.sql', 'postgres_schema.sql']) {
    const other = tablesIn(read(file));
    assert.deepEqual(Object.keys(other).sort(), Object.keys(mysql).sort(), `table names differ in ${file}`);
    for (const table of Object.keys(mysql)) {
      assert.deepEqual(other[table], mysql[table], `columns of ${table} differ between mysql_schema.sql and ${file}`);
    }
  }
});

test('toPgPlaceholders numbers ? in order and leaves quoted ones alone', () => {
  assert.equal(createDb.toPgPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?'),
    'SELECT * FROM t WHERE a = $1 AND b = $2');
  assert.equal(createDb.toPgPlaceholders("SELECT '?' AS q, \"why?\" FROM t WHERE id = ?"),
    "SELECT '?' AS q, \"why?\" FROM t WHERE id = $1");
});
