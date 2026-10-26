# bkesari platform

One repository for everything behind **bkesari.com**. Each part keeps its own language and is deployed on its own.

| Folder | What | Language | Where it runs |
|---|---|---|---|
| `portal/` | Welcome page, the old **Task Tracker** (`/tasks/`, being replaced by TaskList at `/tasklist/`) and the **ATIP viewer** (`/ATIP/`) | Node.js (Express) | Hostinger Node.js Web App: `dev.`/`test.`/`bkesari.com` |
| `edu/` | School & Student Governance platform | PHP (Laravel) | Hostinger PHP site: `devedu.`/`testedu.`/`edu.bkesari.com` |
| `atip/` | A pointer only — ATIP lives in the `ATIP-DEV` repo, and on the Mac at `/Users/agtci/Documents/Project_Documents/Projects/ATIP` | Python | Mac, pushing a view-only snapshot to `/ATIP/`; or a VPS for the full app |

## Environments

| Branch | Site |
|---|---|
| `dev` | https://dev.bkesari.com |
| `staging` | https://test.bkesari.com |
| `main` | https://bkesari.com |

The menu (`portal/public/shared/menu.js`) is the same on every tier. Its tabs are
paths on the site you are on (`/ladwani/`, `/edu/`, `/tasklist/`, `/ATIP/`, ...),
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

The portal keeps its data in **PostgreSQL** (13+), the database every app on bkesari.com uses.
`tools/setup_local_postgres.sh` creates a local one and writes the settings into `.env`
(docs/MAC_DEPLOYMENT.md, step 3); `.env.example` lists them.

```
npm install
node --env-file=.env portal/server.js   # http://localhost:3001 with the .env the setup script writes
# or, with your own database:
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/bk_portal npm start   # http://localhost:3000
```

The app creates its tables on first start (`portal/sql/schema.sql`). Every hand-run SQL script for
the sites is under `database/`, all PostgreSQL. Hosting needs a PostgreSQL service — Hostinger's
web hosting has none; see DEPLOY.md, *Databases*.

## Tests

```
npm run check      # parse the server and the shared menu
npm test           # 80 tests + 32 deploy-guard cases; the 15 database tests need TEST_DATABASE_URL
npm run test:pg    # the same, reading TEST_DATABASE_URL from .env.test (copy .env.test.example)
```

The database tests run against a throwaway PostgreSQL named in `TEST_DATABASE_URL`
(never a `DB_*` or `DATABASE_URL` setting: they delete every row in the tracker
tables). `TEST_SPEC.md` has the full list of what to run.

## TaskList (`/tasklist/`)

The **TaskList** tab is its own app, in the `TaskList` repository (Node.js on
PostgreSQL). Set `TASKLIST_ORIGIN` to where it runs (locally
`http://127.0.0.1:3100`) and the hub forwards `/tasklist/` to it, like `/edu/`
(DEPLOY.md Part 7). With `TASKLIST_ORIGIN` set, the old address `/tasks/`
redirects to `/tasklist/`; without it, `/tasks/` still shows the old Task Tracker
below. TaskList's README covers its setup and the one-off import of the Task
Tracker's data.

## Task Tracker (old, at `/tasks/`)

Being replaced by TaskList. Its code and tables stay here until the owner has
confirmed the import into TaskList; removing them is a later task.

- **Projects** and **tasks**. A task can belong to a project or be independent. Deleting a project keeps its tasks as independent tasks.
- Both have owner, status, description, **planned start/end**, **actual start/end**, **current step** and **next step**.
- **Status updates:** the server stamps the date and time when an update is posted. The latest updates show above the text box, and **View all updates** lists every one, newest first.
- The dashboard has counts, an overdue flag, search and a status filter.

Deployment steps: **[DEPLOY.md](DEPLOY.md)**. Running the portal on Neon (Postgres, sign-in,
live updates, the report function and the snapshot archive, all declared in `neon.ts`): DEPLOY.md Part 8.
Running all three repos (ATIP-DEV, bkesari, this one) on a Mac, and their feature / merge status: **[docs/MAC_DEPLOYMENT.md](docs/MAC_DEPLOYMENT.md)**.
Education docs: `edu/README.md`, `edu/ROADMAP.md`. ATIP docs: `atip/README.md`.
