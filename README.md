# bkesari.com: Welcome Portal + Task Tracker

One Node.js app that serves:

| URL | What |
|---|---|
| `https://bkesari.com/` | Welcome page with the menu: Ladwani, Asmy Milks, ATIP, Education, Driving Simulator, Task Tracker |
| `https://bkesari.com/tasks/` | Task Tracker (login protected) |

## Menu links (`public/sites.js`)

Every menu item opens its own subdomain. `ENV_PREFIX` is added in front of each one:

| Menu | `ENV_PREFIX: 'test'` (current) | `ENV_PREFIX: ''` (production) |
|---|---|---|
| Ladwani | testladwani.bkesari.com | ladwani.bkesari.com |
| Asmy Milks | testasmymilk.bkesari.com | asmymilk.bkesari.com |
| ATIP | testatip.bkesari.com | atip.bkesari.com |
| Education | testedu.bkesari.com | edu.bkesari.com |
| Driving Simulator | testdriving.bkesari.com | driving.bkesari.com |
| Task Tracker | bkesari.com/tasks/ | bkesari.com/tasks/ |

To rename a subdomain, change its `sub`, or change `tagline`/`icon`, edit `public/sites.js`. No rebuild is needed.

## Task Tracker features

- **Projects** and **tasks**. A task can belong to a project or be independent.
  If you delete a project, its tasks are kept as independent tasks.
- Both have: owner, status, description, **planned start/end**, **actual start/end**,
  **current step** and **next step**.
- **Status updates (comments):** type an update and click *Post update* (or press Ctrl+Enter).
  The server stamps the date and time automatically. The latest updates appear above the text box.
- **View all updates:** a page listing every update, latest at the top and oldest at the end, each with its date and time (IST).
- Dashboard: counts, an overdue flag (past planned end and not completed), search, and a status filter.

## Run locally (no database server needed)

Needs Node.js 22.13 or later. Local runs use the built-in SQLite, stored in `data/tasks.db`.

```
npm install
npm start
```

Open http://localhost:3000 (portal) and http://localhost:3000/tasks/ (tracker).

## Deploy on Hostinger (bkesari.com)

1. **Database:** in hPanel, go to *Databases → MySQL* and create a database and user.
   In phpMyAdmin, run `sql/mysql_schema.sql` (it is safe to re-run). The app also creates any missing tables when it starts.
2. **App:** in hPanel, go to *Websites → Add website → Node.js Web App* for **bkesari.com**.
   Connect a GitHub repo containing this folder, or upload it as a zip.
   Set the start command to `npm start` (there is no build step).
3. **Environment variables** (see `.env.example`):

   | Variable | Value |
   |---|---|
   | `DB_CLIENT` | `mysql` |
   | `DB_HOST` | `localhost` (or the host hPanel shows) |
   | `DB_NAME` / `DB_USER` / `DB_PASSWORD` | from step 1 |
   | `TRACKER_USER` / `TRACKER_PASSWORD` | the login for /tasks/ (**always set these in production**) |

4. **Subdomains:** each menu target must exist as its own site or subdomain in hPanel
   (for example `testladwani.bkesari.com`) and point to that app's deployment.
   The portal only links to them. It does not host them.

### If bkesari.com is plain (non-Node) hosting
The welcome page is static. You can upload `public/index.html` and `public/sites.js` into `public_html`.
The tracker still needs Node, so deploy this app on a subdomain (for example `testtasks.bkesari.com`)
and change the Task Tracker entry in `sites.js` to `url: 'https://testtasks.bkesari.com/tasks/'`.

## Files

- `server.js`: Express server, REST API under `/tasks/api`, and login check
- `db.js`: runs the same SQL on MySQL (production) or SQLite (local)
- `sql/mysql_schema.sql`, `sql/sqlite_schema.sql`: table definitions
- `public/index.html`, `public/sites.js`: welcome portal
- `public/tasks/index.html`: tracker UI

## Moving data from the old tracker
The old tracker's tables (`tasks`, `field_history`, `comments`) do not match the new schema, so old data is not imported automatically.
