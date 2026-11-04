# bkesari.com UX audit: "before" baseline

**Date:** 3 Nov 2026. Measurements taken between 09:30 AM IST and 09:45 AM IST.
**Purpose:** a record of how the live sites look and perform before the "Kesari" redesign (saffron #C2560A, Mukta, EN/Marathi/Hindi, WCAG 2.2 AA, mobile-first, Lighthouse ≥ 90, CLS < 0.1, LCP < 2.5 s).
**Scope:** read-only and anonymous (never signed in). Every protected project was seen only as its redirect to the shared sign-in page. `/ATIP/` was only checked for its status code.

| Step | Time (IST) | Tool |
|---|---|---|
| Reachability, redirect chains, headers (curl) | 09:30–09:33 AM | curl 8 / OpenSSL 3.0.13 |
| Screenshots, 360px h-scroll check, axe scan, metadata, console | 09:33–09:38 AM | Playwright 1.63.0, Chrome for Testing 153.0.8010.12, axe-core 4.14.0 |
| Lighthouse, 3 runs per page | 09:39–09:43 AM | Lighthouse 13.6.0, mobile preset, simulated throttling |
| Supplementary checks (menu open, Create account tab, axe at 360px, styles) | 09:45 AM | Playwright + axe-core |

Viewports were 360×780 (mobile, touch), 768×1024 (mobile, touch) and 1280×800 (desktop), all at DPR 1. axe ran with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa`. Screenshots are full-page JPEGs (quality 55), cut off at 3000px tall.

---

## Top 10 findings, ranked by user impact

1. **The live Driving Simulator page shows an internal "to do" note to the public.** `/driving-simulator/` on prod (and on test) ends with a dashed panel that reads: *"STILL TO BE FILLED IN — This page is live-ready in structure but deliberately carries no specifics, because they were not known when it was written. Please supply: Where the simulator is, and the hours it is available · How to book, and who to contact — phone, email, or a form · Session length and pricing, including any package rates · What the setup actually is … · Whether any certificate or course completion comes with it · Photographs of the real setup. Then delete this panel. …"* The page gives a visitor no location, no hours, no price and no way to book. axe flags 12 serious colour-contrast nodes on it, most of them inside this panel (#B85A0E on #FDF0E3, 4.16:1). See [1280](ux-audit/screens/prod-driving-simulator-1280.jpg) and [360](ux-audit/screens/prod-driving-simulator-360.jpg).
2. **The planned `/education` and `/tasklist`, and the existing `/ATIP/`, return bare, unbranded error pages.** `/education` and `/tasklist` return **404** with the Express default page: title `Error` and the body text *"Cannot GET /education"*. `/ATIP/` returns **404** `text/plain` with the body *"Not found"*: no `<title>`, no `lang`, and axe reports 2 serious violations. None of these pages has a viewport meta, so phones lay them out 980px wide and shrink the text. None has a menu, a footer or a link home. This is the same on prod and test. See [prod-education-360](ux-audit/screens/prod-education-360.jpg) and [prod-atip-360](ux-audit/screens/prod-atip-360.jpg).
3. **Visitors heading to a protected project land on a generic page that never names that project.** `/ladwani/`, `/edu/`, `/tasks/`, `/access/request` and `/admin/access` each send a `302` to `/auth/sign-in?next=…`. The page says only *"Sign in to bkesari / Sign in to continue."* It never mentions LadWani, Education or TaskList. No "Forgot password?" link is visible, and no password rules are shown. With the "Create account" tab selected the heading still says *"Sign in to bkesari / Sign in to continue."* ([screenshot](ux-audit/screens/prod-auth-sign-in-360-create-account.jpg)). On the hub, 3 of the 5 project cards carry the label *"Sign in required"*.
4. **The main call to action and the hint text fail WCAG 1.4.3 contrast** (axe and Lighthouse agree):
   - The hub's "Sign in" button is white on #E0761F: **3.09:1** (17px, weight 600).
   - The "Sign in required" card labels are #9A9EA9 on white: **2.67:1** (12px).
   - The footer "© 2026 bkesari.com" is #9A9EA9 on #F6F4EF: **2.43:1**.
   - The source lines on Environment are **2.67:1** (11.5px).
   - The active menu tab and the TEST pill are #B85A0E on #FDF0E3: **4.16:1**.

   axe counted serious nodes at 1280px on prod: home 6, Environment 12, Driving Simulator 12.
5. **Every hub page has an unlabelled form control in the menu (axe, critical).** The menu's `#bk-menu-toggle` is a visually hidden checkbox driven by a `<label>Menu</label>`. At 1280px that label is hidden, so axe reports `label` (critical) on all 10 prod pages that show the menu. At 360px the label is visible and the rule passes. The toggle has no `aria-expanded` and no button role, so screen readers announce it as a checkbox. At 360px the "Menu" target is 82×32px.
6. **The hub home fails the layout-shift target on mobile.** Lighthouse measured CLS **0.13** on prod `/` in all 3 runs (target < 0.1). Lighthouse attributes the whole shift to `body > main`. The served HTML has an empty `<div data-bkesari-menu>` with the comment *"The top bar is injected here by the shared menu"*. The Sign-in page (0.055), Environment (0.064) and Driving Simulator (0–0.064) also shift `body > main`, but stay under 0.1.
7. **Render-blocking requests delay first paint by about 0.7 s on mobile.** Three requests block rendering on every hub page: `/shared/menu.js` (5.9 KB, served unminified, about 2 KiB could be saved), the Google Fonts Inter CSS and `/shared/page.css`. Lighthouse estimates 670–780 ms of savings. Simulated mobile FCP and LCP are the same number, **2.0–2.3 s**, which leaves little headroom under the 2.5 s LCP target. Static assets are served with `cache-control: public, max-age=0`.
8. **The visual system is not consistent, and the brand colour is not the one rendered.** Every page declares `theme-color #C2560A`, but the accent actually drawn (brand dot, CTA button) is **#E0761F**. The sign-in page looks like a different product:
   - blue primary button #3552CC
   - cool-grey background #F3F4F7 (the hub uses warm #F6F4EF)
   - 14px body text (the hub uses 16px) and a 22px H1 (the hub uses 44px)
   - tab buttons that fall back to **Arial**
   - no footer
   - an uppercase "MENU" button (the hub shows "Menu")

   Compare [hub 360](ux-audit/screens/prod-home-360.jpg) with [sign-in 360](ux-audit/screens/prod-auth-sign-in-360.jpg).
9. **There is no Marathi or Hindi, and the font cannot show Devanagari.** Every hub page is `<html lang="en">`. No page has a language switcher or any Devanagari text. The font is **Inter** from Google Fonts: weights 400–800 on the hub, 400–700 on sign-in. The served CSS contains only the latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext and vietnamese subsets. Mukta is not loaded anywhere.
10. **The baseline security headers are missing, and dev is unreachable.**
    - No response carries `Strict-Transport-Security`, `X-Frame-Options` (or `frame-ancestors`), `Referrer-Policy` or `Permissions-Policy`.
    - `X-Content-Type-Options: nosniff` appears only on the Express 404 page.
    - The CSP is only `upgrade-insecure-requests`.
    - `https://dev.bkesari.com` fails the TLS handshake (*"tlsv1 alert internal error"*).
    - `http://dev.bkesari.com/` returns a Hostinger LiteSpeed **403 Forbidden**, and every other dev path returns Hostinger's default **404** page ("This Page Does Not Exist", 985 kB).

What already works: no portal page scrolls sideways at 360px. No portal page logged a console error at any width. TBT is 0 ms everywhere. Lighthouse Performance scores 93–97 (median) and Best Practices 100. Each page weighs 61–64 KiB.

---

## Tier reachability

| Tier | Result |
|---|---|
| prod `https://bkesari.com` | Reachable. `X-Bkesari-Env: prod`. Served through Hostinger CDN (`server: hcdn`). `http://` → `301` → `https://`. |
| test `https://test.bkesari.com` | Reachable. `X-Bkesari-Env: test`, `X-Robots-Tag: noindex, nofollow`. `server: LiteSpeed` (no CDN header). `http://` → `301` → `https://`. Every HTML page checked (`/`, `/auth/sign-in`, `/environment/`, `/driving-simulator/`) is byte-identical to prod. The only visible difference is a "TEST" pill next to the brand. |
| dev `https://dev.bkesari.com` | **Not reachable.** `curl: (35) OpenSSL/3.0.13: error:0A000438:SSL routines::tlsv1 alert internal error`. The server sends a TLS alert right after the Client Hello. |
| dev `http://dev.bkesari.com` | `/` → **403** Hostinger LiteSpeed page "403 Forbidden / Access to this resource on the server is denied!". `/ladwani/`, `/auth/sign-in`, `/environment/` → **404** Hostinger default page "This Page Does Not Exist". No `X-Bkesari-Env` header, so the portal is not serving this host. |

DNS from this container: `bkesari.com` → 147.79.72.31 and 147.79.79.196. `test.bkesari.com` and `dev.bkesari.com` both → 93.127.208.167.

---

## Per-tier, per-route results

Column notes:
- **360px h-scroll** compares `document.documentElement.scrollWidth` with the viewport width.
- **axe** counts violating nodes at 1280px, by impact: critical / serious / moderate / minor.
- On `/education` and `/tasklist` the page's own CSP (`default-src 'none'`) blocked axe injection. axe was re-run with CSP bypassed and found 0 violations.

### prod (https://bkesari.com)

| Route | Status / redirect chain | Title | `lang` | 360px h-scroll | axe @1280 (crit / ser / mod / min) | Screens |
|---|---|---|---|---|---|---|
| `/` | 200 `/` | "bkesari" | en | no (360 / 360) | 1 / 6 / 0 / 0 — color-contrast×6, label×1 | [360](ux-audit/screens/prod-home-360.jpg) · [768](ux-audit/screens/prod-home-768.jpg) · [1280](ux-audit/screens/prod-home-1280.jpg) · [360 menu open](ux-audit/screens/prod-home-360-menu-open.jpg) |
| `/ladwani/` | 302 `/ladwani/` → 200 `/auth/sign-in?next=%2Fladwani%2F` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 0 / 0 / 0 — label×1 | [360](ux-audit/screens/prod-ladwani-360.jpg) · [768](ux-audit/screens/prod-ladwani-768.jpg) · [1280](ux-audit/screens/prod-ladwani-1280.jpg) |
| `/edu/` | 302 `/edu/` → 200 `/auth/sign-in?next=%2Fedu%2F` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 0 / 0 / 0 — label×1 | [360](ux-audit/screens/prod-edu-360.jpg) · [768](ux-audit/screens/prod-edu-768.jpg) · [1280](ux-audit/screens/prod-edu-1280.jpg) |
| `/tasks/` | 302 `/tasks/` → 200 `/auth/sign-in?next=%2Ftasks%2F` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 0 / 0 / 0 — label×1 | [360](ux-audit/screens/prod-tasks-360.jpg) · [768](ux-audit/screens/prod-tasks-768.jpg) · [1280](ux-audit/screens/prod-tasks-1280.jpg) |
| `/ATIP/` | **404** `/ATIP/` (text/plain "Not found") | (empty) | (none) | n/a: no viewport meta, laid out at 980px | 0 / 2 / 0 / 0 — document-title×1, html-has-lang×1 | [360](ux-audit/screens/prod-atip-360.jpg) · [768](ux-audit/screens/prod-atip-768.jpg) · [1280](ux-audit/screens/prod-atip-1280.jpg) |
| `/driving-simulator/` | 200 `/driving-simulator/` | "Driving Simulator — bkesari" | en | no (360 / 360) | 1 / 12 / 0 / 0 — color-contrast×12, label×1 | [360](ux-audit/screens/prod-driving-simulator-360.jpg) · [768](ux-audit/screens/prod-driving-simulator-768.jpg) · [1280](ux-audit/screens/prod-driving-simulator-1280.jpg) |
| `/environment/` | 200 `/environment/` | "Environmental Activities — bkesari" | en | no (360 / 360) | 1 / 12 / 0 / 0 — color-contrast×12, label×1 | [360](ux-audit/screens/prod-environment-360.jpg) · [768](ux-audit/screens/prod-environment-768.jpg) · [1280](ux-audit/screens/prod-environment-1280.jpg) |
| `/global-warming/` | 301 `/global-warming/` → 200 `/environment/` | "Environmental Activities — bkesari" | en | no (360 / 360) | 1 / 12 / 0 / 0 — color-contrast×12, label×1 | [360](ux-audit/screens/prod-global-warming-360.jpg) · [768](ux-audit/screens/prod-global-warming-768.jpg) · [1280](ux-audit/screens/prod-global-warming-1280.jpg) |
| `/auth/sign-in` | 200 `/auth/sign-in` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 0 / 0 / 0 — label×1 | [360](ux-audit/screens/prod-auth-sign-in-360.jpg) · [768](ux-audit/screens/prod-auth-sign-in-768.jpg) · [1280](ux-audit/screens/prod-auth-sign-in-1280.jpg) · [360 Create account](ux-audit/screens/prod-auth-sign-in-360-create-account.jpg) |
| `/access/request` | 302 `/access/request` → 200 `/auth/sign-in?next=%2Faccess%2Frequest` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 0 / 0 / 0 — label×1 | [360](ux-audit/screens/prod-access-request-360.jpg) · [768](ux-audit/screens/prod-access-request-768.jpg) · [1280](ux-audit/screens/prod-access-request-1280.jpg) |
| `/admin/access` | 302 `/admin/access` → 200 `/auth/sign-in?next=%2Fadmin%2Faccess` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 0 / 0 / 0 — label×1 | [360](ux-audit/screens/prod-admin-access-360.jpg) · [768](ux-audit/screens/prod-admin-access-768.jpg) · [1280](ux-audit/screens/prod-admin-access-1280.jpg) |
| `/education` (planned) | **404** `/education` ("Cannot GET /education") | "Error" | en | n/a: no viewport meta, laid out at 980px | 0 / 0 / 0 / 0 | [360](ux-audit/screens/prod-education-360.jpg) · [768](ux-audit/screens/prod-education-768.jpg) · [1280](ux-audit/screens/prod-education-1280.jpg) |
| `/tasklist` (planned) | **404** `/tasklist` ("Cannot GET /tasklist") | "Error" | en | n/a: no viewport meta, laid out at 980px | 0 / 0 / 0 / 0 | [360](ux-audit/screens/prod-tasklist-360.jpg) · [768](ux-audit/screens/prod-tasklist-768.jpg) · [1280](ux-audit/screens/prod-tasklist-1280.jpg) |

Notes on prod:
- All five sign-in redirects render the same page with the same copy. The `next` value is not shown to the user.
- `/environment/` is 3375px tall at 360px, so the 360px and 768px screenshots stop at 3000px and miss the end of the "Sources" list and the footer. The 1280px screenshot shows the whole page.
- Menu labels do not match the paths. The menu says "Education" (path `/edu/`, planned `/education`) and "TaskList" (path `/tasks/`, planned `/tasklist`).
- The menu has no "Sign in" or account entry. The only sign-in entry point on the hub is the button in the page body. The brand "bkesari" is the only Home link.

### test (https://test.bkesari.com)

| Route | Status / redirect chain | Title | `lang` | 360px h-scroll | axe @1280 (crit / ser / mod / min) | Screens |
|---|---|---|---|---|---|---|
| `/` | 200 `/` | "bkesari" | en | no (360 / 360) | 1 / 7 / 0 / 0 — color-contrast×7, label×1 | [360](ux-audit/screens/test-home-360.jpg) · [768](ux-audit/screens/test-home-768.jpg) · [1280](ux-audit/screens/test-home-1280.jpg) |
| `/ladwani/` | 302 `/ladwani/` → 200 `/auth/sign-in?next=%2Fladwani%2F` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 1 / 0 / 0 — color-contrast×1, label×1 | [360](ux-audit/screens/test-ladwani-360.jpg) · [768](ux-audit/screens/test-ladwani-768.jpg) · [1280](ux-audit/screens/test-ladwani-1280.jpg) |
| `/edu/` | 302 `/edu/` → 200 `/auth/sign-in?next=%2Fedu%2F` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 1 / 0 / 0 — color-contrast×1, label×1 | [360](ux-audit/screens/test-edu-360.jpg) · [768](ux-audit/screens/test-edu-768.jpg) · [1280](ux-audit/screens/test-edu-1280.jpg) |
| `/tasks/` | 302 `/tasks/` → 200 `/auth/sign-in?next=%2Ftasks%2F` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 1 / 0 / 0 — color-contrast×1, label×1 | [360](ux-audit/screens/test-tasks-360.jpg) · [768](ux-audit/screens/test-tasks-768.jpg) · [1280](ux-audit/screens/test-tasks-1280.jpg) |
| `/ATIP/` | **404** `/ATIP/` (text/plain "Not found") | (empty) | (none) | n/a: no viewport meta, laid out at 980px | 0 / 2 / 0 / 0 — document-title×1, html-has-lang×1 | [360](ux-audit/screens/test-atip-360.jpg) · [768](ux-audit/screens/test-atip-768.jpg) · [1280](ux-audit/screens/test-atip-1280.jpg) |
| `/driving-simulator/` | 200 `/driving-simulator/` | "Driving Simulator — bkesari" | en | no (360 / 360) | 1 / 13 / 0 / 0 — color-contrast×13, label×1 | [360](ux-audit/screens/test-driving-simulator-360.jpg) · [768](ux-audit/screens/test-driving-simulator-768.jpg) · [1280](ux-audit/screens/test-driving-simulator-1280.jpg) |
| `/environment/` | 200 `/environment/` | "Environmental Activities — bkesari" | en | no (360 / 360) | 1 / 13 / 0 / 0 — color-contrast×13, label×1 | [360](ux-audit/screens/test-environment-360.jpg) · [768](ux-audit/screens/test-environment-768.jpg) · [1280](ux-audit/screens/test-environment-1280.jpg) |
| `/global-warming/` | 301 `/global-warming/` → 200 `/environment/` | "Environmental Activities — bkesari" | en | no (360 / 360) | 1 / 13 / 0 / 0 — color-contrast×13, label×1 | [360](ux-audit/screens/test-global-warming-360.jpg) · [768](ux-audit/screens/test-global-warming-768.jpg) · [1280](ux-audit/screens/test-global-warming-1280.jpg) |
| `/auth/sign-in` | 200 `/auth/sign-in` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 1 / 0 / 0 — color-contrast×1, label×1 | [360](ux-audit/screens/test-auth-sign-in-360.jpg) · [768](ux-audit/screens/test-auth-sign-in-768.jpg) · [1280](ux-audit/screens/test-auth-sign-in-1280.jpg) |
| `/access/request` | 302 `/access/request` → 200 `/auth/sign-in?next=%2Faccess%2Frequest` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 1 / 0 / 0 — color-contrast×1, label×1 | [360](ux-audit/screens/test-access-request-360.jpg) · [768](ux-audit/screens/test-access-request-768.jpg) · [1280](ux-audit/screens/test-access-request-1280.jpg) |
| `/admin/access` | 302 `/admin/access` → 200 `/auth/sign-in?next=%2Fadmin%2Faccess` | "Sign in — bkesari" | en | no (360 / 360) | 1 / 1 / 0 / 0 — color-contrast×1, label×1 | [360](ux-audit/screens/test-admin-access-360.jpg) · [768](ux-audit/screens/test-admin-access-768.jpg) · [1280](ux-audit/screens/test-admin-access-1280.jpg) |
| `/education` (planned) | **404** `/education` ("Cannot GET /education") | "Error" | en | n/a: no viewport meta, laid out at 980px | 0 / 0 / 0 / 0 | [360](ux-audit/screens/test-education-360.jpg) · [768](ux-audit/screens/test-education-768.jpg) · [1280](ux-audit/screens/test-education-1280.jpg) |
| `/tasklist` (planned) | **404** `/tasklist` ("Cannot GET /tasklist") | "Error" | en | n/a: no viewport meta, laid out at 980px | 0 / 0 / 0 / 0 | [360](ux-audit/screens/test-tasklist-360.jpg) · [768](ux-audit/screens/test-tasklist-768.jpg) · [1280](ux-audit/screens/test-tasklist-1280.jpg) |

Notes on test:
- Each test page that shows the menu has exactly one more serious contrast node than its prod counterpart. That node is the "TEST" pill (`.bk-env`, #B85A0E on #FDF0E3, 10px bold, 4.16:1).
- One curl request to `https://test.bkesari.com/ladwani/` took 9.73 s end to end at 09:31 AM IST (redirect plus sign-in page). Later Playwright loads of the same URL had a TTFB of about 0.7 s.

### dev (http://dev.bkesari.com, since HTTPS fails)

| Route | Status | Title | `lang` | 360px h-scroll | axe @1280 | Screens |
|---|---|---|---|---|---|---|
| `/` | **403** (LiteSpeed "403 Forbidden") | "403 Forbidden" | (none) Chrome reported a 580px layout width on the 360px screen. The page contains a fixed 800px-wide box. | 0 / 1 / 0 / 0 — html-has-lang×1 | [360](ux-audit/screens/dev-http-home-360.jpg) · [768](ux-audit/screens/dev-http-home-768.jpg) · [1280](ux-audit/screens/dev-http-home-1280.jpg) |
| `/ladwani/` | **404** (Hostinger default page) | "This Page Does Not Exist" | en-us | no (360 / 360) | 0 / 0 / 0 / 0 | [360](ux-audit/screens/dev-http-ladwani-360.jpg) · [768](ux-audit/screens/dev-http-ladwani-768.jpg) · [1280](ux-audit/screens/dev-http-ladwani-1280.jpg) |
| `/auth/sign-in` | **404** (Hostinger default page) | "This Page Does Not Exist" | en-us | no (360 / 360) | 0 / 0 / 0 / 0 | [360](ux-audit/screens/dev-http-auth-sign-in-360.jpg) · [768](ux-audit/screens/dev-http-auth-sign-in-768.jpg) · [1280](ux-audit/screens/dev-http-auth-sign-in-1280.jpg) |
| `/environment/` | **404** (curl only) | — | — | — | — | — |

---

## Page metadata

Prod and test are the same for every row in this table.

| Page | `<title>` | `lang` | meta description | meta viewport | theme-color | robots |
|---|---|---|---|---|---|---|
| `/` | bkesari | en | "One home for the bkesari projects: community, education, tasks and more." | `width=device-width, initial-scale=1` | #C2560A | none |
| `/auth/sign-in` (and all 5 redirects) | Sign in — bkesari | en | **missing** | `width=device-width, initial-scale=1` | #C2560A | `noindex` |
| `/environment/` | Environmental Activities — bkesari | en | "What the warming figures say, what they mean for India, and what reduces them." | `width=device-width, initial-scale=1` | #C2560A | none |
| `/driving-simulator/` | Driving Simulator — bkesari | en | "Driver training on a simulator: practising the situations that are unsafe to rehearse on a real road." | `width=device-width, initial-scale=1` | #C2560A | none |
| `/ATIP/` | (none, text/plain) | none | none | none | none | none |
| `/education`, `/tasklist` | Error | en | none | **none** | none | none |

Also observed:
- The hub links `/manifest.webmanifest` (200) and an apple-touch-icon, and uses an inline SVG emoji favicon.
- `/favicon.ico`, `/robots.txt` and `/sitemap.xml` all return 404 on both prod and test.

## Header, menu, footer, fonts, landmarks (prod; test identical except the TEST pill)

| Page | Menu bar | Footer | Fonts (computed body) | Font source | Notes |
|---|---|---|---|---|---|
| `/` | Yes. `nav.bk-menu`, injected by `/shared/menu.js`. Desktop links: "bkesari · LadWani · Education · TaskList · Driving Simulator · Environmental Activities". At 360px and 768px the links collapse behind "Menu"; when opened, 5 links of 39px height appear ([360 open](ux-audit/screens/prod-home-360-menu-open.jpg)). | Yes, "© 2026 bkesari.com" | Inter, system-ui, -apple-system, sans-serif; 16px; H1 44px | Google Fonts `Inter:wght@400;500;600;700;800&display=swap` (preconnect present) | No skip link. First Tab stop is the "bkesari" brand link, which has the default focus outline. Landmarks: 1 `main`, 1 `nav`, 1 `footer`, 0 `header`. |
| `/auth/sign-in` | Yes, same links; the button reads "MENU" (uppercase) at 360px | **No footer** | Inter, system-ui, sans-serif; **14px**; H1 22px. Tab buttons compute to **Arial** | Google Fonts `Inter:wght@400;500;600;700&display=swap` | Primary button #3552CC (blue). Background #F3F4F7. Inputs 39px tall, tabs 33px, submit 37px at 360px. `autocomplete` is set correctly (email, current-password / new-password, name). No skip link. |
| `/environment/` | Yes, the "Environmental Activities" tab is active | Yes | Same as `/` | Same as `/` | Long single column; no horizontal scroll at 360px |
| `/driving-simulator/` | Yes, the "Driving Simulator" tab is active | Yes | Same as `/` | Same as `/` | Placeholder panel (finding 1) |
| 404 pages | No | No | Times New Roman (ATIP) / browser monospace (Express) | none | No route back to the hub |

Hidden controls found in the sign-in page DOM (not visible in the default state): "Email me a code", "Code", "Verify" and two "Sign out" buttons.

## Copy as served

### Hub home (`/`, anonymous)

> **bkesari** · LadWani · Education · TaskList · Driving Simulator · Environmental Activities
>
> # Welcome to bkesari
> One home for all of our projects. One bkesari ID signs you in; each project then decides what you may open.
>
> [Sign in]
>
> 👪 **LadWani**: Family and community portal. *Sign in required*
> 🎓 **Education**: School and student governance. *Sign in required*
> ✅ **TaskList**: Projects, tasks and status updates. *Sign in required*
> 🚗 **Driving Simulator**: Driver training simulator
> 🌍 **Environmental Activities**: Climate facts and local impact
>
> © 2026 bkesari.com

The page also has a `<noscript>` fallback: *"The menu above needs JavaScript to appear. Every project is still reachable:"* followed by 5 links.

### Sign-in (`/auth/sign-in`, and every protected-route redirect)

> **bkesari** · LadWani · Education · TaskList · Driving Simulator · Environmental Activities
>
> # Sign in to bkesari
> Sign in to continue.
>
> [Sign in] [Create account]
> EMAIL ▢
> PASSWORD ▢
> [Sign in]

With the "Create account" tab selected, the fields are "NAME", "EMAIL", "PASSWORD" and the button is [Create account]. The heading and subtitle do not change.

## Console errors

| Page(s) | Console output |
|---|---|
| All portal pages (`/`, sign-in and its 5 redirects, `/environment/`, `/global-warming/`, `/driving-simulator/`) on prod and test, at 360, 768 and 1280px | **None.** No failed requests and no 4xx/5xx sub-resources. |
| `/ATIP/`, `/education`, `/tasklist` | `Failed to load resource: the server responded with a status of 404` (the document itself) |
| dev-http `/` | `Failed to load resource: … 403` (the document itself) |
| dev-http 404 pages | 404 for the document; `net::ERR_TUNNEL_CONNECTION_FAILED` for one third-party request (blocked by this container's proxy, so not the site's fault); warnings `Unrecognized feature: 'join-ad-interest-group'` and `Couldn't load preload assets` |

---

## Lighthouse (mobile preset, simulated throttling)

Each page was run 3 times between 09:39 and 09:43 AM IST. Each figure below is the median of the 3 runs, taken separately for each metric. The raw scores of each run are in brackets.

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT | FCP | Speed Index | Page weight |
|---|---|---|---|---|---|---|---|---|---|---|
| prod `/` | **93** [92, 93, 94] | **95** | 100 | 100 | 2.05 s | **0.130** [0.13 ×3] | 0 ms | 2.05 s | 2.30 s | 64 KiB, 9 requests |
| prod `/auth/sign-in` | **97** [97, 97, 98] | **100** | 100 | **50** | 2.00 s | 0.055 | 0 ms | 2.00 s | 2.42 s | 62 KiB, 8 requests |
| prod `/environment/` | **96** [96 ×3] | **95** | 100 | 100 | 2.18 s | 0.064 | 0 ms | 2.18 s | 2.55 s | 63 KiB, 8 requests |
| prod `/driving-simulator/` | **97** [97, 96, 97] | **95** | 100 | 100 | 2.07 s | 0.064 [0, 0.064, 0.064] | 0 ms | 2.07 s | 2.33 s | 63 KiB, 8 requests |
| test `/` | **93** [96, 91, 93] | **95** | 100 | **60** | 2.27 s | 0.069 [0.069, 0.13, 0.069] | 0 ms | 2.27 s | 2.94 s | 61 KiB, 9 requests |

Where Lighthouse took points off:
- **Accessibility 95:** `color-contrast` failed on `/`, `/environment/`, `/driving-simulator/` and test `/`. Lighthouse scans at mobile width, where the menu label is visible, so it does not report the `label` violation that axe finds at 1280px. `target-size` passed.
- **SEO:** on sign-in, `is-crawlable` fails because of `<meta name="robots" content="noindex">` (intentional) and `meta-description` is missing. On test, `is-crawlable` fails because of `X-Robots-Tag: noindex, nofollow` (expected on test).
- **Performance:**
  - On every page: `render-blocking-insight` (estimated savings 670–780 ms) and `network-dependency-tree-insight`.
  - On `/`: `layout-shifts` and `cls-culprits-insight` (`body > main`).
  - `unminified-javascript`: `/shared/menu.js`, about 2 KiB.
- The LCP element was text in every case: `p.lead` on `/`, on `/environment/` and on test `/`; `h1` on sign-in; the first `p` on `/driving-simulator/`. FCP equals LCP on every page, so the first paint is held back by the blocking CSS, fonts and JS rather than by images.

### Playwright timings (unthrottled, from this container; supplementary)

The LCP and CLS figures come from a `PerformanceObserver` installed before navigation. The TTFB of redirected routes includes the 302 hop.

| Page (prod) | 360px TTFB / LCP / CLS | 1280px TTFB / LCP / CLS |
|---|---|---|
| `/` | 828 ms / 1816 ms / 0.000 | 415 ms / 844 ms / 0.032 |
| `/auth/sign-in` | 371 ms / 544 ms / 0.000 | 389 ms / 596 ms / 0.008 |
| `/ladwani/` → sign-in | 814 ms / 1024 ms / 0.000 | 806 ms / 1000 ms / 0.008 |
| `/environment/` | 351 ms / 768 ms / 0.000 | 384 ms / 864 ms / 0.035 |
| `/driving-simulator/` | 383 ms / 828 ms / 0.000 | 469 ms / 940 ms / 0.035 |
| test `/` | 1052 ms / 2240 ms / 0.000 | 315 ms / 696 ms / 0.032 |

---

## Security and indexing headers

| Response | CSP | HSTS | X-Frame-Options | X-Content-Type-Options | Referrer-Policy | X-Robots-Tag | X-Bkesari-Env | Server | Cache-Control |
|---|---|---|---|---|---|---|---|---|---|
| prod `http://bkesari.com/` (301) | `upgrade-insecure-requests` | — | — | — | — | — | — | — | — |
| prod HTML pages (`/`, `/auth/sign-in`, `/environment/`, `/driving-simulator/`) and the 302 redirects | `upgrade-insecure-requests` | **none** | **none** | **none** | **none** | none | `prod` | `hcdn` | `public, max-age=0` |
| prod `/shared/menu.js` | `upgrade-insecure-requests` | none | none | none | none | none | `prod` | `hcdn` | `public, max-age=0` |
| prod `/ATIP/` (404, text/plain) | `upgrade-insecure-requests` | none | none | none | none | none | `prod` | `hcdn` | — |
| prod `/education`, `/tasklist` (404, Express) | `default-src 'none'` **and** `upgrade-insecure-requests` (two headers) | none | none | `nosniff` | none | none | `prod` | `hcdn` | — |
| test HTML pages | `upgrade-insecure-requests` | none | none | none | none | `noindex, nofollow` | `test` | `LiteSpeed` | `public, max-age=0` |
| test `/education`, `/tasklist` (404) | `default-src 'none'` and `upgrade-insecure-requests` | none | none | `nosniff` | none | `noindex, nofollow` | `test` | `LiteSpeed` | — |
| dev `http://` `/` (403) | none | none | none | none | none | none | **none** | `LiteSpeed` | `private, no-cache, no-store, must-revalidate, max-age=0` |
| dev `https://` | TLS handshake fails, so no response | | | | | | | | |

No response carried `Permissions-Policy`, `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy`. All responses also carry `platform: hostinger` and `panel: hpanel`.

---

## Baseline to beat

The redesign should improve on each of these measured values.

| Metric | Baseline (3 Nov 2026) | Target |
|---|---|---|
| Lighthouse mobile Performance (median) | 93 home · 97 sign-in · 96 environment · 97 driving · 93 test home | ≥ 90 (keep), ideally ≥ 95 everywhere |
| Lighthouse mobile Accessibility | 95 · 100 · 95 · 95 · 95 | ≥ 90 (keep) → 100 |
| Lighthouse Best Practices | 100 on all 5 | ≥ 90 (keep) |
| Lighthouse SEO (prod public pages) | 100 home / env / driving; 50 sign-in (noindex, no description) | keep 100; add a description to sign-in |
| Mobile CLS, hub home | **0.13** (fails) | < 0.1 |
| Mobile CLS, other pages | 0.055–0.069 | < 0.1, ideally ≈ 0 (reserve space for the menu bar) |
| Mobile LCP (simulated) | 2.00–2.27 s | < 2.5 s, with more headroom |
| Mobile FCP (simulated) | 2.00–2.27 s (FCP = LCP) | lower; render-blocking estimate is 670–780 ms |
| TBT | 0 ms | keep 0 ms |
| Page weight | 61–64 KiB, 8–9 requests | keep under ~100 KiB, even after adding Mukta and Devanagari subsets |
| axe WCAG 2.x A/AA nodes at 1280px, prod | home 7 (1 crit, 6 ser) · sign-in 1 crit · environment 13 (1 crit, 12 ser) · driving 13 (1 crit, 12 ser) · ATIP 404 2 ser | 0 |
| Lowest text contrast measured | 2.43:1 (footer), 2.67:1 (hints / sources), 3.09:1 (primary CTA) | ≥ 4.5:1 for body text. For reference, white on #C2560A measures **4.54:1** and #C2560A on #F6F4EF measures 4.13:1 |
| Horizontal scroll at 360px | none on portal pages; 404 pages laid out at 980px | none anywhere |
| Branded 404 pages | 0 of 3 kinds (Express, text/plain, Hostinger) | branded, localised, with a route home |
| Planned routes `/education`, `/tasklist` | 404 on prod and test | serve or redirect |
| Languages | EN only; `lang="en"`; Inter without Devanagari | EN / मराठी / हिंदी, correct `lang`, Mukta |
| Security headers | HSTS, XFO / frame-ancestors, nosniff, Referrer-Policy all absent on portal pages | all present |
| dev tier | HTTPS: TLS internal-error alert. HTTP: 403 / 404 Hostinger pages | reachable over HTTPS |
| Console errors on portal pages | 0 | keep 0 |

## Files

- Screenshots: `docs/ux-audit/screens/` (89 JPEGs, about 3.8 MB). The naming pattern is `<tier>-<route-slug>-<width>.jpg`. Tiers are `prod`, `test` and `dev-http`. Two extras: `prod-home-360-menu-open.jpg` and `prod-auth-sign-in-360-create-account.jpg`.
- The raw JSON from Playwright, axe and Lighthouse was kept in the session scratch directory and not committed.
