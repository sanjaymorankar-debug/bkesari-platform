/**
 * tools/neon_provision.mjs against an in-memory stand-in for Neon's API.
 *
 * The tool cannot be run against Neon from CI (no credentials, and it would
 * create real branches), so these tests pin what it asks Neon to do: which
 * branches, roles and databases it creates, that a re-run creates nothing,
 * that roles copied into a new branch get new passwords, that a dry run
 * changes nothing, and that passwords only ever reach the 0600 output files.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../tools/neon_provision.mjs');

/** A fake Neon project. Branches copy their parent's roles and databases, as Neon's do. */
function fakeNeon({ branches = [{ id: 'br-prod', name: 'production', default: true }], roles = {}, databases = {}, lockFirst = 0 } = {}) {
  const state = {
    branches: branches.map((b) => ({ ...b })),
    roles: { 'br-prod': [], ...roles },
    databases: { 'br-prod': [], ...databases },
    passwords: {},
    calls: [],
    locks: lockFirst,
  };
  let seq = 0;
  const pw = (b, r) => (state.passwords[`${b}/${r}`] = `pw${++seq}`);
  for (const [b, list] of Object.entries(state.roles)) for (const r of list) pw(b, r);

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
    if (method === 'GET' && /^\/projects\/p1\/branches$/.test(route)) return json({ branches: state.branches });
    if (method === 'POST' && /^\/projects\/p1\/branches$/.test(route)) {
      const parent = body.branch.parent_id;
      const id = `br-${body.branch.name}`;
      state.branches.push({ id, name: body.branch.name, parent_id: parent });
      state.roles[id] = [...(state.roles[parent] || [])];
      state.databases[id] = (state.databases[parent] || []).map((d) => ({ ...d }));
      for (const r of state.roles[id]) state.passwords[`${id}/${r}`] = state.passwords[`${parent}/${r}`];
      return json({ branch: { id, name: body.branch.name } }, 201);
    }
    if ((m = route.match(/^\/projects\/p1\/branches\/([^/]+)\/roles$/))) {
      if (method === 'GET') return json({ roles: state.roles[m[1]].map((name) => ({ name })) });
      state.roles[m[1]].push(body.role.name);
      return json({ role: { name: body.role.name, password: pw(m[1], body.role.name) } }, 201);
    }
    if ((m = route.match(/^\/projects\/p1\/branches\/([^/]+)\/roles\/([^/]+)\/reset_password$/))) {
      return json({ role: { name: m[2], password: pw(m[1], decodeURIComponent(m[2])) } });
    }
    if ((m = route.match(/^\/projects\/p1\/branches\/([^/]+)\/databases$/))) {
      if (method === 'GET') return json({ databases: state.databases[m[1]] });
      state.databases[m[1]].push({ name: body.database.name, owner_name: body.database.owner_name });
      return json({ database: body.database }, 201);
    }
    if (method === 'GET' && route === '/projects/p1/connection_uri') {
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
  const result = await provision({ neon, projectId: 'p1', log: (m) => logs.push(m), ...opts });
  return { ...result, logs };
}

const creates = (calls) => calls.filter((c) => c.startsWith('POST'));

test('a project with only production gets test and dev branches, and every database on each', async () => {
  const fake = fakeNeon();
  const { files } = await run(fake);
  assert.deepEqual(fake.state.branches.map((b) => b.name), ['production', 'test', 'dev']);
  for (const b of ['br-prod', 'br-dev']) {
    assert.deepEqual(fake.state.databases[b].map((d) => d.name).sort(), ['agtci', 'atip', 'edu', 'ladwani', 'milk', 'portal']);
  }
  assert.deepEqual(fake.state.databases['br-test'].map((d) => d.name).sort(),
    ['agtci', 'atip', 'edu', 'edu_standalone', 'ladwani', 'milk', 'portal']);
  for (const d of fake.state.databases['br-prod']) assert.equal(d.owner_name, `${d.name}_app`);
  assert.deepEqual(Object.keys(files).sort(), ['dev', 'production', 'test']);
});

test('the branches are made before any app role, so none is copied between tiers', async () => {
  const fake = fakeNeon();
  await run(fake);
  const branchCreates = fake.state.calls.filter((c) => c === 'POST /projects/p1/branches');
  const firstRole = fake.state.calls.findIndex((c) => /POST .*\/roles$/.test(c));
  assert.equal(branchCreates.length, 2);
  assert.ok(fake.state.calls.lastIndexOf('POST /projects/p1/branches') < firstRole);
  assert.equal(fake.state.calls.filter((c) => c.endsWith('/reset_password')).length, 0);
  const prod = fake.state.passwords['br-prod/milk_app'];
  assert.notEqual(prod, fake.state.passwords['br-dev/milk_app']);
  assert.notEqual(prod, fake.state.passwords['br-test/milk_app']);
});

test('a re-run creates nothing', async () => {
  const fake = fakeNeon();
  await run(fake);
  const before = fake.state.calls.length;
  await run(fake);
  assert.deepEqual(creates(fake.state.calls.slice(before)), []);
});

test('a branch made now from a production that already has the roles gets new passwords for them', async () => {
  const apps = ['portal_app', 'milk_app', 'edu_app', 'ladwani_app', 'atip_app', 'agtci_app'];
  const fake = fakeNeon({
    branches: [{ id: 'br-prod', name: 'production', default: true }, { id: 'br-test', name: 'test' }],
    roles: { 'br-prod': [...apps], 'br-test': [...apps, 'edu_standalone_app'] },
    databases: {
      'br-prod': apps.map((r) => ({ name: r.replace(/_app$/, ''), owner_name: r })),
      'br-test': [...apps, 'edu_standalone_app'].map((r) => ({ name: r.replace(/_app$/, ''), owner_name: r })),
    },
  });
  const testPasswords = apps.map((r) => fake.state.passwords[`br-test/${r}`]);
  await run(fake);
  const resets = fake.state.calls.filter((c) => c.endsWith('/reset_password'));
  assert.equal(resets.length, apps.length);
  assert.ok(resets.every((c) => c.includes('/branches/br-dev/')), 'only the new branch is touched');
  for (const r of apps) assert.notEqual(fake.state.passwords[`br-dev/${r}`], fake.state.passwords[`br-prod/${r}`]);
  assert.deepEqual(apps.map((r) => fake.state.passwords[`br-test/${r}`]), testPasswords, 'an existing branch keeps its passwords');
});

test('a dry run asks Neon for nothing but reads', async () => {
  const fake = fakeNeon();
  const { plan, files } = await run(fake, { dryRun: true });
  assert.deepEqual(creates(fake.state.calls), []);
  assert.ok(plan.includes('create branch test (from production) for test.bkesari.com'));
  assert.ok(Object.values(files).every((f) => f === null));
});

test('a default branch with another name is refused rather than guessed at', async () => {
  const fake = fakeNeon({ branches: [{ id: 'br-main', name: 'main', default: true }] });
  await assert.rejects(run(fake), /rename it to "production"/);
  assert.deepEqual(creates(fake.state.calls), []);
});

test('Neon answering 423 (an operation still running) is waited out', async () => {
  const fake = fakeNeon({ lockFirst: 3 });
  await run(fake);
  assert.equal(fake.state.branches.length, 3);
});

test('each project gets the lines its app reads, pooled for the app and direct for migrations', async () => {
  const fake = fakeNeon();
  const { files } = await run(fake);
  const prod = files.production;
  assert.match(prod, /^DATABASE_URL=postgresql:\/\/portal_app:[^@]+@ep-br-prod-pooler\.neon\.example\/portal\?sslmode=require&channel_binding=require$/m);
  assert.match(prod, /^DATABASE_URL_UNPOOLED=postgresql:\/\/portal_app:[^@]+@ep-br-prod\.neon\.example\/portal\?/m);
  assert.match(prod, /^DB_CONNECTION=pgsql$/m);
  assert.match(prod, /^DB_URL=postgresql:\/\/edu_app:[^@]+@ep-br-prod-pooler\./m);
  assert.match(prod, /^DB_URL_UNPOOLED=postgresql:\/\/edu_app:[^@]+@ep-br-prod\.neon/m);
  assert.match(prod, /^ATIP_DATABASE_URL=postgresql:\/\/atip_app:[^@]+@ep-br-prod\.neon/m, 'ATIP uses the direct endpoint');
  assert.doesNotMatch(prod, /edu_standalone/);
  assert.match(files.test, /edu_standalone_app/);
  assert.doesNotMatch(files.dev, /ep-br-prod/, 'the dev file names only dev hosts');
});

test('passwords reach only the output files, which only the owner can read', async () => {
  const fake = fakeNeon();
  const { files, logs } = await run(fake);
  for (const p of Object.values(fake.state.passwords)) {
    assert.ok(!logs.some((l) => l.includes(p)), 'no password in the log');
  }
  const { writeTierFiles } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-out-'));
  const written = writeTierFiles(files, path.join(dir, 'out'));
  assert.equal(written.length, 3);
  for (const f of written) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dir, 'out')).mode & 0o777, 0o700);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the command line refuses unknown arguments', async () => {
  const { parseArgs } = await load();
  assert.deepEqual(parseArgs(['--project', 'p1', '--dry-run']).project, 'p1');
  assert.throws(() => parseArgs(['--projct', 'p1']), /unknown argument/);
});
