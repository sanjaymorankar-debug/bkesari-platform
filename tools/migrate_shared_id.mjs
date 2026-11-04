#!/usr/bin/env node
/**
 * One-time move from the shared bkesari ID (Neon Auth on the hub, retired
 * 3 Nov 2026) to each project's own accounts.
 *
 *   node tools/migrate_shared_id.mjs                 # dry run: prints the plan, changes nothing
 *   node tools/migrate_shared_id.mjs --apply         # writes TaskList accounts, hands old tasks to their owner
 *   node tools/migrate_shared_id.mjs --apply --notify   # and emails / texts each person once
 *   node tools/migrate_shared_id.mjs --csv plan.csv  # the plan as a spreadsheet, for sending by hand
 *
 * Reads (never writes) the hub database: who held which project in
 * project_access, plus names from Neon Auth's own table when it is there.
 *   HUB_DATABASE_URL        the hub's database (the DIRECT string)
 *   TASKLIST_DATABASE_URL   TaskList's database (DIRECT), optional; DATABASE_URL's when unset
 *   LADWANI_DATABASE_URL    LadWani's database, optional (read only)
 *   EDU_DATABASE_URL        Education's database, optional (read only)
 *   HUB_OWNER_EMAILS        the owner (default agtcipl@gmail.com): used every project
 *   TRACKER_ALLOWED_EMAILS  the old Task Tracker's allow-list, if it was set
 *   MAIL / SMS providers    as portal/notify.js reads them (HUB_ prefix first)
 *
 * What it does, per project:
 *   TaskList   the old tracker had no accounts of its own: each person who could
 *              open it (owner, allow-list, project_access 'tasklist') gets a
 *              tl_users row with their email and no password; the owner's has
 *              role 'owner'. Every list and task from the old shared tracker
 *              (user_id NULL) goes to the owner. They sign in with "Forgot
 *              password" (email), or a one-time code sent to that email.
 *   LadWani    accounts were already made in LadWani's own database the first
 *   Education  time each person came through the hub (users.hub_user_id). Those
 *              are kept as they are; this only checks each one is there and lists
 *              anyone with access who never visited (they sign up themselves).
 *
 * Safe to re-run: existing accounts are left alone, and only tasks that still
 * belong to no one are handed over. Nothing is ever deleted.
 */
import pg from 'pg';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const SIGN_IN = {
  tasklist: { name: 'TaskList', url: 'https://bkesari.com/tasklist/sign-in' },
  ladwani: { name: 'LadWani', url: 'https://bkesari.com/ladwani/sign-in/' },
  edu: { name: 'Education', url: 'https://bkesari.com/edu/sign-in' },
};

const lower = (e) => String(e || '').trim().toLowerCase();
const list = (v) => String(v || '').split(/[\s,]+/).map(lower).filter(Boolean);

/**
 * The plan, from the hub's records. Pure, so it is tested without a database.
 * @param rows   project_access rows { user_id, email, project_key, role }
 * @param names  Map email -> name (from Neon Auth), optional
 */
export function plan({ rows, owners, trackerAllowed = [], names = new Map() }) {
  const people = new Map(); // email -> { email, name, hubUserId, projects: Set, owner }
  const add = (email, project, hubUserId) => {
    const e = lower(email);
    if (!e) return;
    if (!people.has(e)) people.set(e, { email: e, name: names.get(e) || null, hubUserId: hubUserId || null, projects: new Set(), owner: owners.includes(e) });
    const p = people.get(e);
    if (hubUserId && !p.hubUserId) p.hubUserId = hubUserId;
    p.projects.add(project);
  };
  for (const r of rows) {
    const key = r.project_key === 'tasks' ? 'tasklist' : r.project_key;
    if (SIGN_IN[key]) add(r.email, key, r.user_id);
  }
  for (const e of trackerAllowed) add(e, 'tasklist', null);
  for (const e of owners) for (const key of Object.keys(SIGN_IN)) add(e, key, null);
  return [...people.values()].map((p) => ({ ...p, projects: [...p.projects].sort() })).sort((a, b) => a.email.localeCompare(b.email));
}

/** The one message each person gets, in plain words. */
export function message(person) {
  const lines = person.projects.map((k) => `- ${SIGN_IN[k].name}: ${SIGN_IN[k].url}`);
  return {
    subject: 'Your bkesari sign-in has changed: one account per project',
    text: `Namaskar${person.name ? ` ${person.name}` : ''},\n\n`
      + 'From 3 Nov 2026 there is no single bkesari ID. Each project now has its own account, '
      + 'so signing in to one never signs you in to another.\n\n'
      + `We have kept your place in ${person.projects.length === 1 ? 'the project' : 'each project'} you used:\n${lines.join('\n')}\n\n`
      + 'Open the link, then sign in with this email address and the one-time code we send to it, or choose "Forgot password?" '
      + 'to set a password for that project.\n\n— bkesari.com',
  };
}

async function connect(url) {
  if (!url) return null;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

async function tableExists(c, qualified) {
  const r = await c.query('SELECT to_regclass($1) AS t', [qualified]);
  return Boolean(r.rows[0].t);
}

async function main(argv = process.argv.slice(2), env = process.env, log = console) {
  const apply = argv.includes('--apply');
  const notify = argv.includes('--notify');
  const csvAt = argv.includes('--csv') ? argv[argv.indexOf('--csv') + 1] : null;
  if (notify && !apply) throw new Error('--notify needs --apply: tell people only once their accounts are in place.');
  if (!env.HUB_DATABASE_URL) throw new Error('Set HUB_DATABASE_URL to the hub database (the direct string).');

  const hub = await connect(env.HUB_DATABASE_URL);
  const tl = await connect(env.TASKLIST_DATABASE_URL || env.HUB_DATABASE_URL);
  const lw = await connect(env.LADWANI_DATABASE_URL);
  const edu = await connect(env.EDU_DATABASE_URL);
  try {
    const rows = (await tableExists(hub, 'project_access'))
      ? (await hub.query("SELECT user_id, email, project_key, role FROM project_access WHERE status = 'active'")).rows : [];
    const names = new Map();
    if (await tableExists(hub, 'neon_auth."user"')) {
      for (const r of (await hub.query('SELECT email, name FROM neon_auth."user"')).rows) if (r.name) names.set(lower(r.email), r.name);
    }
    const owners = list(env.HUB_OWNER_EMAILS || 'agtcipl@gmail.com');
    const people = plan({ rows, owners, trackerAllowed: list(env.TRACKER_ALLOWED_EMAILS), names });
    log.log(`${people.length} people held a bkesari ID with access to a project.`);

    const result = [];
    for (const p of people) {
      const r = { email: p.email, name: p.name || '', projects: p.projects.join(' '), tasklist: '', ladwani: '', edu: '' };
      if (p.projects.includes('tasklist')) {
        const has = await tl.query('SELECT id FROM tl_users WHERE lower(email) = $1', [p.email]);
        if (has.rows.length) r.tasklist = 'exists';
        else if (apply) {
          await tl.query(`INSERT INTO tl_users (email, name, role, migrated_from, email_verified) VALUES ($1, $2, $3, $4, TRUE)
            ON CONFLICT DO NOTHING`, [p.email, p.name, p.owner ? 'owner' : 'member', p.hubUserId || 'tracker-allow-list']);
          r.tasklist = 'created';
        } else r.tasklist = 'would create';
      }
      for (const [key, c] of [['ladwani', lw], ['edu', edu]]) {
        if (!p.projects.includes(key)) continue;
        if (!c) { r[key] = 'not checked (no database URL)'; continue; }
        const q = await c.query('SELECT id FROM users WHERE (hub_user_id IS NOT NULL AND hub_user_id = $1) OR lower(email) = $2 LIMIT 1', [p.hubUserId || '', p.email]);
        r[key] = q.rows.length ? 'account kept' : 'never visited: will sign up';
      }
      result.push(r);
    }

    // The old shared tracker's rows go to the owner.
    const ownerRow = owners.length ? (await tl.query('SELECT id, email FROM tl_users WHERE lower(email) = ANY($1) ORDER BY id LIMIT 1', [owners])).rows[0] : null;
    const orphans = (await tl.query('SELECT (SELECT COUNT(*) FROM projects WHERE user_id IS NULL) AS lists, (SELECT COUNT(*) FROM tasks WHERE user_id IS NULL) AS tasks')).rows[0];
    if (ownerRow && apply) {
      await tl.query('BEGIN');
      try {
        await tl.query('UPDATE projects SET user_id = $1 WHERE user_id IS NULL', [ownerRow.id]);
        await tl.query('UPDATE tasks SET user_id = $1 WHERE user_id IS NULL', [ownerRow.id]);
        await tl.query("INSERT INTO tl_audit_log (user_id, actor, action, detail) VALUES ($1, 'migrate_shared_id', 'legacy-handover', $2)",
          [ownerRow.id, `${orphans.lists} lists, ${orphans.tasks} tasks`]);
        await tl.query('COMMIT');
      } catch (err) { await tl.query('ROLLBACK'); throw err; }
    }
    log.log(`Old shared tracker: ${orphans.lists} lists and ${orphans.tasks} tasks ${apply ? (ownerRow ? `given to ${ownerRow.email}` : 'left as they are (no owner account yet)') : `would go to ${ownerRow ? ownerRow.email : owners[0] || 'the owner'}`}.`);

    if (notify) {
      const { createNotifier } = await import(new URL('../portal/notify.js', import.meta.url));
      const n = createNotifier('HUB', env, { fromName: 'bkesari' });
      if (!n.mail) throw new Error('--notify: no mail provider configured (MAIL_HOST + MAIL_USERNAME + MAIL_PASSWORD for Hostinger email, or RESEND_API_KEY + MAIL_FROM, or MAIL_WEBHOOK_URL).');
      for (const p of people) {
        const m = message(p);
        try { await n.mail(p.email, m.subject, m.text); result.find((r) => r.email === p.email).notified = 'yes'; } catch (err) {
          result.find((r) => r.email === p.email).notified = `failed: ${err.message}`;
        }
      }
    }

    for (const r of result) log.log(`${r.email.padEnd(32)} ${r.projects.padEnd(22)} tasklist=${r.tasklist || '-'} ladwani=${r.ladwani || '-'} edu=${r.edu || '-'}${r.notified ? ` notified=${r.notified}` : ''}`);
    if (csvAt) {
      const cols = ['email', 'name', 'projects', 'tasklist', 'ladwani', 'edu', 'notified'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      fs.writeFileSync(csvAt, [cols.join(','), ...result.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n', { mode: 0o600 });
      log.log(`Plan written to ${csvAt}`);
    }
    if (!apply) log.log('Dry run: nothing was changed. Run again with --apply.');
    return result;
  } finally {
    for (const c of [hub, tl, lw, edu]) if (c) await c.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

export { main };
