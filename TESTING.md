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
| `bkesari-platform` | `ci.yml` | the server, proxy and shared menu parse; **19 menu unit tests**; **20 proxy tests**, including a real proxy against a real upstream; **32 deploy-guard cases**; the hub boots against sqlite and passes the full smoke test; correct logins are accepted and wrong ones rejected |
| `bkesari` (Milk & Dairy) | `ci.yml` | migrations apply to a real **MySQL 8**; typecheck; eslint; **281 unit and integration tests**; a production build; the deploy-guard cases |
| `Ladwani` | `ci.yml` | migrations apply to a real **MySQL 8**; reference and UAT data seed; typecheck; `prisma validate`; the schema still targets MySQL; the test suite; a production build; the deploy-guard cases |
| `bkesari-platform/edu` | `ci.yml` (`edu` job) | **387 PHPUnit tests** (1,085 assertions, 43 files) against in-memory sqlite, including 12 covering the app served under the hub's `/edu/` path; `composer validate`; the Vite manifest matches the files on disk |

Each project's **deploy** workflow re-runs its own suite before it publishes, so
a build that reaches dev is one that passed. Nothing is deployed on a red build.

**What CI does not prove**, and so what the rest of this file is for: that the
server's `.env` is correct, that the tier is talking to the right database, that
the site is reachable, and that it looks right in a browser.

### Running a suite yourself

```bash
# bkesari-platform (the hub) — needs nothing
npm ci && npm test && npm run check

# bkesari (Milk & Dairy) — needs a MySQL you don't mind being wiped
DATABASE_URL='mysql://root:pw@127.0.0.1:3306/scratch' \
TEST_DATABASE_URL='mysql://root:pw@127.0.0.1:3306/scratch' \
AUTH_SECRET=local CRON_SECRET=local \
  npm ci && npm run db:migrate && npm test

# Ladwani — the suite reads .env.test; ci.yml shows exactly what to put in it
npm ci && npm run test:migrate && npm test

# edu (Laravel) — in-memory sqlite, no database needed, ~12 seconds
cd edu && composer install
cp .env.example .env && php artisan key:generate --force   # APP_KEY, first time only
php artisan test
```

> **Never point a test suite at a dev, test or production database.** Several of
> these truncate every table before they run.

---

## 2. Tier safety — check these before anything else

These are the rules that cost the most to get wrong, and the only ones no
automated check in this repo can make for you: they need hPanel or SSH.

### 2.1 This tier talks only to its own database

The brief's hard rule: *an environment must never connect to another
environment's database, and a project connects only to its own.* Open each
site's `.env` on the server and read `DB_NAME`:

| Project | dev database |
|---|---|
| Milk & Dairy | `u879099820_main_milk_dev` |
| Education | `u879099820_Edu_dev` |
| LadWani | `u879099820_Ladwani_dev` |
| TaskList (the hub) | `u879099820_Tasklist_dev` |
| ATIP | `u879099820_ATIP_dev` *(to be confirmed)* |

- [ ] Every `DB_NAME` on the dev sites ends in `_dev`.
- [ ] No dev `.env` names a `_test` or `_prod` database, and none names another
      project's database.
- [ ] Database names match hPanel **exactly** — they are case-sensitive on Linux,
      so `_Edu_dev` is not `_edu_dev`.

A quick way to see all of them at once over SSH:

```bash
grep -H '^DB_NAME' ~/domains/dev*.bkesari.com/*/.env
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
- [ ] The smoke test's **Nothing private is served** group passes (it tries to
      fetch `/.env` and `/.git/config` over HTTPS).

### 2.4 You can get back

- [ ] A database dump exists from *before* today's deploy, and you have read
      `DEPLOYMENT.md` §7 in `bkesari` for the restore command.
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

- **Signed URLs would break under a tab path.** Laravel validates a signature
  by rebuilding the URL from the request, which reaches the Education app with
  the `/edu` prefix already stripped, so a signature generated with the prefix
  can never match. Nothing signs a URL today (`MustVerifyEmail` is switched off
  on the `User` model), so this is a trap rather than a fault — but password
  reset links or email verification will need the prefix restored before the
  check. `DEPLOY.md` Part 7 says where.
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
