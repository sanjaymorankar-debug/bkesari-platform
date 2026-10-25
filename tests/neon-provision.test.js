/**
 * tools/neon_provision.mjs against an in-memory stand-in for Neon's API.
 *
 * The tool is not run against Neon from CI (no credentials, and it would
 * create real projects), so these tests pin what it asks Neon to do: one
 * project per app in Singapore, the tier branches in each, the app's login
 * owning its database on every branch, new passwords on branches it made, a
 * re-run creating nothing, a dry run changing nothing, other projects (such
 * as a separate site's) left alone, and passwords only ever reaching the 0600
 * output files.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../tools/neon_provision.mjs');

/** A fake Neon account. Branches copy their parent's roles, passwords and databases, as Neon's do. */
function fakeNeon({ projects = [], lockFirst = 0 } = {}) {
  const state = { projects: [], branches: {}, roles: {}, databases: {}, passwords: {}, calls: [], locks: lockFirst };
  let seq = 0;
  const pw = (b, r) => (state.passwords[`${b}/${r}`] = `pw${++seq}`);
  const addProject = ({ name, region_id = 'aws-ap-southeast-1', branch = 'production', database, role }) => {
    const id = `p-${name}`;
    const b = `br-${name}-${branch}`;
    state.projects.push({ id, name, region_id });
    state.branches[id] = [{ id: b, name: branch, default: true }];
    state.roles[b] = [role];
    state.databases[b] = [{ name: database, owner_name: role }];
    pw(b, role);
    return { id, name, region_id };
  };
  for (const p of projects) addProject(p);

  async function fetchImpl(url, init) {
    const { pathname, searchParams } = new URL(url);
    const route = pathname.replace(/^\/api\/v2/, '');
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push(`${method} ${route}`);
    if (state.locks > 0) {
      state.locks--;
      return new Response('locked', { status: 423 });
    }
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
    let m;
    if (method === 'GET' && route === '/projects') return json({ projects: state.projects });
    if (method === 'POST' && route === '/projects') {
      const p = body.project;
      (state.creates ||= []).push(p);
      // As Neon does: a project created without a region lands in the account's default one, not Singapore.
      const project = addProject({ name: p.name, region_id: p.region_id ?? 'aws-us-east-2', branch: p.branch.name, database: p.branch.database_name, role: p.branch.role_name });
      return json({ project }, 201);
    }
    if ((m = route.match(/^\/projects\/([^/]+)\/branches$/))) {
      if (method === 'GET') return json({ branches: state.branches[m[1]] });
      const parent = body.branch.parent_id;
      const id = `${parent.replace(/-[^-]+$/, '')}-${body.branch.name}`;
      state.branches[m[1]].push({ id, name: body.branch.name, parent_id: parent });
      state.roles[id] = [...state.roles[parent]];
      state.databases[id] = state.databases[parent].map((d) => ({ ...d }));
      for (const r of state.roles[id]) state.passwords[`${id}/${r}`] = state.passwords[`${parent}/${r}`];
      return json({ branch: { id, name: body.branch.name } }, 201);
    }
    if ((m = route.match(/^\/projects\/[^/]+\/branches\/([^/]+)\/roles$/))) {
      if (method === 'GET') return json({ roles: state.roles[m[1]].map((name) => ({ name })) });
      state.roles[m[1]].push(body.role.name);
      return json({ role: { name: body.role.name, password: pw(m[1], body.role.name) } }, 201);
    }
    if ((m = route.match(/^\/projects\/[^/]+\/branches\/([^/]+)\/roles\/([^/]+)\/reset_password$/))) {
      return json({ role: { name: m[2], password: pw(m[1], decodeURIComponent(m[2])) } });
    }
    if ((m = route.match(/^\/projects\/[^/]+\/branches\/([^/]+)\/databases$/))) {
      if (method === 'GET') return json({ databases: state.databases[m[1]] });
      state.databases[m[1]].push({ name: body.database.name, owner_name: body.database.owner_name });
      return json({ database: body.database }, 201);
    }
    if (method === 'GET' && (m = route.match(/^\/projects\/([^/]+)\/connection_uri$/))) {
      const b = searchParams.get('branch_id');
      const role = searchParams.get('role_name');
      const host = `ep-${b}${searchParams.get('pooled') === 'true' ? '-pooler' : ''}.neon.example`;
      return json({ uri: `postgresql://${role}:${state.passwords[`${b}/${role}`]}@${host}/${searchParams.get('database_name')}?sslmode=require&channel_binding=require` });
    }
    return json({ message: `fake: no route ${method} ${route}` }, 404);
  }
  return { state, fetchImpl };
}

async function run(fake, opts = {}) {
  const { neonClient, provision } = await load();
  const logs = [];
  const neon = neonClient({ apiKey: 'k', host: 'https://neon.example', fetchImpl: fake.fetchImpl, sleep: async () => {} });
  const result = await provision({ neon, log: (m) => logs.push(m), ...opts });
  return { ...result, logs };
}

const creates = (calls) => calls.filter((c) => c.startsWith('POST'));
const branchNames = (fake, name) => fake.state.branches[`p-${name}`].map((b) => b.name);

test('a new account gets one Singapore project per app, each with its tier branches and its own database', async () => {
  const fake = fakeNeon();
  const { files } = await run(fake);
  assert.deepEqual(fake.state.projects.map((p) => p.name),
    ['bkesari-hub', 'bkesari-tasklist', 'bkesari-edu', 'bkesari-ladwani', 'bkesari-atip', 'bkesari-agtci', 'bkesari-edu-standalone']);
  assert.ok(fake.state.projects.every((p) => p.region_id === 'aws-ap-southeast-1'));
  assert.equal(fake.state.creates.length, 7);
  for (const p of fake.state.creates) {
    assert.equal(p.region_id, 'aws-ap-southeast-1', `${p.name} asks for Singapore`);
    assert.equal(p.pg_version, 16, `${p.name} asks for PostgreSQL 16`);
  }
  for (const app of ['hub', 'tasklist', 'edu', 'ladwani', 'atip', 'agtci']) {
    assert.deepEqual(branchNames(fake, `bkesari-${app}`), ['production', 'test', 'dev'], app);
  }
  assert.deepEqual(branchNames(fake, 'bkesari-edu-standalone'), ['test'], 'the standalone copy is a test site only');
  for (const tier of ['production', 'test', 'dev']) {
    assert.deepEqual(fake.state.databases[`br-bkesari-tasklist-${tier}`], [{ name: 'bk_tasklist', owner_name: 'bk_tasklist_app' }], tier);
  }
  assert.deepEqual(fake.state.databases['br-bkesari-hub-production'], [{ name: 'neondb', owner_name: 'bk_portal_app' }]);
  assert.deepEqual(Object.keys(files).sort(), ['dev', 'production', 'test']);
});

test('every login on a branch this run made gets its own password, so no tier can log in to another', async () => {
  const fake = fakeNeon();
  await run(fake);
  const pwOf = (app, role, tier) => fake.state.passwords[`br-bkesari-${app}-${tier}/${role}`];
  for (const [app, role] of [['hub', 'bk_portal_app'], ['tasklist', 'bk_tasklist_app'], ['agtci', 'bk_agtci_app']]) {
    const tiers = ['production', 'test', 'dev'].map((t) => pwOf(app, role, t));
    assert.equal(new Set(tiers).size, 3, `${app}: ${tiers}`);
  }

  // A run that dies after making branches but before their new passwords names them: a re-run sees
  // them as existing branches and leaves their (copied) passwords alone.
  const broken = fakeNeon();
  const real = broken.fetchImpl;
  broken.fetchImpl = (url, init) => (url.includes('/reset_password') ? Promise.reject(new TypeError('fetch failed')) : real(url, init));
  await assert.rejects(run(broken), (err) => {
    assert.match(err.message, /^fetch failed\n/);
    assert.match(err.message, /a re-run will not change it: bkesari-hub\/test, bkesari-hub\/dev\. Reset/);
    return true;
  });
});

test('a re-run creates nothing and resets no password', async () => {
  const fake = fakeNeon();
  await run(fake);
  const before = fake.state.calls.length;
  await run(fake);
  assert.deepEqual(creates(fake.state.calls.slice(before)), []);
});

test('projects that already exist are used, and projects that are not ours are left alone', async () => {
  // As the account looks after a manual start: the hub project exists, and so do other sites' projects.
  const fake = fakeNeon({ projects: [
    { name: 'bkesari-hub', database: 'neondb', role: 'bk_portal_app' },
    { name: 'GoKesari-prod', region_id: 'aws-us-east-2', branch: 'main', database: 'neondb', role: 'neondb_owner' },
    { name: 'Social_Activities', region_id: 'aws-us-east-2', database: 'neondb', role: 'neondb_owner' },
  ] });
  await run(fake);
  const created = fake.state.calls.filter((c) => c === 'POST /projects').length;
  assert.equal(created, 6, 'only the six missing bkesari projects are created');
  for (const other of ['GoKesari-prod', 'Social_Activities']) {
    assert.ok(!fake.state.calls.some((c) => c.includes(`/projects/p-${other}/`)), `${other} is never touched`);
  }
  assert.deepEqual(branchNames(fake, 'bkesari-hub'), ['production', 'test', 'dev']);
});

test('a dry run asks Neon for nothing but reads', async () => {
  const fake = fakeNeon({ projects: [{ name: 'bkesari-tasklist', database: 'bk_tasklist', role: 'bk_tasklist_app' }] });
  const { plan, files } = await run(fake, { dryRun: true });
  assert.deepEqual(creates(fake.state.calls), []);
  assert.ok(plan.includes('create project bkesari-hub in aws-ap-southeast-1 (PostgreSQL 16): branch production, database neondb owned by bk_portal_app'));
  assert.ok(plan.includes('bkesari-tasklist: create branch test (from production)'));
  assert.ok(Object.values(files).every((f) => f === null));
});

test('two projects with the same name are refused rather than guessed at', async () => {
  const fake = fakeNeon({ projects: [
    { name: 'bkesari-hub', database: 'neondb', role: 'bk_portal_app' },
    { name: 'bkesari-hub', database: 'neondb', role: 'bk_portal_app' },
  ] });
  fake.state.projects[1].id = 'p-bkesari-hub-2';
  await assert.rejects(run(fake), /more than one Neon project is named bkesari-hub/);
  assert.deepEqual(creates(fake.state.calls), []);
});

test('a database that exists under another owner is reported, not taken over', async () => {
  const fake = fakeNeon({ projects: [{ name: 'bkesari-edu', database: 'bk_edu', role: 'bk_edu_app' }] });
  fake.state.databases['br-bkesari-edu-production'] = [{ name: 'bk_edu', owner_name: 'neondb_owner' }];
  const { plan } = await run(fake);
  assert.ok(plan.some((l) => /bkesari-edu\/production: database bk_edu is owned by neondb_owner, not bk_edu_app/.test(l)));
  assert.deepEqual(fake.state.databases['br-bkesari-edu-production'], [{ name: 'bk_edu', owner_name: 'neondb_owner' }]);
});

test('Neon answering 423 (an operation still running) is waited out', async () => {
  const fake = fakeNeon({ lockFirst: 3 });
  await run(fake);
  assert.equal(fake.state.projects.length, 7);
});

test('each app gets the lines it reads, pooled for the app and direct for migrations, from its own tier', async () => {
  const fake = fakeNeon();
  const { files } = await run(fake);
  const prod = files.production;
  assert.match(prod, /^DATABASE_URL=postgresql:\/\/bk_portal_app:[^@]+@ep-br-bkesari-hub-production-pooler\.neon\.example\/neondb\?sslmode=require&channel_binding=require$/m);
  assert.match(prod, /^DATABASE_URL_UNPOOLED=postgresql:\/\/bk_portal_app:[^@]+@ep-br-bkesari-hub-production\.neon\.example\/neondb\?/m);
  assert.match(prod, /^DATABASE_URL=postgresql:\/\/bk_tasklist_app:[^@]+@ep-br-bkesari-tasklist-production-pooler\.neon\.example\/bk_tasklist\?/m);
  assert.match(prod, /^DB_CONNECTION=pgsql$/m);
  assert.match(prod, /^DB_URL=postgresql:\/\/bk_edu_app:[^@]+@ep-br-bkesari-edu-production-pooler\.[^/]+\/bk_edu\?/m);
  assert.match(prod, /^DB_URL_UNPOOLED=postgresql:\/\/bk_edu_app:[^@]+@ep-br-bkesari-edu-production\.neon/m);
  assert.match(prod, /^ATIP_DATABASE_URL=postgresql:\/\/bk_atip_app:[^@]+@ep-br-bkesari-atip-production\.neon/m, 'ATIP uses the direct endpoint');
  assert.doesNotMatch(prod, /bk_edu_standalone/);
  assert.match(files.test, /bk_edu_standalone_app/);
  assert.doesNotMatch(files.dev, /-production/, 'the dev file names only dev hosts');
});

test('passwords reach only the output files, which only the owner can read', async () => {
  const fake = fakeNeon();
  const { files, logs } = await run(fake);
  for (const p of Object.values(fake.state.passwords)) {
    assert.ok(!logs.some((l) => l.includes(p)), 'no password in the log');
  }
  const { writeTierFiles } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-out-'));
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { mode: 0o755 }); // an older, looser folder is tightened
  const written = writeTierFiles(files, out);
  assert.equal(written.length, 3);
  for (const f of written) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(fs.statSync(out).mode & 0o777, 0o700);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the command line refuses unknown arguments', async () => {
  const { parseArgs } = await load();
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.throws(() => parseArgs(['--project', 'p1']), /unknown argument/);
});
