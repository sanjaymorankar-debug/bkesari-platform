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
| `ATIP_USER`, `ATIP_PASSWORD` | login for `/ATIP/` |
| `ATIP_PUBLISH_TOKEN` | long random secret. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Use a **different one per tier** (dev/test/production). |

Redeploy. Check (same checks for dev.bkesari.com and test.bkesari.com — add a **DEV** badge
alongside the existing **TEST** one in `portal/` if you want the two visually distinguishable):
- the site shows the menu
- `/tasks/` asks for a login
- `/ATIP/` asks for a login, then says *No dashboard snapshot has been published yet*
  (`/atip/` still resolves, for old bookmarks)

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

## Part 3: ATIP

ATIP's code now lives on the Mac at `/Users/agtci/Documents/Project_Documents/Projects/ATIP`
(it was `D:\Projects\ATIP` on the old Windows machine).

There are two ways to put ATIP behind `*.bkesari.com/ATIP/`. **Decide which before
creating any site**, because they need different infrastructure.

### Option A — read-only snapshot (no extra hosting)

ATIP keeps running on the Mac. A LaunchAgent pushes a rendered dashboard page to
the portal every 5 minutes, and the portal serves it behind a login at `/ATIP/`.
Nothing order-capable faces the internet and no VPS is needed.

1. Create `/Users/agtci/Documents/Project_Documents/Projects/ATIP/atip_data/publish.json` (never committed):

```json
{
  "targets": [
    {"url": "https://dev.bkesari.com/ATIP/api/snapshot",  "token": "<ATIP_PUBLISH_TOKEN of dev.bkesari.com>"},
    {"url": "https://test.bkesari.com/ATIP/api/snapshot", "token": "<ATIP_PUBLISH_TOKEN of test.bkesari.com>"},
    {"url": "https://bkesari.com/ATIP/api/snapshot",      "token": "<ATIP_PUBLISH_TOKEN of bkesari.com>"}
  ]
}
```

Drop any tier whose portal app does not exist yet. The portal accepts both
`/ATIP/api/snapshot` and the older `/atip/api/snapshot`, so an uploader configured
the old way keeps working.

2. Try it once:

```bash
cd /Users/agtci/Documents/Project_Documents/Projects/ATIP
python3 publish_snapshot.py --dry-run   # builds the page, uploads nothing
python3 publish_snapshot.py             # each target should log a ✓
```

3. Schedule it every 5 minutes — `launchd`, not Task Scheduler:

```bash
cd /Users/agtci/Documents/Project_Documents/Projects/ATIP
deploy/launchd/install.sh snapshot
launchctl list | grep com.atip          # 0 in the second column = last run was clean
```

`deploy/launchd/install.sh` (no argument) also installs `com.atip.platform`, which
starts ATIP itself at login and restarts it if it exits non-zero — the
restart-on-failure the Windows Task Scheduler task used to provide.

Output goes to `atip_data/publish.log`. The viewer's banner shows how old the
snapshot is, so a sleeping Mac is obvious.

### Option B — the full interactive app at `/ATIP/`

Read `/Users/agtci/Documents/Project_Documents/Projects/ATIP/docs/HOSTED_DEPLOYMENT.md` first. Two things it settles:

1. **This cannot run on Hostinger shared hosting.** ATIP needs a long-lived Python
   process, an in-process scheduler firing at 07:00/15:30/16:45 IST, and a
   persistent outbound WebSocket for the Dhan feed. Shared hosting provides none
   of those. `/ATIP/` must proxy to a **VPS** (2 vCPU / 4 GB is enough). Everything
   else on `bkesari.com` is unaffected.
2. **Exposing it is a gated step.** The interactive dashboard can create, confirm
   and cancel orders — precisely what Option A was designed to keep off the
   internet. TLS, authentication in front of *every* route (not just the mutating
   ones), `enterprise.enabled: true` and `execution.mode: paper` are prerequisites,
   not polish.

In outline: run ATIP on the VPS with `ATIP_DATABASE_URL=mysql://…`,
`ATIP_ROOT_PATH=/ATIP`, then reverse-proxy `/ATIP/` to it. The prefix-stripping
nginx block, the MySQL setup and the per-tier table are all in that document.

ATIP's own database is **MySQL** (`db/mysql.py`), one database per tier, never
shared — same rule as the portal and `edu`.

## Part 4: Other menu subdomains

The menu also links to `(test)ladwani`, `(test)asmymilk` and `(test)driving`.bkesari.com. Those apps aren't in this repo.
Each needs its own site in hPanel, or its card will lead to an error page. Edit `portal/public/sites.js` to change or remove any of them.

---

## Part 5: Ladwani (full rebuild — NestJS + Next.js)

The app behind `ladwani.bkesari.com` / `testladwani.bkesari.com` is the full rebuild: branch
**`rebuild`** of **github.com/sanjaymorankar-debug/Ladwani**. On the Mac that tree is at
`/Users/agtci/Documents/Project_Documents/Projects/community-platform`.

**The repository was renamed** — it used to be `miladwani`. One repository now holds both apps
on **unrelated histories** (`git merge-base main rebuild` finds no common ancestor), so this is a
branch choice, not a repository choice:

| Branch | App | Schema | Deploys to |
|---|---|---|---|
| `main` | the older single Next.js app | 53 Prisma models | `devmiladwani.agtci.com` |
| `rebuild` | NestJS API + Next.js web | **73** Prisma models | `(dev/test)ladwani.bkesari.com` |

Deploy from `rebuild`. The Sep 28 SQL export was mistakenly based on the older app, which is
what `main` now holds. The rebuild covers Family Registry, Matrimony, Community Social,
Bookings/Assets, Payments/Fees/Ledger and Admin/Reporting (M0–M6), vs. the older app's Family
Registry/Directory/Matrimony only.

**Database**: `database/ladwani/01_ladwani_schema.sql` (**73 tables, 108 foreign keys**),
`02_ladwani_reference_data.sql` and `03_ladwani_first_admin.sql` were regenerated on 2026-10-02
from `rebuild` at `516d3b9` ("M6: profile data model…") with the rebuild's own tooling
(`prisma migrate diff --from-empty --to-schema-datamodel`), and validated end-to-end against a
real MySQL server: fresh import of all three, a re-run of 02 and 03 to confirm idempotency, and a
round-trip insert proving the new foreign keys resolve. Import all three via phpMyAdmin, in
order, exactly like `edu`'s migrations.

> The previous export (2026-10-01, 69 tables) predated the **M6** commit and would have produced
> a database the app cannot run against. M6 added four tables *and* columns to tables that
> already existed, so the shortfall was not just the table count:
>
> - new tables: `education_levels`, `occupations`, `skills`, `member_skills`
> - new columns: `members.native_district`, `.native_state`, `.education_level_id`,
>   `.occupation_id`, `.employer_or_business`, `.income_range`, `.bio`;
>   `matrimonial_profiles.education_level_id`, `.occupation_id`, `.familyBackground`
> - 3 new indexes on `members`, 6 new foreign keys
>
> It also left `education_levels`, `occupations` and `skills` **empty**, so the profile and
> matrimony dropdowns they feed would have had nothing to show. `02_…` now seeds all three from
> the rebuild's `seed.ts` (8 education levels, 9 occupations, 7 skills).
>
> Regenerating was purely additive against that export — 76 lines added, 0 removed.

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
`/Users/agtci/Documents/Project_Documents/Projects/community-platform/docs/21-deployment-guide.md`, `22-backup-strategy.md`, and
`23-production-cutover-plan.md` — the cutover plan there was written against the old
`devmiladwani.agtci.com` target and needs its destructive-step section re-pointed at whichever
database actually needs replacing here (there is no pre-existing live Ladwani data on bkesari.com
to protect, since neither `ladwani.bkesari.com` nor `devmiladwani.agtci.com` currently resolve).

**Not yet done**: creating the two hPanel sites and their DNS records — this still needs manual
hPanel/SSH access this repo's automation doesn't have.
