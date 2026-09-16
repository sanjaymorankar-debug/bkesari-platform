# bkesari platform

One repository for everything behind **bkesari.com**. Each part keeps its own language and is deployed on its own.

| Folder | What | Language | Where it runs |
|---|---|---|---|
| `portal/` | Welcome page, **Task Tracker** (`/tasks/`) and the **ATIP read-only viewer** (`/atip/`) | Node.js (Express) | Hostinger Node.js Web App: `bkesari.com` and `test.bkesari.com` |
| `edu/` | School & Student Governance platform | PHP (Laravel) | Hostinger PHP site: `edu.bkesari.com` / `testedu.bkesari.com` |
| `atip/` | AI Trading Intelligence Platform (scheduler, scoring, orders, dashboard) | Python | **Your PC only.** It pushes a view-only snapshot to `/atip/` |

## Environments

| Branch | Site | Menu links go to |
|---|---|---|
| `staging` | https://test.bkesari.com | `testladwani.bkesari.com`, `testedu.bkesari.com`, … |
| `main` | https://bkesari.com | `ladwani.bkesari.com`, `edu.bkesari.com`, … |

The menu picks `test` or production from the address it is opened on, so both branches use identical code.
Work on `staging`, check test.bkesari.com, then merge into `main`.

## Why ATIP is view-only online

ATIP's local dashboard can create, confirm and delete trade orders. It is **not** exposed to the internet.
Instead, `atip/publish_snapshot.py` runs every 5 minutes on your PC. It renders the dashboard page from the local database and uploads it to `/atip/api/snapshot` with a secret token.
The hosted site shows that page behind a login. Order buttons are hidden, and a Content-Security-Policy blocks the page from making any network request.
There is no connection from the website back to your PC.

## Run the portal locally

```
npm install
npm start          # http://localhost:3000  (uses SQLite in portal/data/, needs Node 22.13+)
```

## Task Tracker

- **Projects** and **tasks**. A task can belong to a project or be independent. Deleting a project keeps its tasks as independent tasks.
- Both have owner, status, description, **planned start/end**, **actual start/end**, **current step** and **next step**.
- **Status updates:** the server stamps the date and time when an update is posted. The latest updates show above the text box, and **View all updates** lists every one, newest first.
- The dashboard has counts, an overdue flag, search and a status filter.

Deployment steps: **[DEPLOY.md](DEPLOY.md)**.
Education docs: `edu/README.md`, `edu/ROADMAP.md`. ATIP docs: `atip/README.md`.
