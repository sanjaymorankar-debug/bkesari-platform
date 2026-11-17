#!/usr/bin/env node
/**
 * Day one of the bkesari ID (D-039, docs/design/bkesari-id.md §4): gives every
 * existing LadWani, Education and TaskList account with a CONFIRMED email a
 * bkesari ID (the hub's `users`) and the project access its role already
 * implies, so nobody has to ask for a project they already use.
 *
 *   node tools/link_accounts_to_hub.mjs                  # dry run: prints the plan, changes nothing
 *   node tools/link_accounts_to_hub.mjs --apply          # writes users + project_access + audit_log
 *   node tools/link_accounts_to_hub.mjs --csv plan.csv   # the plan as a spreadsheet as well
 *
 *   HUB_DATABASE_URL        the hub's database (DIRECT string); DATABASE_URL's when unset
 *   TASKLIST_DATABASE_URL   TaskList's database, optional; the hub's when unset (read only)
 *   LADWANI_DATABASE_URL    LadWani's database, optional (read only)
 *   EDU_DATABASE_URL        Education's database, optional (read only)
 *
 * Rules:
 *   - Only a confirmed email is trusted (D-035): TaskList email_verified,
 *     LadWani email_verified, Education email_verified_at. The rest are listed
 *     and left alone; they sign in and ask, like anyone new.
 *   - The built-in administrators' addresses (@builtin.bkesari.com) are left
 *     alone: they are owners at the hub already (D-036).
 *   - Suspended, blocked, deactivated or deleted project accounts get nothing.
 *   - Roles: TaskList owner → owner, member → editor; LadWani ADMIN/OPERATOR/
 *     KARTA/MEMBER → admin/operator/karta/member (the highest held); Education
 *     parent/student/teacher/school_admin as they are, system_admin → admin.
 *     Any other role has no hub equivalent and is listed.
 *   - Writes only the hub. An existing grant, active or revoked, is never
 *     touched (a revocation stands); an existing hub user is reused, never
 *     changed. LadWani grants start "awaiting LadWani verification"; LadWani
 *     reports its own state on the person's first visit.
 *   - Each project links its own account to the bkesari ID on the person's
 *     first visit, by the same confirmed email.
 *
 * Safe to re-run: what exists is skipped.
 */
import pg from 'pg';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const RESERVED = /@builtin\.bkesari\.com$/i;
const lower = (e) => String(e || '').trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Each project's roles in the hub's order (lowest first), and how its own roles map onto them. */
export const PROJECTS = {
  tasklist: { order: ['viewer', 'editor', 'owner'], map: { owner: 'owner', member: 'editor' } },
  ladwani: { order: ['member', 'karta', 'operator', 'admin'], map: { MEMBER: 'member', KARTA: 'karta', OPERATOR: 'operator', ADMIN: 'admin' } },
  edu: { order: ['parent', 'student', 'teacher', 'school_admin', 'admin'], map: { parent: 'parent', student: 'student', teacher: 'teacher', school_admin: 'school_admin', system_admin: 'admin' } },
};

/** The highest hub role the project's own roles give, and the roles that give none. */
export function hubRole(project, roles) {
  const p = PROJECTS[project];
  const mapped = []; const unknown = [];
  for (const r of roles.filter(Boolean)) (p.map[r] ? mapped : unknown).push(p.map[r] || r);
  const role = mapped.sort((a, b) => p.order.indexOf(b) - p.order.indexOf(a))[0] || null;
  return { role, unknown };
}

/**
 * The plan. Pure, so it is tested without a database.
 * @param accounts  [{ project, id, email, name, confirmed, active, roles: [] }]
 * @param hubUsers  [{ id, email }]                existing bkesari IDs
 * @param grants    [{ user_id, project_key }]     existing project_access rows
 * @returns { create: [{ email, name, from }], grant: [{ email, project, role, from }], skip: [{ project, id, email, reason }] }
 */
export function plan({ accounts, hubUsers = [], grants = [] }) {
  const byEmail = new Map(hubUsers.map((u) => [lower(u.email), u]));
  const granted = new Set(grants.map((g) => `${g.user_id}|${g.project_key}`));
  const create = new Map();
  const grant = new Map();
  const skip = [];
  for (const a of accounts) {
    const email = lower(a.email);
    const from = `${a.project}:${a.id}`;
    const no = (reason) => skip.push({ project: a.project, id: String(a.id), email, reason });
    if (!EMAIL.test(email)) { no('no email'); continue; }
    if (RESERVED.test(email)) { no('built-in administrator (already an owner at the hub)'); continue; }
    if (!a.confirmed) { no('email not confirmed'); continue; }
    if (!a.active) { no('account not active'); continue; }
    const { role, unknown } = hubRole(a.project, a.roles || []);
    if (!role) { no(`no hub role for ${unknown.join(', ') || 'no role'}`); continue; }
    if (unknown.length) no(`also holds ${unknown.join(', ')} (no hub equivalent; ${role} granted)`);
    const existing = byEmail.get(email);
    if (!existing && !create.has(email)) create.set(email, { email, name: a.name || null, from });
    if (existing && granted.has(`${existing.id}|${a.project}`)) { no('already has a grant for this project (left as it is)'); continue; }
    const key = `${email}|${a.project}`;
    const prev = grant.get(key);
    const order = PROJECTS[a.project].order;
    if (!prev || order.indexOf(role) > order.indexOf(prev.role)) grant.set(key, { email, project: a.project, role, from });
  }
  return { create: [...create.values()], grant: [...grant.values()], skip };
}

/* ---------- reading the projects (read only) ---------- */

async function connect(url) {
  if (!url) return null;
  const c = new pg.Client({ connectionString: url, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined });
  await c.connect();
  return c;
}
const has = async (c, table) => Boolean((await c.query('SELECT to_regclass($1) AS t', [table])).rows[0].t);

export async function readTaskList(c) {
  if (!c || !(await has(c, 'tl_users'))) return [];
  const { rows } = await c.query('SELECT id, email, name, role, status, email_verified FROM tl_users ORDER BY id');
  return rows.map((r) => ({ project: 'tasklist', id: r.id, email: r.email, name: r.name, confirmed: r.email_verified === true, active: r.status === 'active', roles: [r.role] }));
}

export async function readLadWani(c) {
  if (!c || !(await has(c, 'users'))) return [];
  const { rows } = await c.query(`SELECT u.id, u.email, u.status, u.email_verified, u.deleted_at,
      COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id ORDER BY u.id`);
  // PENDING is a LadWani account still in its own sign-up; LadWani's second step decides it.
  return rows.map((r) => ({ project: 'ladwani', id: r.id, email: r.email, name: null, confirmed: r.email_verified === true,
    active: !r.deleted_at && ['ACTIVE', 'PENDING'].includes(r.status), roles: r.roles }));
}

export async function readEducation(c) {
  if (!c || !(await has(c, 'users'))) return [];
  const { rows } = await c.query(`SELECT u.id, u.email::text AS email, u.name, u.email_verified_at IS NOT NULL AS confirmed,
      COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
    FROM users u LEFT JOIN model_has_roles m ON m.model_id = u.id AND m.model_type LIKE '%User'
    LEFT JOIN roles r ON r.id = m.role_id GROUP BY u.id ORDER BY u.id`);
  return rows.map((r) => ({ project: 'edu', id: r.id, email: r.email, name: r.name, confirmed: r.confirmed === true, active: true, roles: r.roles }));
}

/* ---------- writing the hub ---------- */

export async function apply(hub, p) {
  const ids = new Map();
  await hub.query('BEGIN');
  try {
    for (const u of p.create) {
      const r = await hub.query(`INSERT INTO users (email, name, email_verified, migrated_from) VALUES ($1,$2,TRUE,$3)
        ON CONFLICT DO NOTHING RETURNING id`, [u.email, u.name, u.from]);
      if (r.rows[0]) ids.set(u.email, String(r.rows[0].id));
    }
    let granted = 0;
    for (const g of p.grant) {
      const id = ids.get(g.email) || String((await hub.query('SELECT id FROM users WHERE lower(email) = $1', [g.email])).rows[0].id);
      const r = await hub.query(`INSERT INTO project_access (user_id, email, project_key, role, status, approved_by, approved_at, project_state, updated_at)
        VALUES ($1,$2,$3,$4,'active','migration', now(), $5, now()) ON CONFLICT (user_id, project_key) DO NOTHING RETURNING id`,
      [id, g.email, g.project, g.role, g.project === 'ladwani' ? 'pending' : null]);
      if (r.rows[0]) {
        granted += 1;
        await hub.query('INSERT INTO audit_log (actor, action, target, detail) VALUES ($1,$2,$3,$4)',
          ['migration', 'grant', `${g.project}:${g.email}`, `role ${g.role}, from ${g.from} (D-039 day one)`]);
      }
    }
    await hub.query('COMMIT');
    return { users: ids.size, grants: granted };
  } catch (err) {
    await hub.query('ROLLBACK');
    throw err;
  }
}

function csv(p) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['action', 'email', 'project', 'role', 'source', 'reason'].join(',')];
  for (const u of p.create) lines.push(['create bkesari ID', u.email, '', '', u.from, ''].map(q).join(','));
  for (const g of p.grant) lines.push(['grant', g.email, g.project, g.role, g.from, ''].map(q).join(','));
  for (const s of p.skip) lines.push(['left alone', s.email, s.project, '', `${s.project}:${s.id}`, s.reason].map(q).join(','));
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2), env = process.env, log = console) {
  const doApply = argv.includes('--apply');
  const csvAt = argv.indexOf('--csv');
  const hubUrl = env.HUB_DATABASE_URL || env.DATABASE_URL;
  if (!hubUrl) { log.error('Set HUB_DATABASE_URL (or DATABASE_URL) to the hub\'s database.'); return 2; }
  const hub = await connect(hubUrl);
  const sameTl = !env.TASKLIST_DATABASE_URL || env.TASKLIST_DATABASE_URL === hubUrl;
  const tl = sameTl ? hub : await connect(env.TASKLIST_DATABASE_URL);
  const lw = await connect(env.LADWANI_DATABASE_URL);
  const edu = await connect(env.EDU_DATABASE_URL);
  try {
    const ready = (await hub.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_sub' AND table_schema = ANY(current_schemas(false))")).rows.length;
    if (!ready) { log.error('The hub database has no bkesari ID tables yet: deploy the hub (it applies hub_schema.sql) first.'); return 2; }
    const accounts = [...await readTaskList(tl), ...await readLadWani(lw), ...await readEducation(edu)];
    const hubUsers = (await hub.query('SELECT id, email FROM users WHERE email IS NOT NULL')).rows;
    const grants = (await hub.query('SELECT user_id, project_key FROM project_access')).rows;
    const p = plan({ accounts, hubUsers, grants });
    log.log(`Read: TaskList ${accounts.filter((a) => a.project === 'tasklist').length}, LadWani ${lw ? accounts.filter((a) => a.project === 'ladwani').length : 'not set'}, Education ${edu ? accounts.filter((a) => a.project === 'edu').length : 'not set'} accounts.`);
    log.log(`Plan: ${p.create.length} new bkesari IDs, ${p.grant.length} project grants, ${p.skip.length} left alone.`);
    for (const g of p.grant) log.log(`  grant  ${g.email}  ${g.project}  ${g.role}  (${g.from})`);
    for (const s of p.skip) log.log(`  leave  ${s.email || '-'}  ${s.project}:${s.id}  ${s.reason}`);
    if (csvAt !== -1 && argv[csvAt + 1]) { fs.writeFileSync(argv[csvAt + 1], csv(p)); log.log(`Plan written to ${argv[csvAt + 1]}.`); }
    if (!doApply) { log.log('Dry run: nothing changed. Run again with --apply to write it.'); return 0; }
    const out = await apply(hub, p);
    log.log(`Applied: ${out.users} bkesari IDs made, ${out.grants} grants written (audit_log actor "migration").`);
    return 0;
  } finally {
    for (const c of new Set([hub, tl, lw, edu])) if (c) await c.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err.message); process.exitCode = 1; });
}
