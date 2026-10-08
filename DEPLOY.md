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

By design, and consistent with the rest of this file preferring phpMyAdmin for
schema changes: a deploy ships code and never alters a database. Each deploy's
summary lists any migration files the push brought, with a warning, so you can
apply them yourself — through phpMyAdmin, or over SSH with `npm run db:migrate`
(Milk & Dairy) or `npx prisma migrate deploy` (LadWani).

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

### Why the app has to own the prefix

The hub forwards `/milk/orders` as `/milk/orders`. It does **not** strip the
prefix, and that is the whole design:

- Strip it, and the app answers as if it were at the root, so its pages come
  back with asset URLs like `/_next/static/...`. The hub does not serve those,
  so every page would load as unstyled HTML with broken navigation.
- Strip it for all three, and they collide: three apps all wanting `/_next`,
  `/build`, `/storage` at the root of the same origin.

Making the app serve itself under its own prefix is the only arrangement where
its own links, assets, redirects and cookies come out right. For Next.js that
is `basePath`; for Laravel it is the path in `APP_URL`.

### What each project still needs

| Project | Hub side | App side |
|---|---|---|
| **Milk & Dairy** | `MILK_ORIGIN` | ✅ built for it — `BASE_PATH=/milk` in its deploy build; set it in that site's `.env` too |
| **LadWani** | `LADWANI_ORIGIN` | needs `basePath: '/ladwani'` in `next.config.js`, the same one-line change |
| **Education** | `EDU_ORIGIN` | needs `APP_URL=https://dev.bkesari.com/edu` and its document root reachable under that path; Laravel builds asset URLs from `APP_URL`, and `public/build` would need to resolve under `/edu` too |

Education is the awkward one, because its assets are served by Apache from a
document root rather than by the app itself. Until that is sorted, `/edu/` is
better left on its placeholder with the Education site reachable at its own
hostname.

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
