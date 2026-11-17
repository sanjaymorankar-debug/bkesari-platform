# Screen inventory — UI redesign on Kesari 1.1.0 (17–18 Nov 2026)

Every in-scope screen, where it lives, the states it shows, and its before/after screenshots
(`docs/design/screens/before|after/<id>-360.jpg` and `-1440.jpg`; JPEG, full page). "Before" is
production (bkesari.com) on 17 Nov 2026 for public pages, and `main` run locally for signed-in
pages; a new screen's "before" is what production answered at that address (usually its 404).
Status values follow the product tracker: Not started / In progress / Done / Blocked.

Design system: [design-system.md](design-system.md). Decisions: [decisions.md](decisions.md) D-039 (the bkesari ID) and D-040 onward (this redesign).

## bkesari.com hub and shared screens

| ID | Screen | Route | States shown | Primary action | Status |
|---|---|---|---|---|---|
| hub-home | Home: hero, project grid (icon, name, one line, Open), about, footer | `/` | announcement banner when set; Marathi/Hindi via `k_lang` | See the projects | Done |
| hub-about | About | `/about` | — | — | Done (on 1.1.0 shell) |
| hub-sign-in | Sign in (one card per project, its own sign-in) | `/auth/sign-in` | — | the chosen project's sign-in | Done |
| hub-request-access | Request access, step 1: choose a project | `/request-access` | error when continuing with none (400, inline alert) | Continue | Done |
| hub-request-access-2 | Request access, step 2: what the project asks, who approves | `/request-access?project=…` | LadWani (operator), Education (school), TaskList (open) | Continue to the project's sign-up | Done |
| hub-account | My projects and access | `/account` | per project: checking (skeleton), signed in + level, waiting for approval, not signed in, could not check (Try again); ATIP row for the owner; open projects | Open / Sign in | Done |
| hub-account-signed-in | My projects with a TaskList session | `/account` | signed in as a TaskList member | Open TaskList | Done |
| hub-admin-sign-in | Hub admin sign-in | `/admin` | inline error | Sign in | Done (on 1.1.0) |
| hub-admin | Hub admin: access approvals, tiles, banner, inbox | `/admin` | approvals panel per project; tiles; announcement; messages | Open a project's queue | Done |
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
