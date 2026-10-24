# Databases on Neon

Every project behind bkesari.com keeps its data in **PostgreSQL on Neon**. This
is the layout, how to create it, and what each site's `.env` needs.

## Layout

One Neon project for the whole estate. Inside it, one **branch per tier**, and
on every branch, one **database per project, owned by its own role**:

| Neon branch | Serves |
|---|---|
| `production` (the default branch) | bkesari.com |
| `test` | test.bkesari.com |
| `dev` | dev.bkesari.com |

| Project | Database | Role | Repository |
|---|---|---|---|
| Hub: Task Tracker, ATIP viewer | `portal` | `portal_app` | bkesari-platform (`portal/`) |
| Milk & Dairy | `milk` | `milk_app` | bkesari |
| Education | `edu` | `edu_app` | bkesari-platform (`edu/`) |
| LadWani | `ladwani` | `ladwani_app` | Ladwani |
| ATIP | `atip` | `atip_app` | ATIP-DEV |
| agtci.com (a separate site, same Neon project) | `agtci` | `agtci_app` | agtci |
| Education, standalone copy (edutest.agtci.com), `test` branch only | `edu_standalone` | `edu_standalone_app` | edu |

The two rules from DEPLOY.md hold here too:

- **A tier never uses another tier's database.** Each branch is a separate
  copy with its own hosts, and each role has a different password on each
  branch, so a dev URL cannot log in to production.
- **A project only uses its own database.** Each role owns one database.

Tests never use Neon. Every suite runs against a throwaway local PostgreSQL;
each repository's `TEST_SPEC.md` says how.

## Two connection strings per database

Neon gives every database two endpoints, and every app uses both:

| Variable | Endpoint | Used for |
|---|---|---|
| `DATABASE_URL` | pooled (the host name contains `-pooler`) | the app while it runs |
| `DATABASE_URL_UNPOOLED` | direct | migrations and schema setup |

The pooled endpoint is PgBouncer in transaction mode. It lets many short-lived
web requests share a few database connections, which is what shared hosting
needs, but it does not keep session state between transactions. That is why
migrations, which do, go over the direct endpoint. Each app falls back to
`DATABASE_URL` when `DATABASE_URL_UNPOOLED` is unset, so a local setup needs
only one variable.

Two projects use other names:

- **Education** (Laravel) reads `DB_URL` and `DB_URL_UNPOOLED`, with `DB_CONNECTION=pgsql`.
- **ATIP** reads `ATIP_DATABASE_URL`, set to the **direct** endpoint. It is one
  long-running process on the Mac, so it has nothing to gain from a pooler.

Both strings end in `?sslmode=require&channel_binding=require`: Neon accepts
only encrypted connections.

## Creating it

### With the script (recommended)

```bash
# Neon console -> Account settings -> API keys -> Create
export NEON_API_KEY=...
node tools/neon_provision.mjs --project <project-id> --dry-run   # what it would do
node tools/neon_provision.mjs --project <project-id>
```

The project id is in the console under Settings, and in the console's URL.
The script needs the default branch to be called `production`; rename it in
the console first if it is called `main`.

It creates whatever is missing, never changes or deletes anything that
exists, and can be re-run at any time. It creates the `test` and `dev`
branches from `production` **before** creating any role, so no tier inherits
another tier's password. If a branch is created later, from a `production`
that already has the roles, the copied roles get new passwords on the new
branch.

It writes each tier's connection strings to `~/.bkesari_neon/<tier>.env`,
readable only by you, and never prints them. Each file holds one block per
project. Copy each block into that site's server `.env` (hPanel's file manager
or SSH), then delete the file or keep it somewhere safe.

`tests/neon-provision.test.js` exercises the script against a stand-in for
Neon's API.

### By hand in the console

The same layout: create branches `test` and `dev` from `production`; then on
each branch create each role (Roles → New role) and its database (Databases →
New database, owner = that role). Copy each connection string from Connect,
with *Connection pooling* on for `DATABASE_URL` and off for
`DATABASE_URL_UNPOOLED`. If a role existed on `production` before you created
`test` or `dev`, reset its password on the new branch.

### Then, per project

Point the site at its database (the `.env` block above), then apply the
schema over the direct endpoint, using each project's own command:

| Project | Command, on the server or the Mac |
|---|---|
| Hub | none: the app creates its tables on start |
| Milk & Dairy | `npm run db:migrate` |
| Education | `php artisan migrate --force` (see `edu/DEPLOYMENT.md`) |
| LadWani | `npx prisma migrate deploy` |
| ATIP | `python main.py --init` with `database.backend = "postgresql"` |
| agtci | `npm run db:migrate` |

Extensions some schemas use (`citext`, `btree_gist`, `pgcrypto`) are created
by those migrations. Neon lets a database's owner role create them; no
superuser is needed.

## Hosting notes

- **Hostinger's web hosting has no PostgreSQL of its own**, which is why the
  databases are on Neon. The sites stay where they are; they connect out to
  Neon on port 5432. Check once per site that outbound 5432 is open:
  `nc -vz <neon-host> 5432` over SSH.
- **PHP needs `pdo_pgsql`** (hPanel → Advanced → PHP Configuration →
  Extensions) for Education.
- **Old client libraries and SNI.** Neon routes on the TLS server name. A
  client built against libpq older than 14 may not send it and is refused
  with "Endpoint ID is not specified". The fix is to add
  `options=endpoint%3D<endpoint-id>` to the URL (the endpoint id is the
  first part of the host name, `ep-...`).
- **Scale to zero.** A branch with no traffic for a while suspends its compute,
  and the first request afterwards takes a moment longer while it wakes. The
  apps are built to survive the dropped idle connections this causes.
- **Neon's plan sets the limits**: storage, compute hours and the number of
  branches. Dev and test can be scaled down (or allowed to suspend sooner)
  in the console without touching production.

## Moving existing data

| Project | Existing data | How |
|---|---|---|
| LadWani | the live Hostinger MySQL `u879099820_miladwani` | `MIGRATION.md` in the Ladwani repo (`npm run migrate:mysql-to-postgres`) — back it up first |
| Milk & Dairy | the MySQL dev database, if it holds anything worth keeping | `DEPLOYMENT.md` §7a in the bkesari repo |
| Education | seeded demo data only | re-seed on PostgreSQL instead of copying |
| Hub (Task Tracker) | whatever the tracker holds | export from the old site's `/tasks/` before switching |
| ATIP | the Mac's SQLite file | stays on SQLite until you switch it; `docs/POSTGRESQL_MIGRATION.md` in ATIP-DEV |

## Backups and restores

Neon keeps a history of each branch and can restore it to any point in that
window (console → Restore). For a copy you hold yourself, use
`pg_dump "$DATABASE_URL_UNPOOLED" > <project>-<date>.sql` per database.
