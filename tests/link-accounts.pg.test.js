'use strict';

/**
 * tools/link_accounts_to_hub.mjs: day one of the bkesari ID (D-039). The plan
 * on its own (no database), then a dry run and --apply against three schemas
 * standing in for the hub (with TaskList), LadWani and Education.
 *
 * The plan needs nothing; the database part needs TEST_DATABASE_URL (a
 * database it may WIPE) and works in schemas of its own.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const createDb = require('../portal/db.js');
const { skip, freshSchema } = require('./support/pg.js');

let mod;
before(async () => { mod = await import('../tools/link_accounts_to_hub.mjs'); });

const acct = (project, id, email, roles, over = {}) => ({ project, id, email, name: null, confirmed: true, active: true, roles, ...over });

test('the plan: confirmed and active accounts only, the highest role each project gives, nothing for built-in or unknown roles', () => {
  const p = mod.plan({
    accounts: [
      acct('tasklist', 1, 'Asha@Example.com', ['owner'], { name: 'Asha' }),
      acct('tasklist', 2, 'ravi@example.com', ['member']),
      acct('ladwani', 'c1', 'asha@example.com', ['MEMBER', 'KARTA']),
      acct('ladwani', 'c2', 'unconfirmed@example.com', ['MEMBER'], { confirmed: false }),
      acct('ladwani', 'c3', 'blocked@example.com', ['ADMIN'], { active: false }),
      acct('ladwani', 'c4', 'smorankar@builtin.bkesari.com', ['ADMIN']),
      acct('edu', 10, 'teacher@example.com', ['teacher', 'parent']),
      acct('edu', 11, 'sys@example.com', ['system_admin']),
      acct('edu', 12, 'researcher@example.com', ['researcher']),
      acct('edu', 13, 'mixed@example.com', ['researcher', 'teacher']),
      acct('edu', 14, '', ['parent']),
      acct('edu', 15, 'existing@example.com', ['parent']),
      acct('edu', 16, 'newgrant@example.com', ['student']),
    ],
    hubUsers: [{ id: 7, email: 'existing@example.com' }, { id: 8, email: 'NewGrant@example.com' }],
    grants: [{ user_id: '7', project_key: 'edu' }],
  });
  assert.deepEqual(p.create.map((u) => u.email).sort(), ['asha@example.com', 'mixed@example.com', 'ravi@example.com', 'sys@example.com', 'teacher@example.com']);
  assert.equal(p.create.find((u) => u.email === 'asha@example.com').name, 'Asha');
  const g = Object.fromEntries(p.grant.map((x) => [`${x.email} ${x.project}`, x.role]));
  assert.deepEqual(g, {
    'asha@example.com tasklist': 'owner', 'ravi@example.com tasklist': 'editor', 'asha@example.com ladwani': 'karta',
    'teacher@example.com edu': 'teacher', 'sys@example.com edu': 'admin', 'mixed@example.com edu': 'teacher', 'newgrant@example.com edu': 'student',
  });
  const why = Object.fromEntries(p.skip.map((s) => [`${s.email || '-'} ${s.project}`, s.reason]));
  assert.equal(why['unconfirmed@example.com ladwani'], 'email not confirmed');
  assert.equal(why['blocked@example.com ladwani'], 'account not active');
  assert.match(why['smorankar@builtin.bkesari.com ladwani'], /built-in/);
  assert.match(why['researcher@example.com edu'], /no hub role for researcher/);
  assert.match(why['mixed@example.com edu'], /also holds researcher/);
  assert.equal(why['- edu'], 'no email');
  assert.match(why['existing@example.com edu'], /already has a grant/);
  assert.deepEqual(mod.hubRole('ladwani', ['MEMBER', 'ADMIN', 'OPERATOR']), { role: 'admin', unknown: [] });
});

describe('link_accounts_to_hub on PostgreSQL', { skip }, () => {
  let hubUrl, lwUrl, eduUrl, hub;
  const run = async (args) => {
    const lines = [];
    const log = { log: (m) => lines.push(m), error: (m) => lines.push(`ERROR ${m}`) };
    const code = await mod.main(args, { HUB_DATABASE_URL: hubUrl, LADWANI_DATABASE_URL: lwUrl, EDU_DATABASE_URL: eduUrl }, log);
    return { code, out: lines.join('\n') };
  };

  before(async () => {
    hubUrl = (await freshSchema('link_hub')).url;
    lwUrl = (await freshSchema('link_ladwani')).url;
    eduUrl = (await freshSchema('link_edu')).url;
    hub = await createDb({ env: { DATABASE_URL: hubUrl }, quiet: true }); // applies the hub and TaskList schemas
    await hub.run("INSERT INTO tl_users (email, name, role, email_verified) VALUES ('owner@example.com','Owner','owner',TRUE), ('member@example.com',NULL,'member',TRUE), ('nope@example.com',NULL,'member',FALSE)");
    // A grant the admin revoked stays revoked.
    const u = await hub.get("INSERT INTO users (email, email_verified) VALUES ('member@example.com', TRUE) RETURNING id");
    await hub.run("INSERT INTO project_access (user_id, email, project_key, role, status) VALUES ($1, 'member@example.com', 'tasklist', 'editor', 'revoked')", [String(u.id)]);
    const lw = new Client({ connectionString: lwUrl });
    await lw.connect();
    await lw.query(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, status TEXT, email_verified BOOLEAN, deleted_at TIMESTAMPTZ, hub_user_id TEXT);
      CREATE TABLE roles (id TEXT PRIMARY KEY, code TEXT); CREATE TABLE user_roles (id TEXT PRIMARY KEY, user_id TEXT, role_id TEXT);
      INSERT INTO roles VALUES ('r1','MEMBER'),('r2','ADMIN');
      INSERT INTO users VALUES ('u1','owner@example.com','ACTIVE',TRUE,NULL,NULL),('u2','gone@example.com','ACTIVE',TRUE,now(),NULL);
      INSERT INTO user_roles VALUES ('x1','u1','r1'),('x2','u1','r2'),('x3','u2','r1');`);
    await lw.end();
    const edu = new Client({ connectionString: eduUrl });
    await edu.connect();
    await edu.query(`CREATE TABLE users (id BIGINT PRIMARY KEY, name TEXT, email TEXT, email_verified_at TIMESTAMP);
      CREATE TABLE roles (id BIGINT PRIMARY KEY, name TEXT); CREATE TABLE model_has_roles (role_id BIGINT, model_type TEXT, model_id BIGINT);
      INSERT INTO roles VALUES (1,'teacher'),(2,'system_admin');
      INSERT INTO users VALUES (1,'Teacher One','teacher@example.com',now()),(2,'Unconfirmed','unc@example.com',NULL);
      INSERT INTO model_has_roles VALUES (1,'App\\Models\\User',1),(1,'App\\Models\\User',2);`);
    await edu.end();
  });
  after(async () => { if (hub) await hub.end(); });

  test('a dry run changes nothing; --apply writes the bkesari IDs, the grants and the audit; a second run finds nothing to do', async () => {
    const count = async () => (await hub.get('SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM project_access)::int AS g, (SELECT count(*) FROM audit_log)::int AS a'));
    const before0 = await count();
    const dry = await run([]);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /Plan: 2 new bkesari IDs, 3 project grants/);
    assert.match(dry.out, /Dry run: nothing changed/);
    assert.match(dry.out, /member@example\.com {2}tasklist:\d+ {2}already has a grant/);
    assert.match(dry.out, /nope@example\.com {2}tasklist:\d+ {2}email not confirmed/);
    assert.match(dry.out, /gone@example\.com {2}ladwani:u2 {2}account not active/);
    assert.deepEqual(await count(), before0, 'the dry run wrote nothing');

    const done = await run(['--apply']);
    assert.equal(done.code, 0, done.out);
    assert.match(done.out, /Applied: 2 bkesari IDs made, 3 grants written/);
    const grants = await hub.all("SELECT email, project_key, role, status, approved_by, project_state FROM project_access WHERE approved_by = 'migration' ORDER BY email, project_key");
    assert.deepEqual(grants.map((g) => `${g.email} ${g.project_key} ${g.role} ${g.project_state || '-'}`), [
      'owner@example.com ladwani admin pending', 'owner@example.com tasklist owner -', 'teacher@example.com edu teacher -',
    ]);
    const owner = await hub.get("SELECT * FROM users WHERE email = 'owner@example.com'");
    assert.equal(owner.email_verified, true);
    assert.match(owner.migrated_from, /^tasklist:/);
    assert.equal((await hub.get("SELECT status FROM project_access WHERE email = 'member@example.com'")).status, 'revoked', 'a revocation stands');
    assert.equal((await hub.get("SELECT count(*)::int AS n FROM audit_log WHERE actor = 'migration'")).n, 3);

    const again = await run(['--apply']);
    assert.match(again.out, /Plan: 0 new bkesari IDs, 0 project grants/);
  });
});
