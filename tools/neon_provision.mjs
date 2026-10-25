#!/usr/bin/env node
/**
 * Create the bkesari databases on Neon: one branch per tier, one database and
 * one login per project on each branch, and each tier's connection strings.
 *
 *   NEON_API_KEY=... node tools/neon_provision.mjs --project <project-id> [--dry-run]
 *
 * Safe to re-run: anything that already exists is left as it is, and nothing
 * is ever deleted. docs/NEON.md explains the layout this builds.
 *
 * Tier isolation. A branch made from another starts as a copy of it, roles and
 * passwords included, so a role that came from the parent gets a new password
 * on the new branch. A dev or test URL therefore cannot log in to production
 * even if its host name were swapped.
 *
 * Project isolation. Each login owns only its own database. PostgreSQL also
 * lets every login connect to every database unless that is revoked, and the
 * API cannot revoke it, so the tool writes the SQL that does (see Output).
 *
 * Output. Connection strings contain passwords, so they are never printed.
 * Each tier gets two files, readable only by you (folder: --out DIR):
 *   ~/.bkesari_neon/<tier>.env   each project's lines for its server .env
 *   ~/.bkesari_neon/<tier>.sql   the SQL to run once per database on that
 *                                branch, as the login each block names
 * Nothing here runs SQL itself: the tool talks to Neon's API only.
 *
 * Talks to Neon's public API (https://console.neon.tech/api/v2, or
 * NEON_API_HOST). Uses only Node's standard library (Node 20+).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Tier -> Neon branch, and the site that tier serves.
export const TIERS = [
  { tier: 'production', branch: 'production', site: 'bkesari.com' },
  { tier: 'test', branch: 'test', site: 'test.bkesari.com' },
  { tier: 'dev', branch: 'dev', site: 'dev.bkesari.com' },
];

// One database per project, owned by its own login. The env prefix is what
// the project reads; see each repository's .env.example.
export const PROJECTS = [
  // The hub keeps the project's default database, neondb, because Neon Auth
  // lives there too. neondb stays with the project owner (neondb_owner); the
  // hub's login is granted what it needs instead of owning it.
  { project: 'portal', database: 'neondb', role: 'bk_portal_app', env: 'DATABASE_URL', shared: true },
  { project: 'tasklist', database: 'bk_tasklist', role: 'bk_tasklist_app', env: 'TASKLIST_DATABASE_URL' },
  { project: 'edu', database: 'bk_edu', role: 'bk_edu_app', env: 'DB_URL' },
  { project: 'ladwani', database: 'bk_ladwani', role: 'bk_ladwani_app', env: 'DATABASE_URL' },
  { project: 'atip', database: 'bk_atip', role: 'bk_atip_app', env: 'ATIP_DATABASE_URL' },
  { project: 'agtci', database: 'bk_agtci', role: 'bk_agtci_app', env: 'DATABASE_URL' },
  // The standalone edu repository, superseded by edu/ here but still behind
  // edutest.agtci.com: a test site, so it exists on the test branch only.
  { project: 'edu-standalone', database: 'bk_edu_standalone', role: 'bk_edu_standalone_app', env: 'DB_URL', branches: ['test'] },
];

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * The SQL one database needs after the API has made it, as [login, statements].
 *
 * - A database its project's login owns: take away the default CONNECT every
 *   other login has, so no other project can even open it.
 * - The hub's shared neondb: grant the hub's login what it needs to connect
 *   and create its tables. PUBLIC keeps CONNECT there until Neon Auth's own
 *   login has been granted it, so that revoke is written commented out.
 * - A database someone else owns that is not meant to be shared: nothing is
 *   generated. It is reported, and handing it over is a deliberate step
 *   (docs/NEON.md).
 */
export function databaseSql(proj, owner) {
  const db = ident(proj.database);
  const role = ident(proj.role);
  if (owner === proj.role) {
    return [proj.role, [`REVOKE CONNECT, TEMPORARY ON DATABASE ${db} FROM PUBLIC;`]];
  }
  if (proj.shared) {
    return [owner, [
      `GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${role};`,
      `GRANT USAGE, CREATE ON SCHEMA public TO ${role};`,
      '-- Until the next line runs, every other login can connect here, and Neon\'s',
      '-- neon_superuser membership lets a login read what it can connect to.',
      '-- Grant CONNECT to the login Neon Auth connects as, then uncomment:',
      `-- REVOKE CONNECT, TEMPORARY ON DATABASE ${db} FROM PUBLIC;`,
    ]];
  }
  return null;
}

export function parseArgs(argv) {
  const args = { dryRun: false, out: path.join(os.homedir(), '.bkesari_neon') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

export function neonClient({ apiKey, host = 'https://console.neon.tech', fetchImpl = fetch, sleep, log = () => {} }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  async function call(method, route, body) {
    // Neon answers 423 while an earlier operation on the project is still
    // running (a branch being created, say); wait and try again.
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${host}/api/v2${route}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 423 && attempt < 30) {
        await wait(2000);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`Neon API ${method} ${route}: ${res.status} ${text.slice(0, 300)}`);
      log(`${method} ${route} -> ${res.status}`);
      return text ? JSON.parse(text) : {};
    }
  }
  return {
    branches: (p) => call('GET', `/projects/${p}/branches`).then((r) => r.branches || []),
    createBranch: (p, name, parentId) =>
      call('POST', `/projects/${p}/branches`, { branch: { name, parent_id: parentId }, endpoints: [{ type: 'read_write' }] })
        .then((r) => r.branch),
    roles: (p, b) => call('GET', `/projects/${p}/branches/${b}/roles`).then((r) => r.roles || []),
    createRole: (p, b, name) => call('POST', `/projects/${p}/branches/${b}/roles`, { role: { name } }).then((r) => r.role),
    resetPassword: (p, b, name) => call('POST', `/projects/${p}/branches/${b}/roles/${encodeURIComponent(name)}/reset_password`),
    databases: (p, b) => call('GET', `/projects/${p}/branches/${b}/databases`).then((r) => r.databases || []),
    createDatabase: (p, b, name, owner) =>
      call('POST', `/projects/${p}/branches/${b}/databases`, { database: { name, owner_name: owner } }).then((r) => r.database),
    connectionUri: (p, b, database, role, pooled) =>
      call('GET', `/projects/${p}/connection_uri?${new URLSearchParams({ branch_id: b, database_name: database, role_name: role, pooled: String(pooled) })}`)
        .then((r) => r.uri),
  };
}

/** The lines a site's .env needs for one project, pooled for the app and direct for migrations. */
export function envLines(proj, pooledUri, directUri) {
  if (proj.env === 'DB_URL') {
    // Laravel (edu) reads DB_URL; migrations go over the direct endpoint.
    return [`DB_CONNECTION=pgsql`, `DB_URL=${pooledUri}`, `DB_URL_UNPOOLED=${directUri}`];
  }
  if (proj.env === 'ATIP_DATABASE_URL') {
    // One long-lived process on the Mac: the direct endpoint, no pooler.
    return [`ATIP_DATABASE_URL=${directUri}`];
  }
  return [`DATABASE_URL=${pooledUri}`, `DATABASE_URL_UNPOOLED=${directUri}`];
}

export async function provision({ neon, projectId, dryRun = false, log = console.log }) {
  const plan = [];
  const note = (msg) => { plan.push(msg); log((dryRun ? '[dry run] ' : '') + msg); };

  let branches = await neon.branches(projectId);
  const root = branches.find((b) => b.name === 'production') || branches.find((b) => b.default);
  if (!root) throw new Error('the project has no default branch to build the tiers from');
  if (root.name !== 'production') {
    throw new Error(`the default branch is "${root.name}"; rename it to "production" in the Neon console first, so the tiers are unambiguous`);
  }

  const fresh = new Set(); // branches created by this run, from production
  for (const t of TIERS) {
    if (branches.some((b) => b.name === t.branch)) continue;
    note(`create branch ${t.branch} (from production) for ${t.site}`);
    if (!dryRun) {
      const b = await neon.createBranch(projectId, t.branch, root.id);
      branches = [...branches, b];
      fresh.add(b.id);
    }
  }

  const files = {};
  const sqlFiles = {};
  for (const t of TIERS) {
    const branch = branches.find((b) => b.name === t.branch);
    if (!branch) { files[t.tier] = null; sqlFiles[t.tier] = null; continue; } // dry run: not created yet
    const roles = new Set((await neon.roles(projectId, branch.id)).map((r) => r.name));
    const owners = new Map((await neon.databases(projectId, branch.id)).map((d) => [d.name, d.owner_name]));
    const lines = [`# ${t.site} (Neon branch "${t.branch}"), written by tools/neon_provision.mjs`, '# Copy each block into that site\'s server .env. Never commit this file.'];
    const sql = [`-- ${t.site} (Neon branch "${t.branch}"), written by tools/neon_provision.mjs`,
      '-- Run each block once, in psql or the Neon SQL Editor, connected to that',
      '-- database over its DIRECT string as the login the block names.',
      '-- Re-running any of it is harmless.'];
    for (const proj of PROJECTS) {
      if (proj.branches && !proj.branches.includes(t.branch)) continue;
      if (!roles.has(proj.role)) {
        note(`${t.branch}: create role ${proj.role}`);
        if (!dryRun) await neon.createRole(projectId, branch.id, proj.role);
      } else if (fresh.has(branch.id)) {
        note(`${t.branch}: new password for ${proj.role} (copied from production)`);
        if (!dryRun) await neon.resetPassword(projectId, branch.id, proj.role);
      }
      let owner = owners.get(proj.database);
      if (owner === undefined) {
        note(`${t.branch}: create database ${proj.database} owned by ${proj.role}`);
        if (!dryRun) await neon.createDatabase(projectId, branch.id, proj.database, proj.role);
        owner = proj.role;
      }
      const block = databaseSql(proj, owner);
      if (block) {
        sql.push('', `-- ${proj.project}: database ${proj.database}, as ${block[0]}`, ...block[1]);
      } else {
        note(`${t.branch}: database ${proj.database} already exists, owned by ${owner}, not ${proj.role}: left as it is (docs/NEON.md, "A database that already exists")`);
      }
      if (!dryRun) {
        const pooled = await neon.connectionUri(projectId, branch.id, proj.database, proj.role, true);
        const direct = await neon.connectionUri(projectId, branch.id, proj.database, proj.role, false);
        lines.push('', `# ${proj.project}`, ...envLines(proj, pooled, direct));
      }
    }
    files[t.tier] = dryRun ? null : lines.join('\n') + '\n';
    sqlFiles[t.tier] = dryRun ? null : sql.join('\n') + '\n';
  }
  return { plan, files, sqlFiles };
}

export function writeTierFiles(files, outDir, ext = 'env') {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outDir, 0o700); // an existing folder keeps its old mode otherwise
  const written = [];
  for (const [tier, content] of Object.entries(files)) {
    if (!content) continue;
    const file = path.join(outDir, `${tier}.${ext}`);
    fs.writeFileSync(file, content, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    written.push(file);
  }
  return written;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.project) {
    console.log('usage: NEON_API_KEY=... node tools/neon_provision.mjs --project <project-id> [--dry-run] [--out DIR]');
    process.exit(args.help ? 0 : 2);
  }
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    console.error('NEON_API_KEY is not set (Neon console -> Account settings -> API keys).');
    process.exit(2);
  }
  const neon = neonClient({ apiKey, host: process.env.NEON_API_HOST || undefined });
  const { files, sqlFiles } = await provision({ neon, projectId: args.project, dryRun: args.dryRun });
  if (args.dryRun) return console.log('Dry run: nothing was changed.');
  for (const f of writeTierFiles(files, args.out)) console.log(`wrote ${f}`);
  for (const f of writeTierFiles(sqlFiles, args.out, 'sql')) console.log(`wrote ${f}  (run it: docs/NEON.md)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
