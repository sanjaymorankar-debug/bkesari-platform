# Screen inventory — UI redesign on Kesari 1.1.0 (17–18 Nov 2026)

Every in-scope screen, where it lives, the states it shows, and its before/after screenshots
(`docs/design/screens/before|after/<id>-360.jpg` and `-1440.jpg`; JPEG, full page). "Before" is
production (bkesari.com) on 17 Nov 2026 for public pages; for the bkesari ID's screens (sign-in,
request access, My projects, the admin queue, the signed-in home) it is `main` at 2d03d98 run
locally, since production had not yet been updated to it; for LadWani's and Education's signed-in
screens it is `main` at 4aaa7fd run locally with the same data.
Status values follow the product tracker: Not started / In progress / Done / Blocked.

Design system: [design-system.md](design-system.md). Decisions: [decisions.md](decisions.md) D-039 (the bkesari ID) and D-040 onward (this redesign).

## bkesari.com hub and shared screens

| ID | Screen | Route | States shown | Primary action | Status |
|---|---|---|---|---|---|
| hub-home | Home: hero, project grid (icon, name, one line, one action), about, footer | `/` | announcement banner when set; Marathi/Hindi via `k_lang` | See the projects | Done |
| hub-home-signed-in | Home with a bkesari ID: each card shows the person's access (open, pending, request, signed out) and the matching action | `/` | approved, awaiting LadWani, pending, request, sign in | the card's action | Done |
| hub-about | About | `/about` | — | — | Done (on 1.1.0 shell) |
| hub-signin | **Unified sign-in** (bkesari ID, D-039): Google first, the email code, built-in administrators' password; aside naming every project and whether it needs approval | `/auth/sign-in?next=` | Google on/off; code sent; dev-only code; errors (`?error=google_…`) | Continue with Google (else Email me a code) | Done |
| hub-access-request | **Request access to a project**: the project's icon and accent, the steps (request, approval, LadWani's operator check, open), role and note | `/access/request?project=` | form; pending (waiting); declined / revoked with reason | Send request | Done |
| hub-account | **My projects** (profile): who you are, each project's access in words with the approver and date, the next action; your requests | `/account` | approved, awaiting, pending, declined, revoked, request, open; no requests yet | the row's action | Done |
| hub-admin-access | **Admin approval screen**: requests (approve with a role, decline with a reason), people (change role, revoke, grant, suspend), filters | `/admin/access` | pending count; filtered; nothing here | Approve | Done |
| hub-admin-sign-in | Hub admin sign-in (tiles, banner, inbox) | `/admin` | inline error | Sign in | Done (on 1.1.0) |
| hub-admin | Hub admin: link to the access queue, tiles, banner, inbox | `/admin` | tiles; announcement; messages | Save | Done |
| hub-contact | Contact | `/contact` | topic preselected by `?topic=`; inline errors; sent | Send | Done |
| hub-privacy | Privacy notice (DPDP Act 2023) | `/privacy` | — | — | Done (on 1.1.0 shell) |
| hub-404 | Not found | any unknown path | project shortcuts | Go to the home page | Done |
| hub-500 | Server error | on an error | — | Try again | Done (same layout as 404) |
| hub-offline | Offline (service worker) | `/offline.html` | — | Try again | Done |
| hub-styleguide | Live style guide (dev and test only) | `/styleguide/` | every component and state, the icon set | — | Done |

## Static project pages

| ID | Screen | Route | Sections | Primary action | Status |
|---|---|---|---|---|---|
| hub-driving | Driving Simulator | `/driving-simulator/` | hero with drawing, why, what it does well (6), how practice builds up (4 steps), who it suits, questions, call to action | Register your interest (contact, topic Driving Simulator) | Done |
| hub-environment | Environmental Activities (global warming) | `/environment/` | hero figure on its scale, four figures, CO₂ bars, why rain matters, day to day, what reduces it (ranked), activities to start (6), call to action, sources | Start an activity / Tell us your plan (contact, topic Environment) | Done |

## ATIP (not redesigned)

| Item | Where | Status |
|---|---|---|
| Tile on the home page, same card, icon and states as every project; opens `/ATIP/` unchanged, in its own window | `/` | Done |
| Entry in the project switcher (every page), marked Private | shell | Done |
| ATIP's own screens, code, data | ATIP-DEV | Not touched (out of scope) |

## App shell (every project)

| Item | Status |
|---|---|
| "Back to bkesari home" (arrow + logo) in every project; switcher with home first and My projects last; short project names on phones | Done |
| Two-row footer: brand, public projects; About, Privacy, Terms, Contact | Done |
| Accent per project (top rule, project name) incl. Driving Simulator and ATIP | Done |

## Mobile apps (Android, iOS)

| App | What changed | Status |
|---|---|---|
| LadWani, Education, TaskList | screens, icons, navigation from the site (no release needed); icon and splash sources from the icon set; offline screen; splash settings | Done |
| Store builds (APK/AAB, IPA) | on hold (D-033), need the Mac | Blocked |
