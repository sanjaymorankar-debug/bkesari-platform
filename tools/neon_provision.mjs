#!/usr/bin/env node
/**
 * Create the bkesari databases on Neon: one Neon project per app, named after
 * it (bkesari-hub, bkesari-milk, ...), in the Singapore region; in each, one
 * branch per tier (production, test, dev) holding that app's one database,
 * owned by the app's own login; and each tier's connection strings.
 *
 *   NEON_API_KEY=... node tools/neon_provision.mjs [--dry-run] [--out DIR]
 *
 * Safe to re-run: a project, branch, login or database that exists is left as
 * it is (looked up by name), and nothing is ever deleted. docs/NEON.md explains
 * the layout.
 *
 * Isolation. Apps never share a Neon project, so no app's login exists where
 * another app's data is. Tiers: a branch made from production starts as a copy
 * of it, its login's password included, so a login on a branch this run
 * created gets a new password there. A dev or test URL therefore cannot log in
 * to production even if its host name were swapped.
 *
 * Output. Connection strings contain passwords, so they are never printed.
 * Each tier gets one file, readable only by you (folder: --out DIR):
 *   ~/.bkesari_neon/<tier>.env   each app's lines for its server .env
 *
 * Talks to Neon's public API (https://console.neon.tech/api/v2, or
 * NEON_API_HOST). Uses only Node's standard library (Node 20+).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REGION = 'aws-ap-southeast-1'; // Singapore: Neon's closest region to India with every service
export const PG_VERSION = 16; // what every app's tests and CI run on

// Tier -> Neon branch name (the same in every app's project) and what it serves.
export const TIERS = [
  { tier: 'production', branch: 'production' },
  { tier: 'test', branch: 'test' },
  { tier: 'dev', branch: 'dev' },
];

// One Neon project per app, named bkesari-<app>. Its default branch is the
// first tier the app has; the app's login owns its one database there and is
// copied into the other tiers' branches. The env prefix is what the app reads;
// see each repository's .env.example.
export const APPS = [
  // The hub keeps Neon's default database name, neondb, where Neon Auth goes.
  { app: 'hub', database: 'neondb', role: 'bk_portal_app', env: 'DATABASE_URL' },
  { app: 'milk', database: 'bk_milk', role: 'bk_milk_app', env: 'DATABASE_URL' },
  { app: 'edu', database: 'bk_edu', role: 'bk_edu_app', env: 'DB_URL' },
  { app: 'ladwani', database: 'bk_ladwani', role: 'bk_ladwani_app', env: 'DATABASE_URL' },
  { app: 'atip', database: 'bk_atip', role: 'bk_atip_app', env: 'ATIP_DATABASE_URL' },
  { app: 'agtci', database: 'bk_agtci', role: 'bk_agtci_app', env: 'DATABASE_URL' },
  // The standalone edu repository, superseded by edu/ here but still behind
  // edutest.agtci.com: a test site, so it has the test tier only.
  { app: 'edu-standalone', database: 'bk_edu_standalone', role: 'bk_edu_standalone_app', env: 'DB_URL', tiers: ['test'] },
];

export const projectName = (a) => `bkesari-${a.app}`;
const tiersOf = (a) => TIERS.filter((t) => !a.tiers || a.tiers.includes(t.tier));

export function parseArgs(argv) {
  const args = { dryRun: false, out: path.join(os.homedir(), '.bkesari_neon') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
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
    projects: () => call('GET', '/projects?limit=400').then((r) => r.projects || []),
    createProject: (name, branch, database, role) =>
      call('POST', '/projects', {
        project: { name, region_id: REGION, pg_version: PG_VERSION, branch: { name: branch, database_name: database, role_name: role } },
      }).then((r) => r.project),
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

/** The lines a site's .env needs for one app, pooled for the app and direct for migrations. */
export function envLines(a, pooledUri, directUri) {
  if (a.env === 'DB_URL') {
    // Laravel (edu) reads DB_URL; migrations go over the direct endpoint.
    return [`DB_CONNECTION=pgsql`, `DB_URL=${pooledUri}`, `DB_URL_UNPOOLED=${directUri}`];
  }
  if (a.env === 'ATIP_DATABASE_URL') {
    // One long-lived process on the Mac: the direct endpoint, no pooler.
    return [`ATIP_DATABASE_URL=${directUri}`];
  }
  return [`DATABASE_URL=${pooledUri}`, `DATABASE_URL_UNPOOLED=${directUri}`];
}

export async function provision({ neon, dryRun = false, log = console.log }) {
  const plan = [];
  const note = (msg) => { plan.push(msg); log((dryRun ? '[dry run] ' : '') + msg); };
  const files = Object.fromEntries(TIERS.map((t) => [t.tier, dryRun ? null : [
    `# ${t.tier}, written by tools/neon_provision.mjs`, '# Copy each block into that site\'s server .env. Never commit this file.']]));

  // Branches this run made whose login still has the password copied from the
  // root branch. A re-run sees them as existing and cannot tell, so a failure
  // while any are left must name them.
  const unreset = new Set();
  try {
    const projects = await neon.projects();
    for (const a of APPS) {
      const name = projectName(a);
      const tiers = tiersOf(a);
      const matches = projects.filter((p) => p.name === name);
      if (matches.length > 1) throw new Error(`more than one Neon project is named ${name}; rename the extra one first`);
      let project = matches[0];
      if (!project) {
        note(`create project ${name} in ${REGION} (PostgreSQL ${PG_VERSION}): branch ${tiers[0].branch}, database ${a.database} owned by ${a.role}`);
        if (dryRun) continue; // nothing further can be read for a project that does not exist yet
        project = await neon.createProject(name, tiers[0].branch, a.database, a.role);
      } else if (project.region_id !== REGION) {
        note(`${name} is in ${project.region_id}, not ${REGION}: left as it is`);
      }

      let branches = await neon.branches(project.id);
      const root = branches.find((b) => b.name === tiers[0].branch) || branches.find((b) => b.default);
      if (!root) throw new Error(`${name} has no ${tiers[0].branch} or default branch to build the tiers from`);
      const fresh = new Set(); // branches this run created, from the root
      for (const t of tiers) {
        if (branches.some((b) => b.name === t.branch)) continue;
        note(`${name}: create branch ${t.branch} (from ${root.name})`);
        if (!dryRun) {
          const b = await neon.createBranch(project.id, t.branch, root.id);
          branches = [...branches, b];
          fresh.add(b.id);
          unreset.add(`${name}/${t.branch}`);
        }
      }

      for (const t of tiers) {
        const branch = branches.find((b) => b.name === t.branch);
        if (!branch) continue; // dry run: not created yet
        const roles = new Set((await neon.roles(project.id, branch.id)).map((r) => r.name));
        if (!roles.has(a.role)) {
          note(`${name}/${t.branch}: create role ${a.role}`);
          if (!dryRun) await neon.createRole(project.id, branch.id, a.role); // a new login, so a new password
          unreset.delete(`${name}/${t.branch}`);
        } else if (fresh.has(branch.id)) {
          note(`${name}/${t.branch}: new password for ${a.role} (copied from ${root.name})`);
          if (!dryRun) await neon.resetPassword(project.id, branch.id, a.role);
          unreset.delete(`${name}/${t.branch}`);
        }
        const owner = new Map((await neon.databases(project.id, branch.id)).map((d) => [d.name, d.owner_name])).get(a.database);
        if (owner === undefined) {
          note(`${name}/${t.branch}: create database ${a.database} owned by ${a.role}`);
          if (!dryRun) await neon.createDatabase(project.id, branch.id, a.database, a.role);
        } else if (owner !== a.role) {
          note(`${name}/${t.branch}: database ${a.database} is owned by ${owner}, not ${a.role}: left as it is (docs/NEON.md, "A database that already exists")`);
        }
        if (!dryRun) {
          const pooled = await neon.connectionUri(project.id, branch.id, a.database, a.role, true);
          const direct = await neon.connectionUri(project.id, branch.id, a.database, a.role, false);
          files[t.tier].push('', `# ${a.app} (Neon project ${name}, branch ${t.branch})`, ...envLines(a, pooled, direct));
        }
      }
    }
  } catch (err) {
    if (unreset.size) {
      err.message += `\nThese branches were created, but their login still has the password copied from the parent branch,` +
        ` and a re-run will not change it: ${[...unreset].join(', ')}. Reset that login's password on each (Neon console ->` +
        ` the project -> Branches -> the branch -> Roles -> Reset password) before using it.`;
    }
    throw err;
  }
  for (const tier of Object.keys(files)) if (files[tier]) files[tier] = files[tier].join('\n') + '\n';
  return { plan, files };
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
  if (args.help) {
    console.log('usage: NEON_API_KEY=... node tools/neon_provision.mjs [--dry-run] [--out DIR]');
    process.exit(0);
  }
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    console.error('NEON_API_KEY is not set (Neon console -> Account settings -> API keys).');
    process.exit(2);
  }
  const neon = neonClient({ apiKey, host: process.env.NEON_API_HOST || undefined });
  const { files } = await provision({ neon, dryRun: args.dryRun });
  if (args.dryRun) return console.log('Dry run: nothing was changed.');
  for (const f of writeTierFiles(files, args.out)) console.log(`wrote ${f}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
