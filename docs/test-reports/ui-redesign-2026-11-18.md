# UI redesign on Kesari 1.1.0: testing report

**Brief of 17 Nov 2026, 11:18 PM IST; report of 18 Nov 2026 (IST, UTC + 5:30).**
Branch `claude/inspiring-cray-41q0vh`, PR [sanjaymorankar-debug/bkesari-platform#40](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/40), on top of `main` 2d03d98 (the bkesari ID, D-039).
Released to `main` by [sanjaymorankar-debug/bkesari-platform#43](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/43) (`1e80125`); **live on bkesari.com since 18 Nov 2026, 02:25 AM IST** (section 9). Live checks: section 12.
Follow-up (U-21, U-22, U-23) released to `main` by [sanjaymorankar-debug/bkesari-platform#46](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/46) (`0ce20d7`); **live on bkesari.com, confirmed 18 Nov 2026, 02:56 PM IST**. Live checks: section 12.2.
Screens: [design/screen-inventory.md](../design/screen-inventory.md). Design system: [design/design-system.md](../design/design-system.md). Decisions D-040 to D-049: [design/decisions.md](../design/decisions.md).

## 1. Summary

| | |
|---|---|
| Verdict on the code | **PASS** — portal-tester PASS (1 S1 defect found and fixed), edu-tester PASS (1 S4 defect found and fixed), CI green (test, ladwani, edu) |
| Test server (test.bkesari.com) | **Not testable as a separate tier**: since the move to the VPS it answers `301 → https://bkesari.com/`. Instead: the tier checks on a local production-tier build, and a rehearsal of the VPS update on the exact release (section 9) |
| Production (bkesari.com) | **Live, PASS** — `main` 0ce20d7 (the release 1e80125 of 02:25 AM IST plus the follow-up) on the VPS, confirmed 02:56 PM IST. Journeys 56/56 at 360/768/1024/1440; the follow-up's fixes 168/168 (en, mr, hi at 320/360/768/1440); axe 0 violations (9 pages, light and dark, 360 and 1440); no overflow or target under 44 px (36/36); Lighthouse 99–100 / 100 / 100 / 100 on 6 pages, mobile and desktop (section 12). The two minor defects found live (U-21, U-22) are fixed and live |
| Screens | 17 hub and shared screens, 2 static pages, 11 LadWani, 10 Education, 4 mobile apps: all built; see section 2 |
| Defects | 23 found across design, build, testing and the live checks; all fixed and live, U-21 to U-23 with the follow-up (section 10) |

## 2. Pass / fail per screen

All at 360 px and 1440 px (768 and 1024 for the hub's overflow and target check). "axe" is WCAG 2.1 A + AA tags; "e2e" a scripted journey on that screen.

| Screen | Route | Functional | Responsive | axe (light / dark) | Result |
|---|---|---|---|---|---|
| Home (signed out) | `/` | 6 cards, one primary CTA, card actions; ATIP opens `/ATIP/` in a new window | no overflow, targets ≥ 44 px at 4 widths | 0 / 0 | **PASS** |
| Home (signed in, access states) | `/` | card actions follow access (sign in, request, pending, open) | no overflow | 0 / 0 | **PASS** |
| Sign-in (bkesari ID) | `/auth/sign-in` | email code → signed in (e2e); every `signin.js` hook | no overflow | 0 / 0 | **PASS** |
| Request access | `/access/request?project=` | steps incl. LadWani's operator check; request sent → pending (e2e) | no overflow | 0 / 0 | **PASS** |
| My projects (profile) | `/account` | every project with access level; history | no overflow (long emails wrap) | 0 / 0 | **PASS** |
| Admin approval queue | `/admin/access` | approve → member can open LadWani (e2e) | tables stack, no overflow | 0 / 0 | **PASS** |
| Hub admin | `/admin` | sign-in, link to the queue, tiles, banner, inbox | no overflow | 0 / 0 | **PASS** |
| About, Privacy, Terms | `/about`, … | render in EN/MR/HI | no overflow | 0 / 0 | **PASS** |
| Contact | `/contact` | topic from `?topic=`; form errors | no overflow | 0 / 0 | **PASS** |
| 404 / 500 / offline | — | branded, way home, project shortcuts | no overflow | 0 / 0 | **PASS** |
| Style guide | `/styleguide/` | every component and the 51 icons | no overflow | 0 / 0 | **PASS** |
| Driving Simulator | `/driving-simulator/` | back home (e2e), CTA to contact | no overflow | 0 / 0 | **PASS** |
| Environment | `/environment/` | back home (e2e), CTAs, sources | no overflow | 0 / 0 | **PASS** |
| LadWani: landing, sign-in, sign-up, pending, verify | `/ladwani/…` | flows 21/21 (LadWani agent) | no overflow | 0 (also Marathi) | **PASS** |
| LadWani: profile, profile edit, family, tree, search | `/ladwani/…` | edit saves, dialogs, empty states | tree overflow at 1024 fixed | 0 | **PASS** |
| LadWani: operator approvals | `/ladwani/approvals/` | approve / reject with note, 409, 403 states | no overflow | 0 | **PASS** |
| Education: landing, listing, school | `/edu/…` | search, clear filters, pager, profile | no overflow | 0 | **PASS** |
| Education: dashboards (parent, student, teacher, school, admin), profile, sign-in/up, onboarding, 404/403/419 | `/edu/…` | per role | no overflow | 0 | **PASS** |
| Mobile: bkesari app, LadWani, Education, TaskList shells | `mobile/` | app tests 29/29; offline screens; icon/splash assets valid | — | — | **PASS** (store builds blocked, section 7) |

## 3. Testing agents and automated suites

| Suite | Command | Result |
|---|---|---|
| portal-tester (TEST_SPEC.md, all levels S1–S7, 30 critical regressions) | agent | **PASS**; report `.claude/test-runs/20261117-194301-portal-tester.md` |
| Hub, no database | `npm test` | 158 passed, 8 PostgreSQL suites skipped as designed; deploy guard 32/32 |
| Hub on PostgreSQL | `npm run test:pg` | **216 / 216**, 0 skipped (main: 205) |
| LadWani | `npm --prefix ladwani test`, `typecheck`, `lint` | **441 / 441** in 37 suites; 0 type errors; 0 lint errors (2 known warnings) |
| Smoke against a running hub | `scripts/smoke-dev.sh` + S5 probes | 32 / 0 / 0; 81 probes ok |
| Security checks | S6 | 32 ok |
| Neon parity (PgBouncer, TLS, SCRAM) | `scripts/neon-parity.sh` | 18 / 0 |
| bkesari app | `cd mobile && npm test` | 29 / 29 |
| Kesari build | `npm run build:kesari` | byte-identical; 23.4 KB of the 30 KB gzipped budget |
| edu-tester (edu/TEST_SPEC.md, all levels incl. S7 through PgBouncer, 22 critical checks) | agent | **PASS**; **583 / 583** on PostgreSQL and through the pooler (main: 574; none removed or weakened); smoke http 65/0, browser 21/0; hub identity path by hand 22/0; role-by-dashboard matrix 5×5; report `.claude/test-runs/20261117-195450-edu-tester.md` |
| CI (GitHub Actions) on a7de01d | test, ladwani, edu | **green** |

## 4. End-to-end journeys

`func2.js` (Playwright, Chromium) on the merged code at 360 and 1440 px: **28 / 28 passed.**
Signed out: home cards and the one primary button; LadWani, Education, TaskList send to the bkesari ID sign-in; Driving Simulator and Environment open with "Back to bkesari home"; ATIP tile and menu entry. Signed in by email code: My projects lists every project; request LadWani (the steps show the operator check), pending; the admin approves on `/admin/access`; the member opens LadWani and its header has "Back to bkesari home". Contact topic, 404, theme toggle, Marathi and back. No script errors.

## 5. Accessibility (axe-core 4, WCAG 2.1 A + AA)

| Area | Runs | Violations |
|---|---|---|
| Hub, 13 screens × 360/1440 × light/dark | 52 | **0** |
| bkesari ID screens signed in (account, request, home, admin queue, admin account) × 360/1440 × light/dark | 20 | **0** |
| LadWani, 11 screens × 360/1440, dialogs and filters open, Marathi at 360 | 30 + 11 | **0** |
| Education, 9 screens × 360/1440, plus student/teacher, onboarding, 404, dark | 18 + | **0** |

Before the redesign, axe found on production: Education's pager (`aria-prohibited-attr`, serious) and LadWani's search (selects without labels, critical; a JSON `<pre>` not reachable by keyboard). All fixed.
Keyboard: skip link, visible 3 px focus ring everywhere (tested: no rule removes it), dialogs return focus, Esc closes. Touch targets: every control ≥ 44 px (48 px default) at 360/768/1024/1440. Contrast: every project accent AA in light and dark (tested per token).

## 6. Lighthouse (12.x, Chromium; mobile = simulated slow 4G)

| Page | Production before (4 Nov release, 17 Nov) | This release, production-tier build (local) | **bkesari.com after (18 Nov, 02:30 AM IST)** |
|---|---|---|---|
| `/` mobile | 99 / 100 / 100 / 100 | 98 / 100 / 100 / 100 | **99 / 100 / 100 / 100** (LCP 1.5 s, CLS 0) |
| `/` desktop | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | **99 / 100 / 100 / 100** (CLS 0.005) |
| `/auth/sign-in` mobile / desktop | 99 / 100 / 100 / 100 | 100 / 100 / 100 / — (dev tier: noindex) | **100 / 100 / 100 / 100**; desktop **99 / 100 / 100 / 100** |
| `/driving-simulator/` mobile / desktop | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | **99 / 100 / 100 / 100** both |
| `/environment/` mobile / desktop | 99 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | **99 / 100 / 100 / 100** both |
| `/about`, `/contact` mobile / desktop | — | — | **99 / 100 / 100 / 100** all four |
| `/edu/` mobile | 99 / 98 / 96 / 90 | — | behind the bkesari ID gate since D-039 (a visitor is sent to sign-in), so not measurable signed out |

Order: Performance / Accessibility / Best practices / SEO. All ≥ 90. robots.txt and sitemap.xml now exist (production had neither). Live LCP 0.9–1.5 s on mobile, 0.2–0.3 s on desktop; CLS ≤ 0.005.

## 7. Cross-browser

| Browser | How | Result |
|---|---|---|
| Chrome | Chromium 1243 (Playwright), all of sections 2–6 | **PASS** |
| Edge | same engine as Chrome (Chromium) | **PASS** by engine |
| Firefox | not runnable here: the sandbox's network refuses Playwright's and Mozilla's downloads. Static audit of the shipped CSS (doiuse, last 2 versions + ESR) | no blocking feature; only progressive enhancements flagged (text-size-adjust, cursor values, scrollbar styling) — **PASS (static)** |
| Safari / iOS | same: static audit (last 2 Safari, iOS ≥ 16.4) | `:has()`, `<dialog>`, custom properties supported; flagged items are touch-irrelevant (`resize`, cursors) — **PASS (static)** |

**Owner**: to run them for real, `npx playwright test` with Firefox and WebKit on the Mac, or allow `cdn.playwright.dev` in this environment's network settings (D-047).

## 8. Before / after screenshots

`docs/design/screens/before/` and `after/`, `<screen>-360.jpg` and `-1440.jpg` (JPEG, full page): 18 hub and shared screens, 11 LadWani, 9 Education. Before = production on 17 Nov for public pages; `main` run locally for signed-in pages (2d03d98 for the bkesari ID's screens, 4aaa7fd for LadWani and Education with the same data).
`docs/design/screens/after-prod/`: the 10 public screens captured on bkesari.com itself after the release went live (home, about, contact, privacy, sign-in, Driving Simulator, Environment, 404, offline, admin sign-in; 360 and 1440). Signed-in screens cannot be captured on production without a real account and its email code. Home and sign-in were taken again on the follow-up (`0ce20d7`, 02:58 PM IST): sign-in no longer names Google, and "Environmental activities" stays whole at 360.

## 9. Test server and production server

| Tier | State | Checks |
|---|---|---|
| test.bkesari.com | redirects to bkesari.com (no separate tier on the VPS; DEPLOY.md: set aside for releases on 18 Nov) | the tier rules ran locally with `APP_ENV=prod` (robots open, indexable, no on-screen codes) and in the portal-tester's S5 tier step (test and prod: no code or link shown). **Rehearsal of the release**: `git archive` of `dev` 6106b34 (the same tree as `main` 1e80125) built as `update-bkesari.sh prepare` does (`npm run build:hostinger`, 44 s, no errors), started with `APP_ENV=production` and `node portal/start.js`: the script's switch check (the bkesari ID's sign-in) passed; 1.1.0 and 1.0.0 assets, robots, sitemap 200; `/edu/`, `/ladwani/`, `/tasklist/`, `/account` to sign-in; unknown paths 404. Hostinger's preview of `dev` (a `*.hostingersite.com` site on the shared hosting the domain no longer uses) is refused by this environment's network, so it was not used |
| bkesari.com | `main` 1e80125 since 02:25 AM IST; `main` 0ce20d7 (follow-up) confirmed 02:56 PM IST | before: sections 6 and 8 (4 Nov release). After: section 12 (12.1 the release, 12.2 the follow-up) |

### Deployment record (18 Nov 2026, IST)

| Time | Step | Result |
|---|---|---|
| 01:18 AM | (the bkesari ID's release, `eb6598f`, by its own session; `docs/test-reports/auth-module-2026-11-18.md` §7) | live; accounts linked 01:23 AM |
| 01:33 AM | PR #40 merged into `dev` (6106b34) | CI green on its head 6d9aaec (test, ladwani, edu) |
| 01:37 AM | PR #43 merged `dev` → `main` (1e80125) | test, ladwani, edu green. The two red `deploy` checks are the dev.bkesari.com push deploys, which have failed since 4 Nov because `DEV_SSH_HOST` is unset (explained on the PR) |
| ~02:20 AM | `update-bkesari.sh check`, `prepare 1e80125…` (owner, on the VPS) | built beside the live copy: `platform-new-1e80125`. An earlier `switch` had correctly refused with "run 'prepare' first" |
| 02:25 AM | `update-bkesari.sh switch 1e80125…` | Education migration: nothing to migrate; swap (previous copy `platform-prev-eb6598f-20261118-0225`); hub restarted; `php artisan optimize`, php-fpm reloaded; checks: the bkesari ID's sign-in, `/edu/` 302 to sign-in, Education 200 |
| 02:25 AM | bkesari.com serves Kesari 1.1.0 | seen by the watcher polling the home page every 30 s |
| 02:27–02:45 AM | live checks | section 12.1 |
| 03:04 AM | PR #45 merged into `dev` (65f15b0): the follow-up, U-21 to U-23 | portal-tester PASS (section 10) |
| 03:26 AM | PR #46 merged `dev` → `main` (0ce20d7) | test, ladwani, edu green; the same two red dev `deploy` checks |
| 06:11 AM | bkesari.com still on 1e80125 | the watcher's 2 hours ran out; checked by hand |
| by 02:56 PM | `update-bkesari.sh check`, `prepare`, `switch 0ce20d7…` (owner, on the VPS) | done |
| 02:56 PM | bkesari.com serves the follow-up | sign-in has `hub-auth__pname`, no "Google" on sign-in or home |
| 02:57–03:05 PM | live checks | section 12.2 |

The day-one account linking (`update-bkesari.sh link`) was not needed again: it ran with the bkesari ID's release at 01:23 AM. Rollback, if ever needed: `sudo bash /tmp/update-bkesari.sh rollback` returns to `1e80125` (the copy kept by the follow-up's switch).

## 10. Defects found and fixed

| ID | Severity | Where | Defect | Fix |
|---|---|---|---|---|
| U-01 | S1 | hub pages | Icons loaded from outside `portal/`: the dev deploy bundle would not start (portal-tester D1) | read from the committed sprite; bundle-start test |
| U-02 | S2 | Kesari | Environment green text on its tint 4.45:1 (below AA) | text colour `#166534` (6.3:1); per-accent contrast test |
| U-03 | S2 | shell | "Back to bkesari home" label did not contain its visible text (axe) | named by content |
| U-04 | S2 | Kesari | Danger button text 2.8:1 in dark mode | on-brand text colour |
| U-05 | S2 | shell | Signed in at 360 px the bar was 3 px too wide (page scrolled sideways) | 44 px controls on phones |
| U-06 | S2 | shell | Avatar initials 1.96:1 in dark mode | surface colour |
| U-07 | S3 | home | Desktop CLS 0.065 (font swap re-wrapped the hero) | hero keeps its height; display face preloaded |
| U-08 | S3 | home | A second 100 KB Devanagari weight loaded for two links | regular weight |
| U-09 | S3 | Kesari / bkesari ID | `.k-btn--sm` 40 px, `.k-input--sm` 36 px (below 44) | 44 px |
| U-10 | S3 | bkesari ID screens | Long email addresses pushed `/account` 78 px sideways at 360 | wrap |
| U-11 | S3 | header | Long project names cut on phones ("Driving S…") | short names on phones |
| U-12 | S2 | LadWani search (before) | Selects without labels (axe critical) | labelled |
| U-13 | S3 | LadWani tree (before) | Page scrolled sideways at 1024 | `min-width: 0` (also in Kesari) |
| U-14 | S2 | LadWani approvals (before) | Raw action codes and JSON shown to operators | readable request cards |
| U-15 | S2 | Education pager (before) | `aria-prohibited-attr` | own accessible pager |
| U-16 | S3 | production | No robots.txt or sitemap.xml (404) | tier-aware routes |
| U-17 | S3 | bkesari app | Capacitor's placeholder icon and splash | the bkesari mark |
| U-18 | S3 | Kesari | A spouse who has passed away lost the dashed outline | kept |
| U-20 | S4 | Education (edu-tester D1) | On Marathi/Hindi pages a confidence level or complaint status stayed in English inside a translated sentence | translated; 2 tests |
| U-19 | S4 | My projects (draft) | LadWani's PENDING read as "waiting for an operator" | superseded by D-039's `/account` |
| U-21 | S3 | sign-in, live | At 360 px the aside broke "Environmental" mid-word ("Environme / ntal"): the rows' grid let the name column shrink to nothing | rows wrap: the name stays whole, the chip moves to the next line; test (follow-up 1eeda7e; live with 0ce20d7, section 12.2) |
| U-22 | S3 | sign-in and home, live | "Sign in once with Google or an email code" while production has no Google button (keys not set yet) | the wording follows the button: Google named only while it is on; 2 new strings × 3 languages; tests (follow-up 1eeda7e; live with 0ce20d7, section 12.2) |
| U-23 | S4 | home (portal-tester D1 on the follow-up) | With Google on, inside a WebView or an in-app browser (Instagram, Facebook) the home card still named Google, though the sign-in page shows no button there | the home route asks `googleEntry` like the sign-in page; test for a browser, the bkesari app, a WebView and Instagram (0ffac9e; live with 0ce20d7) |

The follow-up (1eeda7e, 0ffac9e) went through the portal-tester: **PASS**, `npm run test:pg` 219/219, all 13 levels and 30 critical checks, Google on and off in en/mr/hi at 320/360/768/1440 in light and dark (216 page loads, axe 0 in 108 runs). Report `.claude/test-runs/20261117-212853-portal-tester.md`.

## 11. Open items

1. ~~Update the VPS~~ **Done**: live since 02:25 AM IST (section 9).
2. ~~Live checks after the update~~ **Done**: section 12.
2a. ~~Follow-up release~~ **Done**: `main` 0ce20d7 live, confirmed 02:56 PM IST; live checks in section 12.2.
2c. **Shell below 340 px on dev and test only (portal-tester O1, S4, pre-existing)**: with the tier badge in the brand, signed-in pages scroll 20 px sideways under 340 px. Production has no badge and is not affected. Proposed: hide the brand's name (visually) under 360 px when the badge shows; `portal/public/shared/menu.js` is shared by every project, so it is its own change.
2b. **Google sign-in on production** (owner): set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (and the redirect URI in Google's console); after U-22's fix the pages name Google by themselves once it is on.
3. **Hardening (portal-tester O2)**: robots.txt and the sitemap build their URLs from the request's host and are publicly cacheable; use a fixed origin per tier. On production the host is right (`Sitemap: https://bkesari.com/sitemap.xml`, Caddy passes it through), so this is low priority.
4. **Firefox and Safari** for real (section 7).
5. **Mobile store builds**: on hold (D-033); need the Mac.
6. **LadWani API** (from the LadWani work): operators cannot open ID-proof files; the approvals list has no submitter names; 20 requests a minute per visitor is tight for signed-in pages.
7. **Audits (report only)**: hub 3 high (picomatch); LadWani 11 (4 moderate, 5 high, 2 critical); Education `composer audit` 7 advisories in 4 packages (same lock file as main; none reached under `/edu`; proposed: `composer update laravel/framework symfony/http-foundation symfony/http-kernel symfony/routing --with-dependencies` as its own change), `npm audit` 0 with `--omit=dev`.
9. **Education tests to add**: the child-safety callout and the dashboard role matrix are unchanged and pass, but no committed test covers them yet (the edu-tester's probe can be committed as it is).
8. **Translations**: Marathi and Hindi written for this release need a native speaker's read (D-019).

## 12. Live checks on bkesari.com

### 12.1 The release (18 Nov 2026, 02:27–02:45 AM IST)

Release `main` 1e80125, live since 02:25 AM IST. Run from the cloud session against `https://bkesari.com` (Caddy on the VPS; responses `Cache-Control: no-cache`, so no cache stood in front of the checks). Production sends sign-in codes by email and never shows them on screen, so the signed-in journeys of section 4 cannot be automated there; they ran on the production-tier build and in both testing agents.

| Check | Tool | Scope | Result |
|---|---|---|---|
| Signed-out journeys | Playwright (`prod-func.js`) | 14 checks × 360/768/1024/1440: home on Kesari 1.1.0 (6 cards, each with icon, name, line and one action; one primary button); LadWani/Education/TaskList cards and `/ladwani/`, `/edu/`, `/tasklist/`, `/account`, `/access/request` go to the bkesari ID sign-in; ATIP tile and switcher entry open `/ATIP/` unchanged in a new window; sign-in (email field, send-code button, two columns, no code on screen); Driving Simulator and Environment open to all with "Back to bkesari home" that goes home; contact topic, branded 404, theme toggle, Marathi and back; robots.txt (allow, `Sitemap: https://bkesari.com/sitemap.xml`) and the sitemap; no script errors | **56 / 56 PASS** |
| Accessibility | axe-core 4, WCAG 2.1 A + AA | 9 pages (`/`, about, contact, privacy, terms, sign-in, Driving Simulator, Environment, 404) × 360 and 1440 × light and dark | **0 violations** |
| Responsive | Playwright | the same 9 pages × 360/768/1024/1440: horizontal overflow, interactive targets under 44 px | **36 / 36 clean** |
| Lighthouse 12 | Chromium | 6 pages × mobile and desktop (section 6) | performance **99–100**, accessibility, best practices, SEO **100** |
| Routes | curl | `/kesari-ui/1.1.0/` and `/kesari-ui/1.0.0/` served (cached pages keep working); robots.txt, sitemap.xml 200; `/ATIP/` → ATIP's own login (unchanged); unknown paths 404 | **PASS** |
| Screenshots | Playwright | `docs/design/screens/after-prod/` (section 8) | taken |

The same journeys on the release before (`eb6598f`, the bkesari ID on Kesari 1.0.0) at 01:43 AM, at 360 px: the 6 gate checks passed and the 8 redesign checks failed, as expected. That run is the "before" baseline for this table.

Found live and fixed in the follow-up (section 10): U-21 (a project name broke mid-word in the sign-in aside at 360 px) and U-22 (the pages named Google while production has no Google button). Neither was caught by axe or the overflow check, only by looking at the live screenshots.

### 12.2 The follow-up (18 Nov 2026, 02:56–03:05 PM IST)

Release `main` 0ce20d7, confirmed live at 02:56 PM IST. Same place and tools as 12.1, plus a check written for the follow-up's fixes (`live-fix.cjs`) so they no longer depend on looking at screenshots.

| Check | Tool | Scope | Result |
|---|---|---|---|
| The follow-up's fixes (U-21, U-22) | Playwright (`live-fix.cjs`) | sign-in and home in English, Marathi and Hindi (`k_lang` cookie) × 320/360/768/1440: served in that language; the word "Google" nowhere in the page and no Google button (production has no Google keys yet); no horizontal scroll. Sign-in's 5 project rows: each name breaks only between words (checked per line of text), the chip stays inside its row, row ≥ 44 px | **168 / 168 PASS**. At 320 and 360 px "Environmental activities" and "पर्यावरण गतिविधियाँ" stay whole on one line and the chip moves below (rows 66–68 px) |
| Signed-out journeys | Playwright (`prod-func.js`) | the 14 checks of 12.1 × 360/768/1024/1440 | **56 / 56 PASS** |
| Accessibility | axe-core 4, WCAG 2.1 A + AA | the 9 pages of 12.1 × 360 and 1440 × light and dark | **0 violations** |
| Responsive | Playwright | the 9 pages × 360/768/1024/1440 | **36 / 36 clean** |
| Lighthouse 12 | Chromium | `/`, sign-in, Driving Simulator, Environment, about, contact × mobile and desktop | performance **99–100**, accessibility, best practices, SEO **100** (the same as 12.1; LCP 0.9–1.3 s mobile, 0.2–0.3 s desktop; CLS ≤ 0.007) |
| Routes | curl | `/kesari-ui/1.1.0/` and `/1.0.0/` 200; robots.txt, sitemap.xml 200; unknown paths 404; `/ATIP/` ends on ATIP's own login | **PASS** |
| Screenshots | Playwright | `docs/design/screens/after-prod/hub-home-*` and `hub-signin-*` taken again on 0ce20d7 | taken |

Seen on the way, not part of this release: `/ATIP/` now answers `308 → /atip/` from Caddy, and ATIP's app then sends a visitor to `/atip/login?next=/atip/`. At 06:11 AM `/ATIP/` still went straight to the hub (a single 302). `update-bkesari.sh` does not touch Caddy and the follow-up changed no ATIP route (`git diff 1e80125 0ce20d7 -- portal/server.js scripts/vps/` is empty), so this is a change to the VPS's Caddy configuration made outside this work. The ATIP tile and menu entry still link to `/ATIP/` unchanged and still arrive at ATIP's login.
