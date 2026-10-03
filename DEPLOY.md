# Deploying dev.bkesari.com, test.bkesari.com, and bkesari.com

Nothing here can be done from this repo automatically; these are hPanel and SSH steps.
Three tiers, each with its own site(s) and its own database — **never share a database across
tiers**. Build and iterate on **dev first**, promote to **test**, check it, then promote to
**production**:

```
dev branch  →  dev.bkesari.com      (build/iterate here first)
     ↓ merge
staging branch → test.bkesari.com   (test — verify before production)
     ↓ merge
main branch →  bkesari.com          (production)
```

| | dev | test | production |
|---|---|---|---|
| Git branch | `dev` | `staging` | `main` |
| Portal (Node) | dev.bkesari.com | test.bkesari.com | bkesari.com |
| Education (PHP) | devedu.bkesari.com | testedu.bkesari.com | edu.bkesari.com |
| MySQL database | its own | its own | its own (never share with dev/test) |

**Promoting a tier** (once its site is confirmed working):

```bash
git checkout staging && git merge dev && git push origin staging   # dev -> test
git checkout main && git merge staging && git push origin main     # test -> production
```

Each promotion is a fast-forward as long as all work happens on `dev` first — don't commit
directly to `staging` or `main`.

The repository is **private**. Hostinger's GitHub connection (step 1) asks for access to it,
and the SSH clone in part 2 needs a GitHub Personal Access Token or a deploy key.

---

## Part 1: Portal, Task Tracker and ATIP viewer (Node.js)

### 1. Point the site at this repo

**test.bkesari.com currently runs the GoKesari staging app. These steps replace it.**
Before you start, note down its environment variables in case you want GoKesari back later.

hPanel → Websites → create/select **dev.bkesari.com** (Node.js Web App) → Settings / Deployments:

- Repository: `sanjaymorankar-debug/bkesari-platform`
- Branch: `dev`
- Build command: *(leave empty)*
- Start command: `npm start`
- Node version: 20 or 22

If hPanel won't let you change the repository of an existing app, delete the app and add a new
Node.js Web App for the same domain with the settings above.

For **test.bkesari.com**, do the same with branch `staging`. For **bkesari.com**, branch `main`.

### 2. Database

hPanel → Databases → MySQL: create a database and user (for example `u…_bk_test`).
In phpMyAdmin, run `portal/sql/mysql_schema.sql`. It is safe to re-run, and the app also creates missing tables on start.

### 3. Environment variables

| Variable | Value |
|---|---|
| `DB_CLIENT` | `mysql` |
| `DB_HOST` | `localhost` (or what hPanel shows) |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | from step 2 |
| `TRACKER_USER`, `TRACKER_PASSWORD` | login for `/tasks/` |
| `ATIP_USER`, `ATIP_PASSWORD` | login for `/atip/` |
| `ATIP_PUBLISH_TOKEN` | long random secret. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Use a **different one per tier** (dev/test/production). |

Redeploy. Check (same checks for dev.bkesari.com and test.bkesari.com — add a **DEV** badge
alongside the existing **TEST** one in `portal/` if you want the two visually distinguishable):
- the site shows the menu
- `/tasks/` asks for a login
- `/atip/` asks for a login, then says *No dashboard snapshot has been published yet*

---

## Part 2: Education (Laravel, PHP)

Same pattern as the existing `edu/DEPLOYMENT.md`, except that the app now lives in the `edu/` folder of this repo.
Prefer phpMyAdmin for schema changes (`database/edu/*.sql`, in order) over `php artisan migrate`
where you can — see that folder's own notes — but `migrate --force` is shown below too since a
fresh environment needs the `migrations` table populated either way.

Do this for **devedu.bkesari.com** / branch `dev` first. Once it checks out, repeat verbatim for
**testedu.bkesari.com** / branch `staging`, then **edu.bkesari.com** / branch `main`.

1. hPanel → create the website/subdomain (e.g. **devedu.bkesari.com**) (PHP 8.3) and a MySQL database for it.
2. SSH in and clone:

```bash
cd ~/domains/devedu.bkesari.com
git clone -b dev https://github.com/sanjaymorankar-debug/bkesari-platform.git platform
cd platform/edu
composer install --no-dev --optimize-autoloader
cp .env.example .env
nano .env        # APP_URL=https://devedu.bkesari.com, APP_DEBUG=false, DB_* from step 1
php artisan key:generate --force
php artisan migrate --force
php artisan db:seed --force      # first time only
```

3. Wire up the web root:

```bash
cp -r ~/domains/devedu.bkesari.com/platform/edu/public/. ~/domains/devedu.bkesari.com/public_html/
ln -sfn ../platform/edu/storage/app/public ~/domains/devedu.bkesari.com/public_html/storage
nano ~/domains/devedu.bkesari.com/public_html/index.php
#   require __DIR__.'/../platform/edu/vendor/autoload.php';
#   require_once __DIR__.'/../platform/edu/bootstrap/app.php';
#   (and the maintenance-mode line: __DIR__.'/../platform/edu/storage/framework/maintenance.php')
php artisan config:cache && php artisan route:cache && php artisan view:cache
```

4. Cron (hourly analytics), via `crontab -e`:

```
* * * * * cd ~/domains/devedu.bkesari.com/platform/edu && php artisan schedule:run >> /dev/null 2>&1
```

**Redeploy later:** `cd ~/domains/devedu.bkesari.com/platform && git pull`, then in `edu/` run
`composer install --no-dev --optimize-autoloader && php artisan migrate --force`. Copy `public/.` again and re-run the three `cache` commands.

Repeat all of the above for **testedu.bkesari.com** (branch `staging`) and **edu.bkesari.com**
(branch `main`), substituting the domain/branch throughout.
The existing site at edutest.agtci.com is unaffected and keeps using the old `edu` repo until you retire it.

---

## Part 3: ATIP snapshot upload (on your PC)

ATIP keeps running exactly as it does now (`python main.py`). Only the uploader is new.

1. Create `D:\Projects\ATIP\atip_data\publish.json` (never committed):

```json
{
  "targets": [
    {"url": "https://dev.bkesari.com/atip/api/snapshot",  "token": "<ATIP_PUBLISH_TOKEN of dev.bkesari.com>"},
    {"url": "https://test.bkesari.com/atip/api/snapshot", "token": "<ATIP_PUBLISH_TOKEN of test.bkesari.com>"},
    {"url": "https://bkesari.com/atip/api/snapshot",      "token": "<ATIP_PUBLISH_TOKEN of bkesari.com>"}
  ]
}
```

(Drop the `dev` entry once dev.bkesari.com's portal app isn't actually set up yet — it's only needed once that site exists.)

2. Try it once: `cd D:\Projects\ATIP` then `python publish_snapshot.py`. Each target should log a ✓.
3. Schedule it every 5 minutes (PowerShell):

```powershell
$a = New-ScheduledTaskAction -Execute 'D:\Projects\ATIP\publish_snapshot.bat'
$t = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'ATIP publish snapshot' -Action $a -Trigger $t -Description 'Upload read-only ATIP dashboard to bkesari.com'
```

Output goes to `atip_data\publish.log`. The viewer's banner shows how old the snapshot is, so a stopped PC is obvious.

---

## Part 4: The shared menu

The top menu is defined once, in **`portal/public/shared/menu.js`**, in its `TABS`
array. Adding, renaming or reordering a tab is an edit to that one file — there is
no second list to keep in step, including the cards on the welcome page, which are
built from the same array.

Tabs are **paths**, not hostnames (`/milk/`, `/edu/`, …). Each tier serves every
project under one origin, so the same link is correct on dev, test and production
with no substitution. The tier only affects the badge beside the brand, and is read
from the hostname (`dev.` / `test.` / bare) or from an explicit `window.BKESARI_ENV`
a server can set from its own `APP_ENV`.

### How a project includes it

One tag, and no markup:

```html
<script src="/shared/menu.js" defer></script>
```

It injects itself at the top of `<body>`, or into `<div data-bkesari-menu></div>`
if the page marks a slot. It needs **no JavaScript to operate** — the mobile
hamburger is a native `<details>` disclosure — so it survives a strict
Content-Security-Policy and a failed script load degrades to a page without a bar
rather than a broken one.

For a page the server builds, `require()` the same file and call
`renderHtml({ pathname, env })`. The ATIP viewer does exactly that: its CSP allows
inline scripts but not `'self'`, so an external `<script>` there would be blocked,
and server-rendering keeps that page's policy untouched.

### Which paths the hub serves itself

| Path | Served by |
|---|---|
| `/`, `/tasks/`, `/atip/` | this repo (`portal/`) |
| `/global-warming/`, `/driving-simulator/` | this repo, static — still to be added |
| `/milk/`, `/edu/`, `/ladwani/` | their own apps, reached through the hub |

A tab whose destination is not deployed on a tier yet answers with a short
"not available on this tier" page rather than a bare 404, so the menu never
dead-ends while the estate is still being assembled.

---

## Part 5: Ladwani (full rebuild — NestJS + Next.js)

As of 2026-10-01 the app behind `ladwani.bkesari.com` / `testladwani.bkesari.com` is the full
rebuild at `D:\My_Code\community-platform` (github.com/sanjaymorankar-debug/miladwani, branch
`rebuild`) — NOT the older single-Next.js-app `D:\My_Code\miladwani-source` the Sep 28 SQL
export was mistakenly based on. The rebuild covers Family Registry, Matrimony, Community
Social, Bookings/Assets, Payments/Fees/Ledger, and Admin/Reporting (M0–M5), vs. the older
app's Family Registry/Directory/Matrimony only.

**Database**: `database/ladwani/01_ladwani_schema.sql` (69 tables), `02_ladwani_reference_data.sql`,
`03_ladwani_first_admin.sql` were regenerated from the rebuild's actual Prisma schema and seed
script on 2026-10-01, and validated end-to-end against a throwaway local MySQL database (schema
import, reference data, and both first-admin options all confirmed working). Import all three via
phpMyAdmin, in order, exactly like `edu`'s migrations.

**Architecture — this needs two Hostinger sites, not one.** Unlike `portal/` (a single Node
process) or `edu/` (a single PHP site), the rebuild is two separate processes that talk to each
other: a NestJS API server and a Next.js web server (the web app proxies `/api/v1/*` to the API
via `NEXT_PUBLIC_API_URL`, see `apps/web/next.config.js`). Hostinger's Node.js Web App hosting
runs one process per site, so this needs:

1. A Node.js site for the **web app** (`apps/web`) → `ladwani.bkesari.com` / `testladwani.bkesari.com`
2. A second Node.js site for the **API** (`apps/api`) → e.g. `ladwani-api.bkesari.com` / `testladwani-api.bkesari.com`
3. Set `NEXT_PUBLIC_API_URL` on the web site to the API site's URL
4. Set `WEB_ORIGIN` on the API site to the web site's URL (CORS), and `JWT_SECRET` (the API
   refuses to boot in production without it — see `apps/api/src/main.ts`)

Full environment variable list, build commands, and the production cutover checklist are in
`D:\My_Code\community-platform\docs\21-deployment-guide.md`, `22-backup-strategy.md`, and
`23-production-cutover-plan.md` — the cutover plan there was written against the old
`devmiladwani.agtci.com` target and needs its destructive-step section re-pointed at whichever
database actually needs replacing here (there is no pre-existing live Ladwani data on bkesari.com
to protect, since neither `ladwani.bkesari.com` nor `devmiladwani.agtci.com` currently resolve).

**Not yet done**: creating the two hPanel sites and their DNS records — this still needs manual
hPanel/SSH access this repo's automation doesn't have.
