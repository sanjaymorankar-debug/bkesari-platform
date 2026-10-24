# bkesari platform

One repository for everything behind **bkesari.com**. Each part keeps its own language and is deployed on its own.

| Folder | What | Language | Where it runs |
|---|---|---|---|
| `portal/` | Welcome page, **Task Tracker** (`/tasks/`) and the **ATIP viewer** (`/ATIP/`) | Node.js (Express) | Hostinger Node.js Web App: `dev.`/`test.`/`bkesari.com` |
| `edu/` | School & Student Governance platform | PHP (Laravel) | Hostinger PHP site: `devedu.`/`testedu.`/`edu.bkesari.com` |
| `atip/` | A pointer only — ATIP lives in the `ATIP-DEV` repo, and on the Mac at `/Users/agtci/Documents/Project_Documents/Projects/ATIP` | Python | Mac, pushing a view-only snapshot to `/ATIP/`; or a VPS for the full app |

## Environments

| Branch | Site |
|---|---|
| `dev` | https://dev.bkesari.com |
| `staging` | https://test.bkesari.com |
| `main` | https://bkesari.com |

The menu (`portal/public/shared/menu.js`) is the same on every tier. Its tabs are
paths on the site you are on (`/milk/`, `/edu/`, `/ladwani/`, `/tasks/`, `/ATIP/`, ...),
and the hub forwards each app's path to the app behind it (DEPLOY.md Part 7). The
tier badge comes from the address: `dev.` and `localhost` are dev, `test.` is test,
anything else is production.

Build on `dev`, promote to `staging`, check test.bkesari.com, then merge into `main`.

## ATIP at `/ATIP/`

ATIP's local dashboard can create, confirm and delete trade orders, so by default
**nothing order-capable is exposed**. Instead `publish_snapshot.py` runs every 5
minutes on the Mac (a LaunchAgent, `deploy/launchd/` in the ATIP repo), renders the
dashboard page from the local database and uploads it to `/ATIP/api/snapshot` with a
secret token. The hosted site shows that page behind a login at **`/ATIP/`**. Order
buttons are hidden and a Content-Security-Policy blocks the page from making any
network request. There is no connection from the website back to the Mac.

`/atip/` still resolves, so old bookmarks and older uploaders keep working.

Running the **full interactive** ATIP at `/ATIP/` instead is possible but is a
different shape: it needs a VPS (shared hosting cannot hold a long-lived Python
process, the scheduler, or the Dhan WebSocket), and it gives up the isolation
above, so it is gated on TLS, auth on every route, `enterprise.enabled` and
`execution.mode: paper`. See `docs/HOSTED_DEPLOYMENT.md` in the ATIP repo.

## Run the portal locally

```
npm install
npm start          # http://localhost:3000  (uses SQLite in portal/data/, needs Node 22.13+)
```

With a Neon `DATABASE_URL` in the environment the portal uses Postgres instead
(`DB_CLIENT=postgres`, chosen automatically when `DATABASE_URL` is set).

## Tests

```
npm run check      # parse the server and the shared menu
npm test           # 70 tests: menu, proxy, database, and the deploy guard
```

`npm test` needs no setup. The database tests run on SQLite, which needs no
server, and the eight MySQL and eight Postgres cases skip themselves with a reason.

Production runs on MySQL, so those eight are the ones that matter most. To run
them, point them at a throwaway database:

```
cp .env.test.example .env.test     # defaults match the local devstack
npm run test:mysql                 # the MySQL cases run; Postgres needs TEST_PG_URL
```

They apply the schema, then assert that the adapter and the app's trickier SQL
behave identically on both clients — auto-increment ids, `null` versus
`undefined`, date and timestamp formats, the latest-comment subqueries, and the
snapshot prune, whose derived-table alias MySQL requires and SQLite does not
care about. A ninth test compares `portal/sql/mysql_schema.sql` against
`portal/sql/sqlite_schema.sql` and `portal/sql/postgres_schema.sql`, since
nothing else keeps the three in step.

The same eight cases also run on Postgres, which is what Neon serves: set
`TEST_PG_URL` to a throwaway Postgres database (see `.env.test.example`).

CI runs all three: the `test` job on SQLite, the `db-mysql` job against a real
MySQL 8.0 service and the `db-postgres` job against Postgres 16, each of which
fails if any of its own cases skips. Note that Hostinger may serve
MySQL or MariaDB; these tests prove the SQL works on MySQL 8.0, not that
MariaDB behaves the same.

The tests take `TEST_MYSQL_*`, not the `DB_*` names the app reads. They delete
every row in the four tracker tables, so they must not be able to pick up a
real database from a `.env` by accident.

## Task Tracker

- **Projects** and **tasks**. A task can belong to a project or be independent. Deleting a project keeps its tasks as independent tasks.
- Both have owner, status, description, **planned start/end**, **actual start/end**, **current step** and **next step**.
- **Status updates:** the server stamps the date and time when an update is posted. The latest updates show above the text box, and **View all updates** lists every one, newest first.
- The dashboard has counts, an overdue flag, search and a status filter.

Deployment steps: **[DEPLOY.md](DEPLOY.md)**. Running the portal on Neon (Postgres, sign-in,
live updates, the report function and the snapshot archive, all declared in `neon.ts`): DEPLOY.md Part 8.
Running all three repos (ATIP-DEV, bkesari, this one) on a Mac, and their feature / merge status: **[docs/MAC_DEPLOYMENT.md](docs/MAC_DEPLOYMENT.md)**.
Education docs: `edu/README.md`, `edu/ROADMAP.md`. ATIP docs: `atip/README.md`.
