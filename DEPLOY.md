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
| PostgreSQL database | its own | its own | its own (never share with dev/test) |

**Promoting a tier** (once its site is confirmed working):

```bash
git checkout staging && git merge dev && git push origin staging   # dev -> test
git checkout main && git merge staging && git push origin main     # test -> production
```

Each promotion is a fast-forward as long as all work happens on `dev` first — don't commit
directly to `staging` or `main`.

The repository is **private**. Hostinger's GitHub connection (step 1) asks for access to it,
and the SSH clone in part 2 needs a GitHub Personal Access Token or a deploy key.

### Databases: PostgreSQL on Neon

Every app on bkesari.com keeps its data in **PostgreSQL on Neon** (CI and local setup use a
throwaway PostgreSQL 16 instead, and never reach Neon). Hostinger's web hosting has no
PostgreSQL of its own, so the sites stay on Hostinger and connect out to Neon.

**[docs/NEON.md](docs/NEON.md)** is the one place for the rest: one Neon branch per tier
(`production` → bkesari.com, `test` → test.bkesari.com, `dev` → dev.bkesari.com), one database
and one owning role per project on each, the two connection strings every app takes
(`DATABASE_URL` pooled for the app, `DATABASE_URL_UNPOOLED` direct for schema changes), where in
the Neon console to copy them from, and the script that creates it all. Each tier's server `.env`
holds **only that tier's** strings.

Every `.sql` file in this repository is PostgreSQL and is run with `psql` (or any PostgreSQL
SQL console your provider offers), not phpMyAdmin:

```bash
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -1 -f FILE.sql     # the direct string, never the pooled one
```

`-1` runs the file as one transaction (PostgreSQL DDL is transactional, so a failure leaves
nothing half-applied); `ON_ERROR_STOP` stops at the first error instead of carrying on.

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

On Neon, the hub uses this tier's branch's default database `neondb`, as the login
`bk_portal_app` (docs/NEON.md creates the login). Before the first start, run the `neondb` block
of that tier's `.sql` file as `neondb_owner` (docs/NEON.md, step 3): it lets `bk_portal_app`
connect and create tables there; without it the app stops at once with `Failed to start:
permission denied for schema public` in the error log. The app then creates its tables on start from
`portal/sql/schema.sql`, over the direct connection. To create them beforehand, run that file
(or its copy, `database/portal/01_portal_schema.sql`) with `psql "$DATABASE_URL_UNPOOLED"`; it is
safe to re-run.

### 3. Environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon console → this tier's branch → **Connect** → database `neondb`, role `bk_portal_app`, *Connection pooling* **on**. Paste it whole: the `?sslmode=require&channel_binding=require` on the end is what turns TLS on |
| `DATABASE_URL_UNPOOLED` | the same, with *Connection pooling* **off**. Used only to create the tables |
| `TRACKER_USER`, `TRACKER_PASSWORD` | login for `/tasks/` |
| `ATIP_USER`, `ATIP_PASSWORD` | login for `/ATIP/` |
| `ATIP_PUBLISH_TOKEN` | long random secret. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Use a **different one per tier** (dev/test/production). |

`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` (and `DB_SSL=require` for TLS) still work
in place of `DATABASE_URL` for a database that is not on Neon; `.env.example` lists them.

Redeploy. Check (same checks for dev.bkesari.com and test.bkesari.com — add a **DEV** badge
alongside the existing **TEST** one in `portal/` if you want the two visually distinguishable):
- the site shows the menu
- `/tasks/` asks for a login
- `/ATIP/` asks for a login, then says *No dashboard snapshot has been published yet*
  (`/atip/` still resolves, for old bookmarks)

---

## Part 2: Education (Laravel, PHP)

Same pattern as the existing `edu/DEPLOYMENT.md`, except that the app now lives in the `edu/` folder of this repo.
Its database is `bk_edu`, owned by the login `bk_edu_app`, on the tier's Neon branch ([docs/NEON.md](docs/NEON.md)).
Laravel takes the two strings under its own names, `DB_URL` (pooled) and `DB_URL_UNPOOLED`
(direct). Schema changes go in with `php artisan migrate --force` (below), which runs over
`DB_URL_UNPOOLED` by itself. The hand-run alternative is `database/edu/*.sql`, run in order with
`psql "$DB_URL_UNPOOLED"` (see that folder's own notes); either way leaves the `migrations` table
populated, so the two can be mixed. `edu/DEPLOYMENT.md` says what the app does with each string.

The site's PHP needs the **`pdo_pgsql`** extension, built against **libpq 14 or newer** (Neon
needs SNI, and the strings carry `channel_binding=require`). Check over SSH with
`php -m | grep -i pgsql` and `php -i | grep -i libpq`; if either falls short, it has to be fixed
for the site before anything below will connect (this was not verified against Hostinger here).

Do this for **devedu.bkesari.com** / branch `dev` first. Once it checks out, repeat for
**testedu.bkesari.com** / branch `staging`, then **edu.bkesari.com** / branch `main`, with the
differences the steps call out.

1. hPanel → create the website/subdomain (e.g. **devedu.bkesari.com**) (PHP 8.3). The database
   and its role already exist on the tier's Neon branch once `tools/neon_provision.mjs` has run.
2. SSH in and clone:

```bash
cd ~/domains/devedu.bkesari.com
git clone -b dev https://github.com/sanjaymorankar-debug/bkesari-platform.git platform
cd platform/edu
composer install --no-dev --optimize-autoloader
cp .env.example .env
nano .env        # APP_URL=https://dev.bkesari.com/edu, APP_DEBUG=false, and from the Neon
                 # console (this tier's branch -> Connect -> database bk_edu, role bk_edu_app):
                 #   DB_CONNECTION=pgsql
                 #   DB_URL=<Connection pooling ON>
                 #   DB_URL_UNPOOLED=<Connection pooling OFF>
php artisan key:generate --force
php artisan migrate --force
```

   `APP_URL` is the address visitors use, the Education tab on the hub (Part 7), not this
   site's own hostname: `https://dev.bkesari.com/edu`, `https://test.bkesari.com/edu`,
   `https://bkesari.com/edu`. Its path is what makes every link, asset and sign-in post come
   back under `/edu/`. Only a site that is used directly, not through the hub, takes its own
   hostname here.

   `bk_edu` already exists on Neon with the migrations applied and no data, so `migrate`
   reports nothing to do there; the starting data is still needed. It differs by tier:

```bash
# dev and test: the demo dataset (edu/TEST_ACCOUNTS.md; every account shares ONE known password)
php artisan db:seed --force
# production: reference data only, then your own first administrator; NEVER db:seed here,
# it would create the demo System Admin with the published password
psql "$(grep '^DB_URL_UNPOOLED=' .env | cut -d= -f2-)" -v ON_ERROR_STOP=1 -1 -f ../database/edu/02_edu_reference_data.sql
#   first edit the name, email and password hash in ../database/edu/04_edu_first_admin.sql (its header says where)
psql "$(grep '^DB_URL_UNPOOLED=' .env | cut -d= -f2-)" -v ON_ERROR_STOP=1 -f ../database/edu/04_edu_first_admin.sql
php artisan permission:cache-reset
```

   No `psql` on the server? Paste the two files into the Neon console's **SQL Editor** instead,
   on the tier's branch and database `bk_edu`.

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

   The cached configuration is what the app reads from then on, `DB_URL` and `DB_URL_UNPOOLED`
   included: after any change to `.env`, run `php artisan config:cache` again before anything else.

4. Cron (hourly analytics), via `crontab -e`:

```
* * * * * cd ~/domains/devedu.bkesari.com/platform/edu && php artisan schedule:run >> /dev/null 2>&1
```

**Redeploy later:** `cd ~/domains/devedu.bkesari.com/platform && git pull`, then in `edu/` run
`composer install --no-dev --optimize-autoloader && php artisan migrate --force` (over
`DB_URL_UNPOOLED`, as above). Copy `public/.` again and re-run the three `cache` commands.

Repeat all of the above for **testedu.bkesari.com** (branch `staging`, Neon branch `test`) and
**edu.bkesari.com** (branch `main`, Neon branch `production`), substituting the domain, branch and
`APP_URL` throughout. Each site's `.env` holds only its own branch's strings.
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

In outline: run ATIP on the VPS with `ATIP_DATABASE_URL=postgresql://…`,
`ATIP_ROOT_PATH=/ATIP`, then reverse-proxy `/ATIP/` to it. The prefix-stripping
nginx block and the per-tier table are in that document; the PostgreSQL setup and
the config switch that opts ATIP's runtime in to it are in the ATIP repo's
`docs/POSTGRESQL_MIGRATION.md`.

ATIP's server database is **PostgreSQL**, one database per tier, never shared —
same rule as the portal and `edu`. A VPS that runs ATIP can host PostgreSQL for
the other apps too.

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
if the page marks a slot. Once the bar is in the page it needs **no JavaScript to
operate** — the mobile hamburger is a checkbox and its label, toggled purely
through CSS — so it survives a strict Content-Security-Policy, and a failed
script load degrades to a page without a bar rather than a broken one.

(A `<details>`/`<summary>` disclosure reads better and was tried first, but a
closed `<details>` does not render its non-summary children at all, so the tabs
were invisible on desktop and no CSS could reveal them. The checkbox is the one
disclosure whose open state CSS can reach. `tests/menu.test.js` asserts the
markup has not drifted back.)

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

How `/milk/`, `/edu/` and `/ladwani/` get served is Part 7.

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

**Database (PostgreSQL)**: `database/ladwani/01_ladwani_schema.sql` (**73 tables, 108 foreign
keys**), `02_ladwani_reference_data.sql` and `03_ladwani_first_admin.sql`. 01 was regenerated on
2026-10-09 from `rebuild` at `516d3b9` ("M6: profile data model…") with the rebuild's own tooling
(`prisma migrate diff --from-empty --to-schema-datamodel`), with the schema's datasource switched
from `provider = "mysql"` to `"postgresql"` and nothing else changed; 02 and 03 were converted by
hand (same rows). Validated against PostgreSQL 16: fresh load of all three, a re-run of 02 and 03
to confirm idempotency, the first-admin options run, and `prisma migrate diff` from the loaded
database to the schema reporting nothing to change. Load all three with `psql`, in order, as the
database's owner (*Databases* at the top).

> **The `rebuild` app moves to PostgreSQL in Ladwani#16** (2026-10-24): `provider = "postgresql"`,
> one PostgreSQL baseline migration generated from the same schema, case-insensitive searches and
> emails, and a booking transaction fixed for PostgreSQL. On a fresh `bk_ladwani`, its own
> `prisma migrate deploy` and seed replace these scripts (Ladwani `docs/27-dev-deploy.md`).

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

**Both sites check out the same repository on the `rebuild` branch** — point hPanel's Git
integration at `sanjaymorankar-debug/Ladwani`, branch `rebuild`, and set each site's app root to
`apps/web` or `apps/api`. Over SSH that is:

```bash
git clone -b rebuild https://github.com/sanjaymorankar-debug/Ladwani.git
```

**Do not omit `-b rebuild`.** The default branch is `main`, which is the *other*, older
application (see the branch table above) — it will clone and build happily and serve the wrong
app against a schema it does not match.

Full environment variable list, build commands, and the production cutover checklist are in
`/Users/agtci/Documents/Project_Documents/Projects/community-platform/docs/21-deployment-guide.md`, `22-backup-strategy.md`, and
`23-production-cutover-plan.md` — the cutover plan there was written against the old
`devmiladwani.agtci.com` target and needs its destructive-step section re-pointed at whichever
database actually needs replacing here (there is no pre-existing live Ladwani data on bkesari.com
to protect, since neither `ladwani.bkesari.com` nor `devmiladwani.agtci.com` currently resolve).

**Not yet done**: creating the two hPanel sites and their DNS records — this still needs manual
hPanel/SSH access this repo's automation doesn't have.

---

## Part 6: Dev deployment workflows (GitHub Actions)

Pushing to `dev` now deploys to dev, over SSH. **Nothing is automated for test or
production** — those stay the manual promotions at the top of this file, on
purpose: a mis-aimed deploy to production is the one mistake this stage cannot
afford.

| Repository | Workflow | Deploys | To |
|---|---|---|---|
| `bkesari-platform` | `deploy-dev-portal.yml` | `portal/` (the hub, Node) | `dev.bkesari.com` |
| `bkesari-platform` | `deploy-dev-edu.yml` | `edu/` (Laravel) | `devedu.bkesari.com` |
| `bkesari` | `deploy-dev.yml` | Milk & Dairy (Next.js) | `devmilk.bkesari.com` |
| `Ladwani` | `deploy-dev.yml` | LadWani (Next.js) | `devladwani.bkesari.com` |

**LadWani: that workflow deploys the wrong app.** It lives on the Ladwani
repository's `main` branch, which is the older single Next.js app. LadWani is
the **`rebuild`** branch (Part 5), which has no deploy workflow yet. It needs one
for its two processes (web and API, two Hostinger sites), plus a `dev` branch
cut from `rebuild`. Until then, do not push `main` to Ladwani's `dev`.

Each one: runs the repo's checks → builds → `rsync` over SSH → installs runtime
dependencies and restarts on the server → fetches the URL to confirm it answers.
The two `bkesari-platform` workflows are filtered by path, so a change under
`portal/` does not redeploy Laravel and vice versa. Every workflow also has a
**Run workflow** button for redeploying the current `dev` without an empty commit.

### What is never in GitHub

No database password, and no `.env`. Credentials live only in each server's own
`.env`, filled in by hand, and `rsync` is configured to neither upload nor delete
it. The same goes for `storage/` (edu's uploads and logs), `portal/data/` and
`uploads/`.

That has one visible consequence worth knowing about: for the two Next.js apps,
anything named `NEXT_PUBLIC_*` is baked into the bundle **at build time**, in CI,
so the server's `.env` is read too late to supply it. Nothing public is set in CI
at the moment, which means `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is empty on dev and
Milk & Dairy falls back to manual address entry — which is what its `.env.example`
already describes as the intended dev behaviour. If you want Maps working on dev,
add that one key as a repository **variable** (it is domain-restricted and public
by design) and pass it to the `Build` step. Never the server-side key.

### How "dev only" is enforced

`.github/deploy/guard.sh`, which every workflow runs before it holds an SSH
connection or a build. It refuses:

- any ref that is not `refs/heads/dev` — including a **Run workflow** aimed at
  `main` from the UI;
- any deploy path that is not an absolute path, inside a directory named exactly
  the dev hostname, with no `..` in it. `test.bkesari.com`, `bkesari.com`,
  `dev.bkesari.com.old` and `olddev.bkesari.com` all fail this;
- `gokesari.com` and `agtci.com` outright, which this project must not touch;
- a smoke-check URL pointing anywhere but the dev host;
- any missing or empty secret, rather than falling back to a default.

The dev hostname is **hard-coded in each workflow** (`DEV_SITE`), not read from a
secret, so a mistyped path secret fails the job instead of publishing to the wrong
tier. `.github/deploy/guard.test.sh` runs those rules against a table of about thirty
cases in CI — the ones that must *fail* are the point of it — so this is a tested
property rather than a comment.

### One-time setup, per repository

1. **A deploy key.** On your machine (or any shell), generate a key used for
   nothing else:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/bkesari_dev_deploy -C "github-actions dev deploy" -N ""
   ```

   Append the **public** half (`~/.ssh/bkesari_dev_deploy.pub`) to
   `~/.ssh/authorized_keys` on the Hostinger account — hPanel → Advanced → SSH
   Access → Manage SSH keys does this for you. Keep the private half; it goes
   into GitHub below and nowhere else.

2. **The host key**, so the workflow never has to trust whatever answers on that
   port. Hostinger's SSH port is 65002:

   ```bash
   ssh-keyscan -p 65002 <your-hostinger-host> 2>/dev/null
   ```

   Copy every line it prints.

3. **GitHub → the repo → Settings → Environments → New environment → `dev`.**
   Add these as **secrets** of that environment:

   | Secret | Value |
   |---|---|
   | `DEV_SSH_HOST` | the Hostinger server's hostname or IP |
   | `DEV_SSH_USER` | your SSH user, e.g. `u879099820` |
   | `DEV_SSH_PORT` | `65002` (omit to use that default) |
   | `DEV_SSH_KEY` | the **private** key from step 1, whole file |
   | `DEV_SSH_KNOWN_HOSTS` | the output of step 2 |

   And the deploy path, which differs per app — these are what the guard checks:

   | Repository | Secret | Example |
   |---|---|---|
   | `bkesari-platform` | `DEV_PORTAL_PATH` | `/home/u879099820/domains/dev.bkesari.com/app` |
   | `bkesari-platform` | `DEV_EDU_PATH` | `/home/u879099820/domains/devedu.bkesari.com/app` |
   | `bkesari` | `DEV_DEPLOY_PATH` | `/home/u879099820/domains/devmilk.bkesari.com/app` |
   | `Ladwani` | `DEV_DEPLOY_PATH` | `/home/u879099820/domains/devladwani.bkesari.com/app` |

4. **Optional repository variables** (Settings → Secrets and variables → Actions
   → Variables — *not* secrets, these are not sensitive):

   | Variable | Effect if unset |
   |---|---|
   | `DEV_PORTAL_URL` / `DEV_EDU_URL` / `DEV_SMOKE_URL` | the smoke check is skipped |
   | `DEV_RESTART_COMMAND` | `mkdir -p tmp && touch tmp/restart.txt`, which is how Hostinger's Passenger-backed Node sites reload |
   | `DEV_EDU_DOCROOT` | edu's `public/` is not copied into the document root; do it by hand as in Part 2 step 3 |

5. **Create the `dev` branch** if the repo has none, and push to it.

### Migrations are not applied automatically

By design: a deploy ships code and never alters a database. Each deploy's
summary lists any migration files the push brought, with a warning, so you can
apply them yourself — over SSH with `php artisan migrate --force` (edu),
`npm run db:migrate` (Milk & Dairy) or `npx prisma migrate deploy` (LadWani), or
with `psql` and the hand-run scripts under `database/`.

### Repositories that deliberately have no deploy workflow

| Repository | Why |
|---|---|
| `GoKesari` | gokesari.com is a separate site and is explicitly out of scope — not to be touched for this work, and not one of the seven tabs. |
| `edu` (standalone) | Superseded by `bkesari-platform/edu`, which is ahead of it. It still serves edutest.agtci.com from its own repo until you retire it. |
| `agtci` | A bare `create-next-app` scaffold for a different domain; not a hub tab. |
| `ATIP-DEV` | Runs on your PC and *pushes* snapshots to the hub (Part 3). The hub serves the viewer, so there is nothing to deploy to Hostinger. |

### After a deploy: testing it

`TESTING.md` is the checklist — what CI already proves (so you don't re-test it
by hand), the tier-safety checks that need hPanel or SSH, and the manual browser
checks. The mechanical part is a script:

```bash
bash scripts/smoke-dev.sh https://dev.bkesari.com --env dev
```

It needs only `curl` and the URL. The dev deploy runs it automatically and puts
its output in the workflow summary, so a deploy that leaves the task tracker
open to the internet, or points a tier at the wrong database, fails rather than
reporting success.

### What still has to happen before any of this can run

None of it is verified against a real server, because none of the dev sites
exists yet. In order:

1. Create the hPanel sites and DNS records: `dev.bkesari.com`,
   `devedu.bkesari.com`, `devmilk.bkesari.com`, `devladwani.bkesari.com`.
2. Create each project's dev database and fill in that site's `.env`.
3. Do the one-time setup above in each repository.
4. Push to `dev` and read the workflow's summary.

One design question is still open and is not a deployment detail. The menu's tabs
are **paths** (`/milk/`, `/edu/`, `/ladwani/`), but each app above is its own
Hostinger site on its own subdomain. Serving them under the hub's paths needs
either the hub proxying those paths to each app, or each app being given a
`basePath` — neither is built, and until one is, those three tabs will keep
answering with the "not on this tier yet" page. The hub is a Node process, so
proxying from it is the more likely answer, but it is a change to the hub and to
each app's config rather than to these workflows.

---

## Part 7: Serving a project under one of the hub's paths

The menu's tabs are **paths** — `/milk/`, `/edu/`, `/ladwani/` — but each of
those projects is its own application on its own Hostinger site. The hub closes
that gap: it forwards those paths to the app behind them, so one origin serves
the whole estate and the same link is right on dev, test and production.

### Turn it on for Milk & Dairy

Two settings, one on each side.

**1. On the hub** (dev.bkesari.com → Node.js Web App → Environment variables):

| Variable | Value |
|---|---|
| `MILK_ORIGIN` | the Milk & Dairy site's own origin, e.g. `https://devmilk.bkesari.com` |

That is all. Restart, and `/milk/` stops showing the placeholder and starts
serving the app. The startup log prints `/milk/ -> https://devmilk.bkesari.com`
so you can see it took.

**2. On the Milk & Dairy app** (devmilk.bkesari.com → Environment variables):

| Variable | Value |
|---|---|
| `BASE_PATH` | `/milk` |

`BASE_PATH` has to be set in **two** places, and missing either one is the
mistake worth warning about:

- in the **build**, which `bkesari`'s deploy workflow already does, because
  Next inlines the value into its client bundles;
- in the **server's `.env`**, as above, because `next start` reads the config
  again to decide how to route.

A build made with it but started without it serves the app at its root while
every asset URL in the HTML points at `/milk/...`, so every page arrives as
unstyled markup with broken navigation — and the HTTP status is still 200, so
nothing looks wrong until you open it. `scripts/smoke-dev.sh` reports this case
by name.

The same two settings, for the other two projects, are `EDU_ORIGIN` and
`LADWANI_ORIGIN`. Each tab is independent: an origin that is not set leaves
that tab on its placeholder, so you can bring them up one at a time.

### Two ways to live under a prefix

There are two arrangements, and which one a tab uses is a fact about the
framework behind it, not about the tier. `portal/proxy.js` marks the difference
with `strip` on the tab, and `tests/proxy.test.js` pins it.

**Next.js keeps the prefix** (`/milk/`, `/ladwani/`). The hub forwards
`/milk/orders` as `/milk/orders` and the app serves itself there, via
`basePath`:

- strip it, and the app answers as if it were at the root, so its pages come
  back with asset URLs like `/_next/static/...`, which the hub does not serve —
  every page would load as unstyled HTML with broken navigation;
- strip it for several apps and they collide, all wanting `/_next`, `/build`,
  `/storage` at the root of the same origin.

**Laravel has the prefix stripped** (`/edu/`). It cannot own one, because the
two halves of the job pull in opposite directions:

- Laravel matches routes against the request path, so a prefix it does not know
  about is a 404 on *every* page. Prefixing all 60-odd route definitions would
  fix that half.
- But `public/` is served by the web server at the site's own root, so
  `/edu/build/app.js` has nowhere to come from. Prefixing the routes does not
  help: the web server never consults Laravel for a file that exists.

So the prefix comes off at the hub, the app answers at its root, and it puts
the prefix back on in its *output* instead — one call to `URL::forceRootUrl()`
rooted on `APP_URL`. See the Laravel section below, because the rest of that
story is not obvious.

### What each project still needs

| Project | Hub side | App side |
|---|---|---|
| **Milk & Dairy** | `MILK_ORIGIN` | ✅ built for it — `BASE_PATH=/milk` in its deploy build; set it in that site's `.env` too |
| **LadWani** | `LADWANI_ORIGIN` | ✅ built for it — `BASE_PATH=/ladwani` in its deploy build; set it in that site's `.env` too |
| **Education** | `EDU_ORIGIN` | ✅ built for it — set `APP_URL=https://dev.bkesari.com/edu` in that site's `.env`; nothing else, and no change to its document root |

Education needs no deploy-time flag: the path in `APP_URL` is the whole switch,
read at boot. Leave the path off and the app behaves exactly as it did before,
which is how its test suite and `artisan serve` keep working.

### `basePath` is not the whole job for an app that calls its own API

Worth knowing before wiring up a third project, because it is not obvious and
costs a day if you find it in production. Next's `basePath` covers `next/link`,
`useRouter` and asset URLs. It does **not** rewrite `fetch()`, because the
argument is an ordinary runtime string the compiler never looks inside.

Milk & Dairy happened to have no absolute `fetch('/api/...')` calls, so
`basePath` really was the whole change there. LadWani had **100 of them across
42 files**, every one of which would have called the hub's root instead of the
app — returning the hub's own 404 page while the app's pages looked perfectly
fine. They now read `` `${BASE_PATH}/api/...` ``, and
`Ladwani/scripts/check-base-path.sh` fails the build if a bare one is added
back, because nothing else catches it.

The same applies to anything else that builds a URL the browser will use and
that Next does not own: NextAuth's `SessionProvider basePath`, a `signOut`
`callbackUrl` (NextAuth navigates the browser itself), and a server route that
returns a URL in its JSON. What is NOT affected: `router.push`, `<Link href>`,
and middleware's `pathname` comparisons — Next strips the prefix before
middleware runs, and adds it back to a middleware redirect.

### `APP_URL` is not the whole job for Laravel either

The same shape of trap as the Next.js one above, and worth reading before
anyone touches the Education app's URLs. `AppServiceProvider::serveUnderBasePath()`
is where all of this lives, and `edu/tests/Feature/Platform/BasePathTest.php`
holds it in place.

Laravel does **not** build web URLs from `APP_URL`. During a request the URL
generator uses the *request* root (`UrlGenerator::formatRoot()` →
`$this->request->root()`), so setting `APP_URL` alone changes nothing a visitor
sees. Pinning it with `URL::forceRootUrl($appUrl)` is what does the work, and
that single call covers more than you would expect:

- all 192 `route()` calls, the 25 `redirect()`s, `url()`, `asset()` and `@vite`;
- **relative** route URLs too (`route('x', absolute: false)`), because the
  prefix is in the root that gets stripped off them, and the stripping of the
  request's own base path is a no-op here — the hub already removed it;
- Livewire's AJAX endpoint with them, which matters more than it sounds: the
  sign-in form has no `action` of its own and posts to `data-update-uri`.

Four things it does not cover, each of which was a real failure found by
driving the live site in a browser rather than by reading the code:

| What | Why it escapes | Fix |
|---|---|---|
| `URL::forceScheme()` | `formatRoot()` rewrites the forced root's scheme with the *request's*, and the hub forwards over plain HTTP — so every `https://` link came back `http://` | forced when `APP_URL` is https |
| Livewire's `<script src>` | taken from the raw route path, never passing through the URL generator, so it asked the hub for `/livewire/livewire.min.js` — a 404, leaving the page with no Livewire and therefore no sign-in form at all | `livewire.asset_url`, derived from the route Livewire registered, because the file is `livewire.js` with debug on and `livewire.min.js` with it off |
| The remembered page after signing in | `redirect()->guest()` stores `UrlGenerator::full()`, which reads the URL straight off the request — prefix already stripped. Signing in landed the visitor on `Cannot GET /admin/rating-weights` at the hub | `App\Routing\BasePathRedirector` |
| A literal path in a view | the generator never sees it. Three did this: `href="/"` in the guest layout and `redirect('/')` in logout, delete-account and verify-email — all three left the tab for the hub | `url('/')` / `route('home')`, and a test that greps every Blade file so a new one fails the suite |

Two more things to know:

- **Signed URLs do not survive the trip by themselves.** `hasValidSignature()`
  rebuilds the URL from the request, which arrives without the prefix, so a
  signature made with it can never match. Livewire signs every file upload, so
  until `App\Routing\BasePathSignedUploadUrl` no upload worked under `/edu/`
  (complaint evidence included); it signs the stripped path and prefixes the
  URL once. The app signs nothing else today (`MustVerifyEmail` is off on the
  `User` model), but email verification links will need the same treatment.
- **Outside a request the rule inverts.** In a queued job or scheduled command
  Laravel invents a stand-in request from `APP_URL`, so its base path *is*
  `/edu` and `route(..., absolute: false)` comes back **without** the prefix —
  the opposite of a real request. Absolute URLs are correct in both, which is
  what mail and notifications use.

And one consequence for anyone running the suite: `edu/phpunit.xml` pins
`APP_URL` to a bare origin. It has to. The test client builds its request URLs
with `url()`, so with a path in `APP_URL` every `$this->get('/login')` asks for
`/edu/login` — which no route matches, because in production the hub strips the
prefix and in a test there is no hub. Unpinned, 206 of the 375 tests failed
purely on a developer's local `.env`.

### If a project stops answering

The hub does not take the rest of the estate down with it:

- **Connection refused** (the app is stopped): a 502 page that still carries
  the menu, so the other tabs stay reachable.
- **Too slow** (30 seconds, `timeoutMs` in `portal/proxy.js`): the connection
  is dropped and the browser shows its own error. Nothing can be rendered at
  that point — the request is already in flight.

Either way the hub itself, `/tasks/`, `/atip/` and the static pages keep
working. The hub's log names the tab and the target for every proxy error.

### Guardrails

An origin is read from the environment only, never from a request, so the hub
cannot be turned into an open proxy. Each value must be a bare `http://` or
`https://` origin: a path, a query, a fragment or embedded credentials are
refused with a message naming the variable, and that tab stays on its
placeholder rather than the hub failing to start. `tests/proxy.test.js` covers
those rules along with the forwarding itself.

---

## Part 8: Neon (Postgres, Auth, Realtime, Functions, Object Storage)

The portal runs on Neon project **`bkesari-hub`** (`aged-snow-54676890`, org
`org-calm-cell-54818057`, region `aws-ap-southeast-1`, Singapore, near
Hostinger and the users), with the services declared in **`neon.ts`**.
Neon Auth, the `assets` bucket and the `report` function are deployed on its
`dev` branch (2026-10-24). Deploy them to `test` and `production` the same way:
`neon deploy --project-id aged-snow-54676890 --branch <tier> --env .env.local`.
Neon Auth reaches `neondb` as its own `neon_auth` role.
Every Neon service is optional: each turns on only when its variables are
present, so a site configured as in Parts 1–7 behaves exactly as before.

### Databases

The databases, their logins and the per-tier isolation SQL are in
**docs/NEON.md**: `neondb` for the portal (also home to Neon Auth's
`neon_auth` schema), then `bk_edu`, `bk_ladwani`, `bk_milk`, `bk_atip`,
`bk_agtci`, each owned by its own `bk_*_app` login. `bk_env` (Environment
Activities, no app yet) is added the same way.

ATIP needs none: it keeps its own database on the Mac and pushes a page into
`neondb`'s `atip_snapshots`. The Driving Simulator is a static page.

**One branch per tier.** Everything above is on one branch, `production`. The
rule at the top of this file still applies: dev, test and production must
never share a database. Give each tier its own branch (`neon checkout dev
--create`, then `neon deploy --env .env.local`), which copies `neon.ts`'s
services onto it with its own credentials.

### Set up, or redeploy

```bash
npm i -g neon
neon login                      # once; a browser sign-in
echo "ORIGIN_SECRET=$(openssl rand -hex 32)" >> .env.local
echo "NEON_AUTH_COOKIE_SECRET=$(openssl rand -base64 32)" >> .env.local
neon deploy --env .env.local    # provisions neon.ts, pulls its variables into .env.local
node --env-file=.env.local portal/server.js
```

On a host, copy the variables from `.env.local` into the host's environment
(hPanel → Environment variables), plus `TRACKER_ALLOWED_EMAILS`.

### What each service does in the portal

| Service | Where | Variables |
|---|---|---|
| Postgres | `portal/db.js` on `pg`. Tables created over `DATABASE_URL_UNPOOLED`, queries over the pooled `DATABASE_URL` (docs/NEON.md). | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` |
| Auth | `portal/neon-auth.js`: sign-in at `/auth/sign-in`, `/api/auth/*` proxied to Neon Auth so its cookies are first-party. Replaces the Basic login on `/tasks/`. Lets in only **verified** accounts on `TRACKER_ALLOWED_EMAILS`; anyone can create an account, so a session alone proves nothing. Email + password only. | `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `TRACKER_ALLOWED_EMAILS` |
| Realtime | **Off on `bkesari-hub`**: it needs PostgreSQL 18, and the project runs 16 (see `neon.ts`). The tracker works without it. When on, `portal/realtime.js` seals one live query; `portal/client/live.js` (bundled by `npm run build` into `portal/public/tasks/live.js`, committed) subscribes. The dashboard updates when anyone changes a project or task. | `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET` |
| Functions | `functions/report.ts`, slug `report`: last-seven-days figures, computed next to the data. Called only by the portal (`/tasks/api/report`) with `X-Secret`; answers 401 to anyone else. | `NEON_FUNCTION_REPORT_BASE_URL`, `ORIGIN_SECRET` |
| Object Storage | `portal/storage.js` (AWS S3 client, path-style): every ATIP snapshot upload is also archived to bucket `assets` (`atip-snapshots/<date>/<time>.html`); `/ATIP/api/archive` lists them with one-hour links. | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION` |
| AI Gateway | **Not enabled.** Neon refuses to deploy it on the Free plan. Upgrade, uncomment `aiGateway: true` in `neon.ts`, and `neon deploy --env .env.local`. | — |

### Before pointing dev.bkesari.com at it

- **Trusted domain for sign-in:** `neon neon-auth domain add https://dev.bkesari.com`
  (localhost is trusted by default). Realtime is off on `bkesari-hub`; its
  allowed origins, commented out in `neon.ts`, include `https://dev.bkesari.com`
  for when it is turned back on.
- **Production email:** sign-up codes go out from Neon's shared sender. Neon
  asks for your own SMTP before production use (Neon Auth production checklist).
- **Outbound Postgres from Hostinger:** the portal connects to Neon on port
  5432. Confirm the Hostinger plan allows outbound connections to it.
- `scripts/smoke-dev.sh` understands both logins: under Neon Auth a redirect to
  the sign-in page counts as "login required", and the API must answer 401.

### How it was verified

Against the real branch, through a browser (Playwright), 17 checks: the
portal creates its tables in Neon; `/tasks/` redirects to sign-in and its API
answers 401 without a session; sign-up works and an unverified account is
held at the verify step; sending the verification code is accepted; a
verified, allowed account reaches the dashboard; rows written through the API
are in Neon; the dashboard goes "Live" and shows a task created in another
session without reloading; the report function answers through the portal and
its count rises after a posted update, also live; an ATIP upload is archived
to the bucket, listed, and downloads byte-for-byte; a verified account not on
the list gets 403; sign-out ends the session. The emailed code itself was not
read (no mailbox access); the test account was marked verified directly.
