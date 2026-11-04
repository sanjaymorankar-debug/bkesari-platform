# bkesari platform

One repository for everything behind **bkesari.com**. Each part keeps its own language and is deployed on its own.

| Folder | What | Language | Where it runs |
|---|---|---|---|
| `portal/` | The hub (home with project tiles, about, contact, privacy, terms, `/admin`), **TaskList** (`/tasklist/`, its own accounts), the **ATIP viewer** (`/ATIP/`), LadWani served at `/ladwani/` | Node.js (Express) | Hostinger Node.js Web App: `dev.`/`test.`/`bkesari.com` |
| `packages/kesari-ui/` | **Kesari**, the design system every project uses (tokens, components, runtime; built to `portal/public/kesari-ui/1.0.0/`) | CSS, JS | served by the hub |
| `ladwani/` | LadWani: NestJS API + Next.js static export, its own accounts | TypeScript | built into and served by the hub |
| `mobile/` | Capacitor shells for the LadWani, Education and TaskList apps | JSON, HTML | Android / iOS (built on the Mac) |
| `edu/` | School & Student Governance platform | PHP (Laravel) | Hostinger PHP site: `devedu.`/`testedu.`/`edu.bkesari.com` |
| `atip/` | A pointer only — ATIP lives in the `ATIP-DEV` repo, and on the Mac at `/Users/agtci/Documents/Project_Documents/Projects/ATIP` | Python | Mac, pushing a view-only snapshot to `/ATIP/`; or a VPS for the full app |

## Environments

| Branch | Site |
|---|---|
| `dev` | https://dev.bkesari.com |
| `staging` | https://test.bkesari.com |
| `main` | https://bkesari.com |

Each project has **its own accounts** (no shared sign-in since 3 Nov 2026): see DEPLOY.md Part 9.
Design decisions and the design-thinking work are in `docs/design/`; the before-audit is `docs/ux-audit.md`.

The app shell (`portal/public/shared/menu.js`) is the same on every tier. Its tabs are
paths on the site you are on (`/ladwani/`, `/edu/`, `/tasks/`, `/ATIP/`, ...),
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
npm test           # 159 tests + 32 deploy-guard cases; the five PostgreSQL suites need TEST_DATABASE_URL
npm run build      # rebuild the committed Kesari files and TaskList's live-update client
npm run test:pg    # the same, reading TEST_DATABASE_URL from .env.test (copy .env.test.example)
```

The database tests run against a throwaway PostgreSQL named in `TEST_DATABASE_URL`
(never a `DB_*` or `DATABASE_URL` setting: they delete every row in the tracker
tables). `TEST_SPEC.md` has the full list of what to run.

## TaskList

`/tasklist/`, with its own accounts (mobile + OTP or email + password).
- **Views:** Today (overdue and due today, IST), Upcoming (agenda or calendar), Board (drag and drop, or Alt + arrows), Lists, Tags, Search, Completed, Settings.
- **Quick add:** one line, "Call vendor tomorrow 5pm #gokesari", with the date, time, tags, @list, !priority and repeat picked out (`portal/public/tasklist/quickadd.js`, also Marathi and Hindi day words).
- **A task:** notes, due date and time, priority, tags, sub-tasks, link attachments, repeat, a reminder, and the old tracker's status updates.
- **Offline:** installs as an app and works offline. Changes queue on the device and are sent when back online, never twice.
- **Your data (DPDP):** download it, or delete your account.

Deployment steps: **[DEPLOY.md](DEPLOY.md)**. Running the portal on Neon (Postgres, live updates, the report function and the snapshot archive, all declared in `neon.ts`): DEPLOY.md Part 8.
Running all three repos (ATIP-DEV, bkesari, this one) on a Mac, and their feature / merge status: **[docs/MAC_DEPLOYMENT.md](docs/MAC_DEPLOYMENT.md)**.
Education docs: `edu/README.md`, `edu/ROADMAP.md`. ATIP docs: `atip/README.md`.
