/**
 * tools/migrate_shared_id.mjs: the one-time move from the shared bkesari ID to
 * each project's own accounts. The plan itself (pure), then a dry run and a
 * real run against a throwaway PostgreSQL schema laid out like the hub's.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const createDb = require('../portal/db.js');
const { skip, freshSchema } = require('./support/pg.js');

const quiet = { log() {}, warn() {}, error() {} };
let mod;
before(async () => { mod = await import('../tools/migrate_shared_id.mjs'); });

test('the plan: everyone with access, each project once, the owner in every project', () => {
  const rows = [
    { user_id: 'u1', email: 'Asha@Example.com', project_key: 'ladwani', role: 'member' },
    { user_id: 'u1', email: 'asha@example.com', project_key: 'tasklist', role: 'editor' },
    { user_id: 'u2', email: 'ravi@example.com', project_key: 'edu', role: 'parent' },
    { user_id: 'u3', email: 'x@example.com', project_key: 'atip', role: 'owner' },
  ];
  const people = mod.plan({ rows, owners: ['agtcipl@gmail.com'], trackerAllowed: ['meera@example.com'], names: new Map([['asha@example.com', 'Asha']]) });
  assert.deepEqual(people.map((p) => [p.email, p.projects, p.owner]), [
    ['agtcipl@gmail.com', ['edu', 'ladwani', 'tasklist'], true],
    ['asha@example.com', ['ladwani', 'tasklist'], false],
    ['meera@example.com', ['tasklist'], false],
    ['ravi@example.com', ['edu'], false],
  ], 'ATIP is not a project with accounts; x@ is left out');
  assert.equal(people[1].name, 'Asha');
  assert.equal(people[1].hubUserId, 'u1');
  const m = mod.message(people[1]);
  assert.match(m.text, /Namaskar Asha/);
  assert.match(m.text, /LadWani: https:\/\/bkesari\.com\/ladwani\/sign-in\//);
  assert.match(m.text, /TaskList: https:\/\/bkesari\.com\/tasklist\/sign-in/);
  assert.doesNotMatch(m.text, /Education/);
});

describe('the migration on PostgreSQL', { skip }, () => {
  let db, url;
  before(async () => {
    ({ url } = await freshSchema('migrate'));
    db = await createDb({ env: { DATABASE_URL: url }, quiet: true });
    await db.run(`INSERT INTO project_access (user_id, email, project_key, role) VALUES
      ('u1','asha@example.com','tasklist','editor'), ('u2','ravi@example.com','ladwani','member')`);
    await db.run(`INSERT INTO tasks (title, status, created_at, updated_at) VALUES ('old shared task', 'In Progress', '2026-10-01 00:00:00', '2026-10-01 00:00:00')`);
    await db.run(`INSERT INTO projects (name, status, created_at, updated_at) VALUES ('old shared project', 'In Progress', '2026-10-01 00:00:00', '2026-10-01 00:00:00')`);
  });
  after(async () => { if (db) await db.end(); });

  const env = () => ({ HUB_DATABASE_URL: url, HUB_OWNER_EMAILS: 'agtcipl@gmail.com', TRACKER_ALLOWED_EMAILS: 'meera@example.com' });

  test('a dry run changes nothing', async () => {
    const out = await mod.main([], env(), quiet);
    assert.ok(out.every((r) => r.tasklist === '' || r.tasklist === 'would create'));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM tl_users')).n, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM tasks WHERE user_id IS NULL')).n, 1);
    await assert.rejects(mod.main(['--notify'], env(), quiet), /--notify needs --apply/);
  });

  test('--apply makes the TaskList accounts and gives the old tracker to the owner, once', async () => {
    const out = await mod.main(['--apply'], env(), quiet);
    const users = await db.all('SELECT email, role, password_hash, migrated_from FROM tl_users ORDER BY email');
    assert.deepEqual(users.map((u) => [u.email, u.role]), [['agtcipl@gmail.com', 'owner'], ['asha@example.com', 'member'], ['meera@example.com', 'member']]);
    assert.ok(users.every((u) => u.password_hash === null), 'no password is invented: they reset or use a code');
    assert.equal(users.find((u) => u.email === 'asha@example.com').migrated_from, 'u1');
    const owner = await db.get("SELECT id FROM tl_users WHERE email = 'agtcipl@gmail.com'");
    assert.equal((await db.get("SELECT user_id FROM tasks WHERE title = 'old shared task'")).user_id, owner.id);
    assert.equal((await db.get("SELECT user_id FROM projects WHERE name = 'old shared project'")).user_id, owner.id);
    assert.equal(out.find((r) => r.email === 'ravi@example.com').ladwani, 'not checked (no database URL)');
    // Again: nothing new.
    const again = await mod.main(['--apply'], env(), quiet);
    assert.ok(again.filter((r) => r.tasklist).every((r) => r.tasklist === 'exists'));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM tl_users')).n, 3);
  });
});
