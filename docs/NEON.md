# Databases on Neon

Every app behind bkesari.com (and agtci.com) keeps its data in **PostgreSQL
16 on Neon**. This is the layout, how it was created, and what each site's
`.env` needs.

## Layout

**One Neon project per app**, named after it, all in **Singapore**
(`aws-ap-southeast-1`), Neon's closest region to India with every service.
Every query a page makes travels to Neon and back, several times per page,
so the region matters. Inside each project, **one branch per tier**, and on
each branch the app's one database, owned by the app's own login:

| App | Neon project (id) | Database | Login | Repository |
|---|---|---|---|---|
| Hub: Task Tracker, ATIP viewer | `bkesari-hub` (`aged-snow-54676890`) | `neondb` | `bk_portal_app` | bkesari-platform (`portal/`) |
| Milk & Dairy | `bkesari-milk` (`wispy-glade-42617868`) | `bk_milk` | `bk_milk_app` | bkesari |
| Education | `bkesari-edu` (`falling-unit-35354402`) | `bk_edu` | `bk_edu_app` | bkesari-platform (`edu/`) |
| LadWani | `bkesari-ladwani` (`shy-water-73883631`) | `bk_ladwani` | `bk_ladwani_app` | Ladwani |
| ATIP | `bkesari-atip` (`green-butterfly-70738779`) | `bk_atip` | `bk_atip_app` | ATIP-DEV |
| agtci.com | `bkesari-agtci` (`odd-smoke-66262026`) | `bk_agtci` | `bk_agtci_app` | agtci |
| Education, standalone copy (edutest.agtci.com) | `bkesari-edu-standalone` (`mute-block-56314761`) | `bk_edu_standalone` | `bk_edu_standalone_app` | edu |

| Branch (in every project) | Serves |
|---|---|
| `production` (the default branch) | bkesari.com (agtci.com for agtci) |
| `test` | test.bkesari.com (agtci's staging tier; edutest.agtci.com for the standalone copy, which has only this branch) |
| `dev` | dev.bkesari.com (agtci's dev tier) |

Why a project per app: Neon's Free plan allows 10 branches and 1 GB per
project, and up to 100 projects. One project per app fits that with room to
spare, and gives each app its own 1 GB.

The isolation rules:

- **An app never sees another app's data.** No two apps share a Neon project,
  so no app's login exists where another app's data is. (Inside one project,
  every login Neon makes belongs to `neon_superuser`, which can read any
  database it can connect to. That is why apps do not share projects.)
- **A tier never uses another tier's database.** Each branch has its own
  hosts. Each login got its own password on `test` and `dev` when those
  branches were made, so a dev or test URL cannot log in to production.

The bkesari projects created before this layout (`Social_Activities`, in
US East, with a `production` and a `dev` branch) are no longer used. Delete
them in the console when you are sure nothing points at them. The GoKesari
projects in the same account belong to a separate site and are never
touched by anything here.

Tests never use Neon. Every suite runs against a throwaway local PostgreSQL;
each repository's `TEST_SPEC.md` says how, and each suite refuses a host that
is not local.

## Two connection strings per database

Neon gives every branch two endpoints, and every app uses both:

| Variable | Endpoint | Used for |
|---|---|---|
| `DATABASE_URL` | pooled (the host name contains `-pooler`) | the app while it runs |
| `DATABASE_URL_UNPOOLED` | direct | migrations and schema setup |

The pooled endpoint is PgBouncer in transaction mode. It lets many short-lived
web requests share a few database connections, which shared hosting needs,
but it does not keep session state between transactions, so migrations go
over the direct endpoint. Each app falls back to `DATABASE_URL` when
`DATABASE_URL_UNPOOLED` is unset, so a local setup needs only one variable.

Two apps use other names:

- **Education** (Laravel) reads `DB_URL` and `DB_URL_UNPOOLED`, with
  `DB_CONNECTION=pgsql`.
- **ATIP** reads `ATIP_DATABASE_URL`, set to the **direct** endpoint. It is one
  long-running process on the Mac, so it has nothing to gain from a pooler.

Both strings end in `?sslmode=require&channel_binding=require`. Every app
passes both parameters on to its driver; see *What each app does about Neon*.

## How it was created, and how to re-create it

The projects, branches, logins and databases above were created on
2026-10-24 through Neon's API. `tools/neon_provision.mjs` does the same and
checks an existing layout:

```bash
# Neon console -> Account settings -> API keys -> Create
export NEON_API_KEY=...
node tools/neon_provision.mjs --dry-run   # what it would do
node tools/neon_provision.mjs
```

It finds each `bkesari-<app>` project by name and creates whatever is missing:
the project (in Singapore, PostgreSQL 16, its default branch holding the
app's database owned by the app's login), then the other tier branches, made
from the default branch **before** anything holds data. A login copied into a
branch this run made gets a new password there; if a run fails before that,
it names each branch whose login still has the copied password, which you
then reset in the console (a re-run cannot tell). It never changes or deletes
anything that exists, refuses two projects with the same name, and can be
re-run at any time. It touches no project outside the seven names above.

It writes one file per tier to `~/.bkesari_neon/`, readable only by you, and
never prints a password: `<tier>.env`, one block per app. Copy each block
into that site's server `.env` (hPanel's file manager or SSH), then delete
the file or keep it somewhere safe.

`tests/neon-provision.test.js` exercises the script against a stand-in for
Neon's API.

### A database that already exists

The script leaves an existing database alone. If one exists under another
owner, the script says so. If it holds nothing worth keeping, drop it in the
console and re-run the script, which recreates it with the right owner. If it
holds data, hand it over deliberately, as its current owner on that database:
`ALTER DATABASE … OWNER TO <login>`, and `ALTER … OWNER TO <login>` for each
object in its public schema.

### The schema, per app

With each site's `.env` in place, apply the schema over the direct endpoint,
using each app's own command:

| App | Command, on the server or the Mac |
|---|---|
| Hub | none: the app creates its tables on start, over `DATABASE_URL_UNPOOLED` |
| Milk & Dairy | `npm run db:migrate` (reads `DATABASE_URL_UNPOOLED`) |
| Education | `php artisan migrate --force` (goes over `DB_URL_UNPOOLED`; see `edu/DEPLOYMENT.md`) |
| LadWani | `npx prisma migrate deploy` (Prisma's `directUrl`) |
| ATIP | `python main.py --init` with `database.backend = "postgresql"` |
| agtci | `npm run db:migrate` (reads `DATABASE_URL_UNPOOLED`) |

Extensions some schemas use (`citext`, `btree_gist`, `pgcrypto`) are created
by those migrations. Each app's login owns its database and belongs to
`neon_superuser`, so it can create them; no superuser is needed.

## What each app does about Neon

Each app's testing agent ran its whole suite through a TLS PgBouncer in
transaction mode, ran migrations over a direct TLS connection, and cut its
connections from the server side, as a Neon suspend does. What that found and
fixed:

| App | Driver | Neon-specific handling |
|---|---|---|
| Hub | node-postgres | pool and per-transaction error listeners (a connection dropped mid-transaction used to end the process); 15 s connect timeout; `channel_binding` passed on; tables created over the direct URL |
| Milk & Dairy | node-postgres + Drizzle | error listener on every client (the same mid-transaction crash); one pool per process; `channel_binding`; migrations over the direct URL without needing the app's secrets |
| Education (both copies) | PHP pdo_pgsql | unnamed statements (PHP's named ones broke every transaction on the pooler, and a one-statement transaction was silently rolled back); no session `SET`s; `channel_binding` passed on; migrations over `DB_URL_UNPOOLED` |
| LadWani | Prisma 5 | `directUrl`; idle connections retired after 30 s (otherwise each dead one failed once with P1017); 15 s connect timeout; `pgbouncer=true` not needed |
| ATIP | psycopg 3 | direct endpoint; read transaction closed before a connection goes back, so a pooler can reuse it |
| agtci | node-postgres + Drizzle | pool error listener; 15 s connect timeout; `channel_binding`; migrations over the direct URL |

## Hosting notes

- **Hostinger's web hosting has no PostgreSQL of its own**, which is why the
  databases are on Neon. The sites stay where they are and connect out to
  Neon on port 5432. Check once per site that outbound 5432 is open:
  `nc -vz <neon-host> 5432` over SSH.
- **PHP needs `pdo_pgsql`** (hPanel → Advanced → PHP Configuration →
  Extensions) for Education, built against libpq 14 or newer.
- **Old client libraries and SNI.** Neon routes on the TLS server name. A
  client built against libpq older than 14 may not send it and is refused
  with "Endpoint ID is not specified". The fix is to add
  `options=endpoint%3D<endpoint-id>` to the URL (the endpoint id is the
  first part of the host name, `ep-...`).
- **Scale to zero.** A branch with no traffic for a while suspends its compute,
  and the first request afterwards takes a moment longer while it wakes. The
  apps' connect timeouts allow for it, and they recover from the connections
  a suspend drops.
- **The Free plan's limits are per project:** 1 GB of storage (writes stop
  beyond it) and compute hours (the compute suspends until the next month).
  The console shows each project's usage.

## Moving existing data

| App | Existing data | How |
|---|---|---|
| LadWani | the live Hostinger MySQL `u879099820_miladwani` | `MIGRATION.md` in the Ladwani repo — back it up first |
| Milk & Dairy | the MySQL dev database, if it holds anything worth keeping | `DEPLOYMENT.md` §7a in the bkesari repo |
| Education | seeded demo data only | re-seed on dev and test; production loads `database/edu/02` and `04` only (`DEPLOY.md` Part 2) |
| Hub (Task Tracker) | whatever the tracker holds | export from the old site's `/tasks/` before switching |
| ATIP | the Mac's SQLite file | stays on SQLite until you switch it; `docs/POSTGRESQL_MIGRATION.md` in ATIP-DEV |

## Backups and restores

Neon keeps a history of each branch and can restore it to any point in that
window (console → the project → Restore). For a copy you hold yourself, use
`pg_dump "$DATABASE_URL_UNPOOLED" > <app>-<date>.sql` per database: always
the direct string, never the pooled one.
