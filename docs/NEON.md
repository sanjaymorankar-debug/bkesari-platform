# Databases on Neon

Every project behind bkesari.com keeps its data in **PostgreSQL on Neon**. This
is the layout, how to create it, and what each site's `.env` needs.

## Layout

One Neon project for the whole estate, **in an Asia region**, close to the
Hostinger servers and the people using the sites: every query a page makes
travels to Neon and back, several times per page. Inside the project, one
**branch per tier**, and on every branch one **database per project, owned by
that project's own login**:

| Neon branch | Serves |
|---|---|
| `production` (the default branch) | bkesari.com |
| `test` | test.bkesari.com |
| `dev` | dev.bkesari.com |

| Project | Database | Login | Repository |
|---|---|---|---|
| Hub: Task Tracker, ATIP viewer, Neon Auth | `neondb` | `bk_portal_app` | bkesari-platform (`portal/`) |
| TaskList | `bk_tasklist` | `bk_tasklist_app` | bkesari-platform (`portal/`) |
| Education | `bk_edu` | `bk_edu_app` | bkesari-platform (`edu/`) |
| LadWani | `bk_ladwani` | `bk_ladwani_app` | Ladwani |
| ATIP | `bk_atip` | `bk_atip_app` | ATIP-DEV |
| agtci.com (a separate site, same Neon project) | `bk_agtci` | `bk_agtci_app` | agtci |
| Education, standalone copy (edutest.agtci.com), `test` branch only | `bk_edu_standalone` | `bk_edu_standalone_app` | edu |

`neondb` is the project's default database. The hub keeps it because Neon Auth
lives there too, so it stays owned by the project's `neondb_owner`, and the
hub's login is granted what it needs instead.

The two rules from DEPLOY.md hold here too:

- **A tier never uses another tier's database.** Each branch is a separate
  copy with its own hosts, and each login has a different password on each
  branch, so a dev URL cannot log in to production.
- **A project only uses its own database.** Each login owns one database, and
  every other login is refused at the door (see *Shutting other logins out*).

Tests never use Neon. Every suite runs against a throwaway local PostgreSQL;
each repository's `TEST_SPEC.md` says how, and each suite refuses a host that
is not local.

## Two connection strings per database

Neon gives every database two endpoints, and every app uses both:

| Variable | Endpoint | Used for |
|---|---|---|
| `DATABASE_URL` | pooled (the host name contains `-pooler`) | the app while it runs |
| `DATABASE_URL_UNPOOLED` | direct | migrations and schema setup |

The pooled endpoint is PgBouncer in transaction mode. It lets many short-lived
web requests share a few database connections, which shared hosting needs,
but it does not keep session state between transactions, so migrations go
over the direct endpoint. Each app falls back to `DATABASE_URL` when
`DATABASE_URL_UNPOOLED` is unset, so a local setup needs only one variable.

Two projects use other names:

- **Education** (Laravel) reads `DB_URL` and `DB_URL_UNPOOLED`, with
  `DB_CONNECTION=pgsql`.
- **ATIP** reads `ATIP_DATABASE_URL`, set to the **direct** endpoint. It is one
  long-running process on the Mac, so it has nothing to gain from a pooler.

Both strings end in `?sslmode=require&channel_binding=require`. Every app now
passes both parameters on to its driver; see *What each app does about Neon*.

## Creating it

### 1. The project

Create the Neon project in the Asia region nearest the Hostinger servers.
Rename its default branch to `production` (Branches → the default branch →
Rename) if it is called `main`. Neon Auth, if the hub uses it, is set up on
this project's `neondb` as before.

### 2. Branches, databases and logins: the script

```bash
# Neon console -> Account settings -> API keys -> Create
export NEON_API_KEY=...
node tools/neon_provision.mjs --project <project-id> --dry-run   # what it would do
node tools/neon_provision.mjs --project <project-id>
```

The project id is in the console under Settings, and in the console's URL.

It creates whatever is missing, never changes or deletes anything that
exists, and can be re-run at any time. It creates the `test` and `dev`
branches from `production` **before** creating any login, so no tier inherits
another tier's password. If a branch is created later, from a `production`
that already has the logins, the copied logins get new passwords on the new
branch.

It writes two files per tier to `~/.bkesari_neon/`, readable only by you, and
never prints a password:

- `<tier>.env`: one block per project. Copy each block into that site's
  server `.env` (hPanel's file manager or SSH), then delete the file or keep it
  somewhere safe.
- `<tier>.sql`: the SQL in the next step.

`tests/neon-provision.test.js` exercises the script against a stand-in for
Neon's API.

### 3. Shutting other logins out

PostgreSQL lets every login connect to every database unless that is revoked,
and on Neon every login made through the console or API is a member of
`neon_superuser`, which can read and write all the data in any database it can
connect to. So "a project only uses its own database" holds only once each
database refuses other logins. The API cannot do that; SQL can.

Run each block of `<tier>.sql` once, connected to that database over its
**direct** string as the login the block names (psql, or the SQL Editor in
the console). For example, for TaskList on production:

```sql
-- as bk_tasklist_app, on bk_tasklist
REVOKE CONNECT, TEMPORARY ON DATABASE "bk_tasklist" FROM PUBLIC;
```

and for the hub's `neondb`, as `neondb_owner`:

```sql
GRANT CONNECT, TEMPORARY ON DATABASE "neondb" TO "bk_portal_app";
GRANT USAGE, CREATE ON SCHEMA public TO "bk_portal_app";
```

The file also carries, commented out, the matching `REVOKE … FROM PUBLIC` for
`neondb`. Run it once the login Neon Auth connects as has its own `GRANT
CONNECT`. Until then, other logins can still reach `neondb`.

Checked on a stand-in with the same privilege model: before the SQL, the hub's
login could read TaskList's tables; afterwards it is refused at
connection, while each project still uses its own database and the hub creates
and owns its tables in `neondb`.

### 4. A database that already exists

The script leaves an existing database alone. If one exists under another
owner (for example `bk_edu` made by `neondb_owner` while the project was set up
by hand), the script says so and writes no SQL for it. If it holds nothing
worth keeping, drop it in the console and re-run the script, which recreates
it with the right owner. If it holds data, hand it over deliberately, as
`neondb_owner` on that database: `GRANT <login> TO neondb_owner`, then
`ALTER DATABASE … OWNER TO <login>` and `ALTER … OWNER TO <login>` for each
object in its public schema. Do not use `REASSIGN OWNED`: it would also move
every other database that `neondb_owner` owns.

### 5. The schema, per project

With each site's `.env` in place, apply the schema over the direct endpoint,
using each project's own command:

| Project | Command, on the server or the Mac |
|---|---|
| Hub | none: the app creates its tables on start, over `DATABASE_URL_UNPOOLED` |
| TaskList, ATIP | none: the hub creates their tables on start, over `TASKLIST_DATABASE_URL_UNPOOLED` / `ATIP_DATABASE_URL_UNPOOLED` |
| Education | `php artisan migrate --force` (goes over `DB_URL_UNPOOLED`; see `edu/DEPLOYMENT.md`) |
| LadWani | `npx prisma migrate deploy` (Prisma's `directUrl`) |
| ATIP | `python main.py --init` with `database.backend = "postgresql"` |
| agtci | `npm run db:migrate` (reads `DATABASE_URL_UNPOOLED`) |

Extensions some schemas use (`citext`, `btree_gist`, `pgcrypto`) are created
by those migrations. A database's owner login can create them on Neon; no
superuser is needed.

## What each app does about Neon

Each project's testing agent ran its whole suite through a TLS PgBouncer in
transaction mode, ran migrations over a direct TLS connection, and cut its
connections from the server side, as a Neon suspend does. What that found and
fixed:

| App | Driver | Neon-specific handling |
|---|---|---|
| Hub | node-postgres | pool and per-transaction error listeners (a connection dropped mid-transaction used to end the process); 15 s connect timeout; `channel_binding` passed on; tables created over the direct URL |
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
- **Neon's plan sets the limits**: storage, compute hours, the number of
  branches and of projects. Dev and test can be scaled down (or allowed to
  suspend sooner) in the console without touching production.

## Moving existing data

| Project | Existing data | How |
|---|---|---|
| LadWani | the old Hostinger database `u879099820_miladwani`, which Neon replaces | export it from hPanel (phpMyAdmin) before it is deleted; `MIGRATION.md` in the Ladwani repo |
| Education | seeded demo data only | re-seed on dev and test; production loads `database/edu/02` and `04` only (`DEPLOY.md` Part 2) |
| Hub (Task Tracker) | whatever the tracker holds | export from the old site's `/tasks/` before switching |
| ATIP | the Mac's SQLite file | stays on SQLite until you switch it; `docs/POSTGRESQL_MIGRATION.md` in ATIP-DEV |

## Backups and restores

Neon keeps a history of each branch and can restore it to any point in that
window (console → Restore). For a copy you hold yourself, use
`pg_dump "$DATABASE_URL_UNPOOLED" > <project>-<date>.sql` per database: always
the direct string, never the pooled one.
