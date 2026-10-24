# Testing and smoke-testing a tier

What to run, and in what order, before you believe a tier works. Written for
**dev**, because dev is the only tier that exists at this stage, but the order
is the same for test and production later.

The short version:

```bash
# 1. Let CI do the unit and integration tests (it already does, on every push)
# 2. Then, against the deployed site:
bash scripts/smoke-dev.sh https://dev.bkesari.com --env dev
# 3. Then the manual checks in section 4 — the ones a script cannot see
```

---

## 1. What CI already proves — don't re-test it by hand

Every push and pull request runs these. If CI is green, the whole of this table
is already established and your time is better spent on sections 2 and 4.

| Repository | What runs | Covers |
|---|---|---|
| `bkesari-platform` | `ci.yml` | the server, proxy and shared menu parse; **19 menu unit tests**; **26 proxy tests**, including a real proxy against a real upstream; **3 tests of the assembled server** (the Task Tracker's login however a path is spelled, no stack trace for a malformed body, the proxy mounted before the body parsers); **15 Task Tracker / ATIP-snapshot / database tests against a real PostgreSQL 16** (every DB-backed route, the app creating its own tables, over `DATABASE_URL_UNPOOLED` when set, bad input answered 400/404 rather than 500, connections dropped by the server survived); **5 tests of the connection settings** a Neon URL produces; **12 tests of the Neon provisioning tool** against a stand-in for Neon's API (including the SQL that shuts other logins out of each database, and never taking over a database someone else owns); 2 checks that the portal schema and its `database/` copy agree; **32 deploy-guard cases**; a skipped test fails the job; the hub boots on PostgreSQL with `DATABASE_URL` and `DATABASE_URL_UNPOOLED` and passes the full smoke test; correct logins are accepted and wrong ones rejected. What CI cannot show (PgBouncer, TLS, dropped connections end to end) is `TEST_SPEC.md`'s Neon parity level |
| `bkesari` (Milk & Dairy) | `ci.yml` | migrations apply to a real database server; typecheck; eslint; **281 unit and integration tests**; a production build; the deploy-guard cases. *That repository is moving from MySQL 8 to PostgreSQL on its own branch; its `ci.yml` says which it runs.* |
| `Ladwani` | `ci.yml` | migrations apply to a real database server; reference and UAT data seed; typecheck; `prisma validate`; the test suite; a production build; the deploy-guard cases. *Moving from MySQL 8 to PostgreSQL on its own branch, as above.* |
| `bkesari-platform/edu` | `ci.yml` (`edu` job) | **423 PHPUnit tests** **three times**: on in-memory sqlite (418 pass; the 5 that need a PostgreSQL server skip), on a real **PostgreSQL 16** (all 423, 1,241 assertions), and through **PgBouncer in transaction mode with TLS**, as a role that is not a superuser (all 423): the way `DB_URL` reaches Neon on every tier. They include 13 covering the app served under the hub's `/edu/` path (Livewire's signed upload URL among them) and 18 covering the Neon settings (`DB_URL` for the app, `DB_URL_UNPOOLED` for `migrate` and the other schema commands, `channel_binding` passed on, no named prepared statements, no session `SET`, and a suite that refuses to run against a hosted database); every migration and seeder from empty on PostgreSQL; `composer validate`; the Vite manifest matches the files on disk. What CI cannot show (dropped connections, concurrent complaint numbers, the app behind the hub in a browser) is `edu/TEST_SPEC.md`'s S5 and S7 |

Each project's **deploy** workflow re-runs its own suite before it publishes, so
a build that reaches dev is one that passed. Nothing is deployed on a red build.

**What CI does not prove**, and so what the rest of this file is for: that the
server's `.env` is correct, that the tier is talking to the right database, that
the site is reachable, and that it looks right in a browser.

### Running a suite yourself

```bash
# bkesari-platform (the hub). The PostgreSQL tests need a database they may
# WIPE; without TEST_DATABASE_URL they are skipped (and say so).
# tools/setup_local_postgres.sh creates one (bk_portal_test) and writes its URL into .env:
grep '^TEST_DATABASE_URL=' .env > .env.test
npm ci && npm run test:pg && npm run check      # everything, nothing skipped
# ... or name it yourself:
TEST_DATABASE_URL='postgresql://bk_portal:pw@127.0.0.1:5432/bk_portal_test' npm test
# The full standard and regression suites, the smoke run and the Neon parity
# checks are TEST_SPEC.md.

# bkesari (Milk & Dairy) — needs a database you don't mind being wiped; that
# repository's README and ci.yml give the exact URL form for its current engine
DATABASE_URL='postgresql://bk_milk:pw@127.0.0.1:5432/bk_milk_test' \
TEST_DATABASE_URL='postgresql://bk_milk:pw@127.0.0.1:5432/bk_milk_test' \
AUTH_SECRET=local CRON_SECRET=local \
  npm ci && npm run db:migrate && npm test

# Ladwani — the suite reads .env.test; ci.yml shows exactly what to put in it
npm ci && npm run test:migrate && npm test

# edu (Laravel) — in-memory sqlite by default, no database needed, ~25 seconds
cd edu && composer install
cp .env.example .env && php artisan key:generate --force   # APP_KEY, first time only
php artisan test
# ... and on PostgreSQL, as CI does (environment variables beat phpunit.xml's
# sqlite defaults). Use a database the suite may wipe, e.g. bk_edu_test:
DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=bk_edu_test \
DB_USERNAME=bk_edu DB_PASSWORD=pw php artisan test
# ... or through a PgBouncer in transaction mode, the way Neon's pooled endpoint
# serves every tier (DB_URL wins over the DB_* lines):
DB_CONNECTION=pgsql DB_URL='postgresql://bk_edu:pw@127.0.0.1:6432/bk_edu_test?sslmode=require' \
php artisan test
# The full standard and regression suites, the smoke run and the Neon parity
# checks are edu/TEST_SPEC.md.
```

> **Never point a test suite at a dev, test or production database.** Several of
> these truncate every table before they run.

---

## 2. Tier safety — check these before anything else

These are the rules that cost the most to get wrong, and the only ones no
automated check in this repo can make for you: they need hPanel or SSH.

### 2.1 This tier talks only to its own database

The brief's hard rule: *an environment must never connect to another
environment's database, and a project connects only to its own.* Every database
is on Neon: one branch per tier, one database and one owning role per project.
**[docs/NEON.md](docs/NEON.md), *Layout*, is the table of names** — this file
does not repeat it. Open each site's `.env` on the server and read the host and
database in its connection strings (`DATABASE_URL` / `DATABASE_URL_UNPOOLED`;
`DB_URL` / `DB_URL_UNPOOLED` for edu).

- [ ] Every string on a dev site points at the Neon **`dev` branch** (console →
      the `dev` branch → Connect shows its hosts; the pooled one has `-pooler`
      in it, the direct one does not, and otherwise they match).
- [ ] No dev `.env` holds a `test` or `production` branch host, and none names
      another project's database or role (`neondb` / `bk_portal_app` for the hub).
- [ ] The pooled and the direct string on one site name the same endpoint and
      the same database: a pair copied from two branches would create the
      tables on one tier and use them on another.

A quick way to see all of them at once over SSH:

```bash
grep -HE '^(DATABASE_URL|DATABASE_URL_UNPOOLED|DB_URL|DB_URL_UNPOOLED)=' ~/domains/dev*.bkesari.com/*/.env | sed -E 's#(://[^:]+:)[^@]+@#\1***@#'
```

### 2.2 The tier knows which tier it is

The tier decides nothing less than which database the app opens, so a site that
has resolved the wrong tier is the same class of fault as 2.1. The smoke test in
section 3 checks this automatically — it reads the tier the hub reports about
itself and fails if it is not the one you asked for.

- [ ] `APP_ENV=dev` in each dev `.env`, or the hostname starts with `dev.`.
- [ ] The smoke test's **Tier identity** group passes.

### 2.3 No secret is in Git, and none is in GitHub

- [ ] `git log --all --name-only | grep -E '(^|/)\.env$'` finds nothing in any repo.
- [ ] Each repo's `.gitignore` covers `.env`, and `.env.example` holds only blanks.
- [ ] The only secrets in GitHub are the SSH ones listed in `DEPLOY.md` Part 6.
      **No database password belongs there** — credentials live on the server.
      (The `ci-only-not-a-real-password` in the workflows belongs to CI's own
      throwaway PostgreSQL container, which exists only for the length of a run.)
- [ ] The smoke test's **Nothing private is served** group passes (it tries to
      fetch `/.env` and `/.git/config` over HTTPS).

### 2.4 You can get back

- [ ] A database dump exists from *before* today's deploy
      (`pg_dump -Fc -f before.dump "$DATABASE_URL_UNPOOLED"` — the direct
      string: pg_dump keeps session state, which the pooled one drops — or a
      Neon restore point, docs/NEON.md), and you know the restore command
      (`pg_restore --clean --if-exists -d "$DATABASE_URL_UNPOOLED" before.dump`).
- [ ] You have tried the restore at least once. An untested backup is a
      hypothesis, not a backup.

---

## 3. The automated smoke test

```bash
bash scripts/smoke-dev.sh https://dev.bkesari.com --env dev
```

Needs only `curl` and the URL — no SSH, no credentials — so it runs from a
laptop, from CI, or from the deploy workflow, which runs it on every dev deploy
and puts the output in the run summary.

It checks: the hub and both static pages are served; the shared menu is included
on each and served as JavaScript; `/tasks/`, `/atip/` and the ATIP upload
endpoint are **not** open; the site reports the tier you asked for; non-production
tiers are not indexable; `/.env`, `/.git/config` and the server source are not
reachable; and each project tab either answers or shows the placeholder.

**Warnings are not failures.** They mark things that are safe but unfinished — a
project not deployed yet, or ATIP without its login set. Failures are reasons not
to promote the tier.

### What the serious failures mean

| Failure | What to do |
|---|---|
| **THE TASK TRACKER IS OPEN TO THE INTERNET** | Anyone can read and edit the tracker. `/tasks/` fails *open* when its credentials are unset — deliberate, for a laptop; catastrophic on a public host. Set `TRACKER_USER` and `TRACKER_PASSWORD`, redeploy, re-run. Fix this before anything else. |
| **THE ATIP UPLOAD ENDPOINT ACCEPTED AN UNAUTHENTICATED POST** | Anyone could replace the published dashboard. Set `ATIP_PUBLISH_TOKEN` to a fresh random value — a **different one per tier**. |
| **the site does not report itself as 'dev'** | The app resolved the wrong tier, so it may be opening the wrong database. Check `APP_ENV` and go back to section 2.1 before using the site. |
| **`/.env` is publicly readable** | The document root is pointed at the application directory instead of its `public` folder. Stop and fix the site's root. |
| **this tier is indexable** | Non-production content will show up in search results. The hub sets `noindex` on every non-prod response; if it is missing, the tier is being resolved as production — same problem as above. |
| **is not answering at all** | The site, DNS, or the Node app is down. Nothing else was checked. |

---

## 4. Manual checks — what a script cannot see

Do these in a real browser. The script proves the bytes arrive; only a browser
shows whether the page works.

### 4.1 The shared menu, on every page

The brief requires the bar on **every page of every project**, so check it on
more than the welcome page.

- [ ] All **seven tabs** appear, in order: Milk & Dairy Products · Education ·
      Global Warming · LadWani · TaskList · ATIP · Driving Simulator.
- [ ] The **current tab is highlighted** on each page you visit — not just the
      welcome page.
- [ ] The **brand** on the left returns you to the welcome page.
- [ ] A **dev** badge sits next to the brand. (It must *not* appear on production.)
- [ ] At **phone width** (≈390px) the tabs collapse into a hamburger, it opens
      and closes, every tab is reachable, and no page scrolls sideways.
- [ ] At desktop width the full row shows and the hamburger is hidden.
- [ ] In **dark mode** the bar and the stat tiles stay legible.
- [ ] With **JavaScript disabled**: the welcome page still lists every project
      (its `<noscript>` block), and `/atip/` still shows the bar, because that
      page is rendered on the server.

### 4.2 Each tab

- [ ] **`/`** — the welcome page shows a card per project and every card links
      where it says.
- [ ] **`/global-warming/`** — reads correctly; every figure still shows its
      source and year. *Check the figures against their sources before this
      tier is ever public: they are not live readings.*
- [ ] **`/driving-simulator/`** — reads correctly, and the dashed
      "still to be filled in" panel is still obviously a placeholder.
- [ ] **`/tasks/`** — the login is accepted; you can create a project and a task,
      edit one, add a comment, and see them again after a reload. (That last part
      is what proves the database is actually connected.)
- [ ] **`/atip/`** — the login is accepted, and you see either a dashboard or
      *"No dashboard snapshot has been published yet."* Confirm the page is
      **view-only**: no order buttons, no broker banner.
- [ ] **`/milk/`, `/edu/`, `/ladwani/`** — each either works or shows the
      "not on this tier yet" page **with the menu still usable**. A bare 404 or a
      server error is a fault.
- [ ] For a tab with an origin set (`MILK_ORIGIN` and friends, `DEPLOY.md`
      Part 7), check the **app's own assets load**: open it and confirm the page
      is styled and its links work, not just that it returns HTML. A page served
      with the prefix stripped comes back as unstyled markup, which a status
      code cannot tell you.
- [ ] Stop a proxied app and reload its tab: you should get a **502 that still
      shows the menu**, not a dead end.
- [ ] **`/edu/` specifically**, because it is the one tab whose prefix is
      stripped at the hub and put back by the app, so it fails in ways a status
      code hides. With the page open, view source and check that **every** URL
      in it starts with `/edu` or `https://<host>/edu` — in particular
      `data-update-uri="/edu/livewire/update"` and the `livewire.min.js`
      `src`. Then **sign in**: the form posts over that one URI and has no
      `action` of its own, so if the prefix is missing nothing happens at all.
      Then **sign out**, and confirm you land back inside `/edu/` rather than on
      the hub's home page.
- [ ] **`/edu/` once more, arriving from a protected page**: open
      `/edu/admin/rating-weights` while signed out, sign in when redirected, and
      confirm you land on **that** page and not on the hub. Laravel remembers
      the page from the incoming request, which no longer carries the prefix.

### 4.3 Each deployed app

For whichever of the three are actually deployed:

- [ ] Sign in, and sign out.
- [ ] Do one write, reload, and confirm it persisted.
- [ ] Check one page that reads a list, so you know queries run, not just the
      home page.
- [ ] Confirm nothing in the UI shows a connection string, a stack trace, or a
      credential.

---

## 5. Don't break what already worked

The brief's constraint: *do not delete or rewrite existing working features.*
After any deploy that touched the hub:

- [ ] The Task Tracker's existing projects and tasks are all still there, with
      their comments.
- [ ] The Task Tracker API still answers. `GET /tasks/api/overview` is the one
      call the dashboard makes, and returns every project and task:

      ```bash
      curl -u "$TRACKER_USER:$TRACKER_PASSWORD" \
        https://dev.bkesari.com/tasks/api/overview | head -c 400
      ```
- [ ] The ATIP snapshot that was published before the deploy is still showing,
      with a sensible age in its banner.
- [ ] `gokesari.com` and `test.gokesari.com` are **untouched and still working**.
      They are a separate site and nothing here should ever reach them.

---

## 6. The gate

A tier is only good when **all** of the following hold. This is also the bar for
promoting dev to test later — nothing is promoted on a warning you have not read.

- [ ] CI green on the commit that was deployed (section 1).
- [ ] Every box in section 2 ticked, especially 2.1.
- [ ] `scripts/smoke-dev.sh` passes with **zero failures**, and you have read
      each warning and decided it is expected.
- [ ] Section 4 walked through in a real browser, desktop and phone width.
- [ ] Section 5 confirms nothing that worked before has stopped working.

---

## 7. Known gaps

Honest list, so nothing here is mistaken for covered:

- **Signed URLs break under a tab path unless handled.** Laravel validates a
  signature by rebuilding the URL from the request, which reaches the Education
  app with the `/edu` prefix already stripped, so a signature generated with
  the prefix can never match. Livewire signs every file upload, which is why
  complaint evidence could not be uploaded through `/edu/` until
  `App\Routing\BasePathSignedUploadUrl` (covered by `BasePathTest` and
  `edu/tests/smoke/browser.cjs`). The app signs nothing else today
  (`MustVerifyEmail` is off on the `User` model), but email verification links,
  which are signed, will need the same treatment.
- **The three tab paths are wired but unproven against Hostinger.** `/milk/`,
  `/edu/` and `/ladwani/` have each been driven end to end against their real
  app behind the real hub locally, including a browser sign-in through
  Livewire for Education. What has not happened is a run on the actual dev
  sites, because no tier is deployed yet. The smoke test reports an
  unconfigured tab as a warning rather than a failure.
- **An app's own `fetch()` calls are not covered by `basePath`.** That is not a
  gap in the hub but a thing to check per project: `basePath` covers links,
  the router and assets, and nothing else. LadWani needed 100 call sites across
  42 files rewritten, and has `scripts/check-base-path.sh` to keep them that
  way. Any further project served under a tab path needs the same audit —
  `DEPLOY.md` Part 7 lists what to look at.
- **LadWani's lint cannot run.** `eslint.config.mjs` targets ESLint 9 while the
  repo pins ESLint 8, and `next lint` on Next 14 would hang waiting for input.
  Its CI says so too. Nothing is linted in that repo.
- **No end-to-end browser test runs anywhere in CI.** `bkesari` has Playwright
  configured and one acceptance spec (`tests/e2e/acceptance.spec.ts`), but no
  workflow runs it. Section 4 is manual for that reason.
- **No load or concurrency testing.** The payment and stock guards in Milk & Dairy
  have unit tests proving their compare-and-swap behaviour, but nothing has
  exercised them under real parallel traffic.
- **The Global Warming figures are not verified.** They carry sources and years;
  somebody still has to check them against those sources.
