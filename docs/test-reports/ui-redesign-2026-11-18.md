# UI redesign on Kesari 1.1.0: testing report

**Brief of 17 Nov 2026, 11:18 PM IST; report of 18 Nov 2026 (IST, UTC + 5:30).**
Branch `claude/inspiring-cray-41q0vh`, PR [sanjaymorankar-debug/bkesari-platform#40](https://github.com/sanjaymorankar-debug/bkesari-platform/pull/40), on top of `main` 2d03d98 (the bkesari ID, D-039).
Screens: [design/screen-inventory.md](../design/screen-inventory.md). Design system: [design/design-system.md](../design/design-system.md). Decisions D-040 to D-049: [design/decisions.md](../design/decisions.md).

## 1. Summary

| | |
|---|---|
| Verdict on the code | **PASS** — portal-tester PASS (1 S1 defect found and fixed), edu-tester PASS (1 S4 defect found and fixed), CI green (test, ladwani, edu) |
| Test server (test.bkesari.com) | **Not testable as a separate tier**: since the move to the VPS it answers `301 → https://bkesari.com/`. The tier checks ran on a local production-tier build instead (section 9) |
| Production (bkesari.com) | **Not updated** — it runs on the Hostinger VPS (189.72.155.162), which does not pull `main`; at 01:15 AM IST it still served the 4 Nov release. Measured as the "before" baseline (sections 6, 8); the "after" checks run once the VPS is updated (section 11) |
| Screens | 17 hub and shared screens, 2 static pages, 11 LadWani, 10 Education, 4 mobile apps: all built; see section 2 |
| Defects | 20 found across design, build and testing; 20 fixed (section 10) |

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

| Page | Production now (4 Nov release) | This release, production-tier build (local) |
|---|---|---|
| `/` mobile | 99 / 100 / 100 / 100 | **98 / 100 / 100 / 100** |
| `/` desktop | 99 / 100 / 100 / 100 | **100 / 100 / 100 / 100** |
| `/driving-simulator/` mobile | 99 / 100 / 100 / 100 | **100 / 100 / 100 / 100** |
| `/environment/` mobile | 99 / 100 / 100 / 100 | **100 / 100 / 100 / 100** |
| `/auth/sign-in` mobile | 99 / 100 / 100 / 100 | **100 / 100 / 100 / —** (dev tier: noindex) |
| `/edu/` mobile | 99 / 98 / 96 / 90 | measured after deploy |

Order: Performance / Accessibility / Best practices / SEO. All ≥ 90. Production-tier build: robots.txt and sitemap.xml now exist (production had neither; SEO 100). Home: LCP 2.1 s mobile, CLS ≤ 0.014.

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

## 9. Test server and production server

| Tier | State | Checks |
|---|---|---|
| test.bkesari.com | redirects to bkesari.com (no separate tier on the VPS) | the tier rules ran locally with `APP_ENV=prod` (robots open, indexable, no on-screen codes) and in the portal-tester's S5 tier step (test and prod: no code or link shown) |
| bkesari.com | 4 Nov release | before: Lighthouse (section 6), screenshots (section 8). After: pending the VPS update |

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

## 11. Open items

1. **Update the VPS** (owner, or Claude with SSH access): this also switches production to the bkesari ID, so first set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the redirect URI, `HUB_PROXY_SECRET` (hub and Education), the built-in administrators' hashes, and run `tools/link_accounts_to_hub.mjs` (dry run, then `--apply`) — `docs/test-reports/auth-module-2026-11-18.md` §8. Then: `git pull` of `main`, `npm ci && npm run build:hostinger`, restart the hub; Education: `git pull`, `composer install --no-dev`, `php artisan migrate --force`, caches.
2. **After the update**: re-run sections 4–6 against bkesari.com (`func2.js`, axe, Lighthouse) and take the production "after" screenshots.
3. **Hardening (portal-tester O2)**: robots.txt and the sitemap build their URLs from the request's host and are publicly cacheable; use a fixed origin per tier.
4. **Firefox and Safari** for real (section 7).
5. **Mobile store builds**: on hold (D-033); need the Mac.
6. **LadWani API** (from the LadWani work): operators cannot open ID-proof files; the approvals list has no submitter names; 20 requests a minute per visitor is tight for signed-in pages.
7. **Audits (report only)**: hub 3 high (picomatch); LadWani 11 (4 moderate, 5 high, 2 critical); Education `composer audit` 7 advisories in 4 packages (same lock file as main; none reached under `/edu`; proposed: `composer update laravel/framework symfony/http-foundation symfony/http-kernel symfony/routing --with-dependencies` as its own change), `npm audit` 0 with `--omit=dev`.
9. **Education tests to add**: the child-safety callout and the dashboard role matrix are unchanged and pass, but no committed test covers them yet (the edu-tester's probe can be committed as it is).
8. **Translations**: Marathi and Hindi written for this release need a native speaker's read (D-019).
