/**
 * portal/db.js on a real PostgreSQL: the schema the app creates for itself, and
 * how the pool behaves when the server drops a connection, which Neon does when
 * it suspends an idle compute.
 *
 * Needs a database it may WIPE, named by TEST_DATABASE_URL; the file works in a
 * schema of its own there (tests/support/pg.js). Skipped without it, which CI
 * counts as a failure.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const createDb = require('../portal/db.js');
const { skip, freshSchema } = require('./support/pg.js');

let URL_;

describe('the portal schema on PostgreSQL', { skip }, () => {
  before(async () => { ({ url: URL_ } = await freshSchema('db')); });

  test('the schema is the PostgreSQL one, two processes can create it at once, and re-running it is harmless', async () => {
    const env = { DATABASE_URL: URL_ };
    const [a, b] = await Promise.all([createDb({ env, quiet: true }), createDb({ env, quiet: true })]);
    await b.end();
    const cols = await a.all(`SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name IN ('id', 'created_at', 'planned_start', 'html', 'tags', 'due_time', 'locked_until')
      ORDER BY table_name, column_name`);
    const type = (t, c) => cols.find((r) => r.table_name === t && r.column_name === c)?.data_type;
    assert.equal(type('projects', 'id'), 'integer');
    assert.equal(type('projects', 'created_at'), 'timestamp without time zone');
    assert.equal(type('tasks', 'planned_start'), 'date');
    assert.equal(type('tasks', 'tags'), 'ARRAY');
    assert.equal(type('tasks', 'due_time'), 'time without time zone');
    assert.equal(type('tl_users', 'locked_until'), 'timestamp with time zone');
    assert.equal(type('hub_admin_users', 'locked_until'), 'timestamp with time zone');
    assert.equal(type('atip_snapshots', 'html'), 'text');
    const tiles = await a.all('SELECT key FROM hub_tiles ORDER BY sort_order');
    assert.deepEqual(tiles.map((r) => r.key), ['ladwani', 'education', 'tasklist', 'atip', 'driving', 'environment']);
    await a.end();
    const again = await createDb({ env, quiet: true });
    await again.end();
  });
});

/**
 * portal/db.js itself, on the same throwaway database. Ported from the old
 * db-dialects.test.js (MySQL and SQLite), keeping what still means something
 * on PostgreSQL and is not already shown through the routes above, plus how
 * the pool behaves when the server drops a connection, which Neon does when
 * it suspends an idle compute.
 */
describe('db.js on PostgreSQL', { skip }, () => {
  const NOW = '2026-03-04 05:06:07';  // exactly what server.js's nowUtc() produces
  const A_DATE = '2026-03-04';        // exactly what cleanDate() permits
  const { Client } = require('pg');
  let pdb;

  const insertProject = (name, extra = {}) => pdb.get(
    `INSERT INTO projects (name, description, owner, status, planned_start, planned_end, created_at, updated_at)
     VALUES ($1,$2,$3,'Not Started',$4,$5,$6,$6) RETURNING id`,
    [name, extra.description, extra.owner, extra.planned_start, extra.planned_end, NOW]);

  /** Ends the server side of connection `pid`, as Neon does to an idle compute's clients. */
  async function terminate(pid) {
    const c = new Client({ connectionString: URL_ });
    await c.connect();
    try {
      await c.query('SELECT pg_terminate_backend($1)', [pid]);
      // Wait until the backend has really gone, then a moment for its FATAL
      // message to reach the client socket.
      for (let i = 0; i < 50; i++) {
        const { rows } = await c.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pid]);
        if (!rows.length) break;
        await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      await c.end();
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  before(async () => {
    if (!URL_) ({ url: URL_ } = await freshSchema('db'));
    pdb = await createDb({ env: { DATABASE_URL: URL_ }, quiet: true });
  });
  after(async () => { if (pdb) await pdb.end(); });

  test('run() reports rowCount, and RETURNING hands back the new id as a number', async () => {
    const first = await insertProject('First');
    const second = await insertProject('Second');
    assert.equal(typeof first.id, 'number');
    assert.equal(second.id, first.id + 1, 'identity ids advance by one');
    // server.js calls findProject(r.id) straight after inserting, so a wrong id
    // would return somebody else's row rather than erroring.
    assert.equal((await pdb.get('SELECT name FROM projects WHERE id = $1', [first.id])).name, 'First');
    assert.equal((await pdb.run('UPDATE projects SET owner = $1 WHERE id = $2', ['Asha', second.id])).rowCount, 1);
    assert.equal((await pdb.run('UPDATE projects SET owner = $1 WHERE id = $2', ['Asha', 2147483647])).rowCount, 0);
  });

  test('get() returns null, not undefined, when nothing matches', async () => {
    // Every route tests `if (!row) throw 404`, which undefined would satisfy
    // too, but res.json(undefined) and res.json(null) differ.
    assert.equal(await pdb.get('SELECT id FROM projects WHERE id = $1', [2147483647]), null);
  });

  test('an undefined parameter binds as NULL', async () => {
    // readItem() leaves absent optional fields undefined.
    const { id } = await insertProject('Undefined fields', {});
    const row = await pdb.get('SELECT description, owner, planned_start FROM projects WHERE id = $1', [id]);
    assert.deepEqual({ ...row }, { description: null, owner: null, planned_start: null });
  });

  test('dates and timestamps come back as exactly the strings written', async () => {
    // The columns are DATE and TIMESTAMP(0); db.js's type parsers keep them as
    // text, so the API never sends "2026-03-04T05:06:07.000Z" or shifts a date
    // through the server's time zone.
    const { id } = await insertProject('Dated', { planned_start: A_DATE, planned_end: A_DATE });
    const row = await pdb.get('SELECT planned_start, planned_end, created_at, updated_at FROM projects WHERE id = $1', [id]);
    assert.deepEqual({ ...row }, { planned_start: A_DATE, planned_end: A_DATE, created_at: NOW, updated_at: NOW });
  });

  test('the tables are set up over DATABASE_URL_UNPOOLED when it is set', async () => {
    // Neon: DDL and the advisory lock go over the direct endpoint, the app's
    // queries over the pooled one. Prove which is which by making the other
    // one unreachable (nothing listens on port 1).
    const nowhere = 'postgresql://nobody:x@127.0.0.1:1/nowhere';
    const viaDirect = await createDb({ env: { DATABASE_URL: nowhere, DATABASE_URL_UNPOOLED: URL_ }, quiet: true });
    try {
      await assert.rejects(viaDirect.get('SELECT 1'), /ECONNREFUSED/, 'queries still go to DATABASE_URL');
    } finally {
      await viaDirect.end();
    }
    await assert.rejects(
      createDb({ env: { DATABASE_URL: URL_, DATABASE_URL_UNPOOLED: nowhere }, quiet: true }),
      /ECONNREFUSED/, 'the schema did not go over DATABASE_URL_UNPOOLED');
  });

  test('an idle connection the server drops is replaced, not fatal', async (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    const { pid } = await pdb.get('SELECT pg_backend_pid() AS pid');
    await terminate(pid);
    const next = await pdb.get('SELECT pg_backend_pid() AS pid');
    assert.notEqual(next.pid, pid, 'a new connection');
    assert.ok(logged.mock.calls.some((c) => /idle client error/.test(String(c.arguments[0]))),
      'the pool saw the dropped connection');
  });

  test('a connection dropped in the middle of a transaction fails that transaction only', async () => {
    // A client inside tx() is checked out, so the pool is not listening for
    // its errors; without db.js's own listener the dropped connection was an
    // unhandled 'error' event, which ends the whole process. So this runs in a
    // child process and checks that it is still there afterwards.
    const { execFile } = require('node:child_process');
    const script = `
      const createDb = require(${JSON.stringify(require.resolve('../portal/db.js'))});
      const { Client } = require('pg');
      const url = process.env.DB_TEST_URL;
      (async () => {
        const db = await createDb({ env: { DATABASE_URL: url }, quiet: true });
        const killer = new Client({ connectionString: url });
        await killer.connect();
        await db.tx(async (q) => {
          const { pid } = await q.get('SELECT pg_backend_pid() AS pid');
          await killer.query('SELECT pg_terminate_backend($1)', [pid]);
          for (let i = 0; i < 50 && (await killer.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [pid])).rows.length; i++) {
            await new Promise((r) => setTimeout(r, 20));
          }
          await new Promise((r) => setTimeout(r, 200)); // the FATAL arrives between two statements
          await q.get('SELECT 1');
        }).then(() => console.log('tx resolved'), () => console.log('tx rejected'));
        console.log('next', JSON.stringify(await db.get('SELECT 1 AS ok')));
        await killer.end();
        await db.end();
      })().catch((e) => { console.log('outer', e.message); process.exit(3); });`;
    const out = await new Promise((resolve) => {
      execFile(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), timeout: 30000, env: { ...process.env, DB_TEST_URL: URL_ } },
        (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
    });
    assert.equal(out.code, 0, `the process ended: ${out.stderr.split('\n').slice(0, 6).join(' | ')}`);
    assert.match(out.stdout, /^tx rejected$/m);
    assert.match(out.stdout, /^next \{"ok":1\}$/m);
  });
});
