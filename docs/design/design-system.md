# Kesari design system — kesari-ui 1.1.0

One design system for bkesari.com and every project it hosts: the hub, LadWani, Education,
TaskList, the Driving Simulator and Environment pages, and the ATIP tile and menu entry.

- **Source:** `packages/kesari-ui/src` (`tokens.css`, `base.css`, `components.css`, `kesari.js`, `icons.json`)
- **Build:** `npm run build:kesari`, committed to `portal/public/kesari-ui/1.1.0/`
- **Served** by the hub at `/kesari-ui/1.1.0/`, cached immutably for a year. **1.0.0 stays served**
  beside it, unchanged, so a page or app build that still names it keeps working; every page in
  this repository names 1.1.0 (the service workers' cache names moved with it).
- **Live style guide:** `/styleguide/` on dev and test (404 on production)
- **Screen inventory:** [screen-inventory.md](screen-inventory.md)

```html
<html lang="en" data-project="ladwani">   <!-- home | ladwani | education | tasklist | environment | driving | atip -->
<link rel="stylesheet" href="/kesari-ui/1.1.0/kesari.css">
<script src="/kesari-ui/1.1.0/kesari.js"></script>   <!-- in <head>: applies the theme before paint -->
<script src="/shared/menu.js" defer></script>        <!-- the app shell: header + footer -->
```

Budget: **30 KB gzipped** for the CSS, the runtime and the shell together, checked by
`tests/kesari-ui.test.js` (1.1.0: about 22 KB). Fonts are separate: Mukta (latin, latin-ext,
Devanagari) and Tiro Devanagari Marathi for display headings, self-hosted under the OFL with
`font-display: swap`.

## What changed in 1.1.0 (17 Nov 2026)

| Area | 1.0.0 | 1.1.0 |
|---|---|---|
| Project accents | LadWani, Education, TaskList, Environment | + **Driving Simulator** sky `#0369A1`, **ATIP** slate `#475569`, **home** (the brand) |
| Environment text colour | `#15803D` (4.45:1 on its own tint: fails AA) | `#166534` (6.3:1); its button fill stays `#15803D` |
| Icons | ten inline paths inside the shell | **one icon set**, 51 icons on a 24 px grid: `icons.json` → `icons.svg` sprite and `icons/*.svg`; the shell's inline copies are tested to be identical |
| Motion | one duration | `--k-motion-fast` 120 ms, `--k-motion` 160 ms, `--k-motion-slow` 280 ms, `--k-ease`, `--k-ease-out` |
| Type | up to `--k-text-3xl` | + `--k-text-4xl` (3.052 rem) for heroes, fluid from 2 rem at 360 px |
| Components | — | project icon `.k-picon`, project card `.k-pcard`, breadcrumbs, hero, section head, eyebrow, arrow link, soft button, features, stats, numbered steps, call-to-action band, questions (`.k-faq`), bars, status list |
| App shell | logo links home | inside a project the logo is a visible **"Back to bkesari home"** link (arrow + logo); the switcher starts with home and ends with **My projects and access**; two-row footer with the public projects |

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--k-brand` | `#C2560A` | `#F08A3C` | brand fills (logo, the hub's primary button) |
| `--k-brand-hover` | `#A64808` | `#F5A869` | hover |
| `--k-brand-tint` | `#FDF1E8` | `#3A2312` | tinted backgrounds |
| `--k-accent` | the project's | the project's, lighter | buttons, borders, rings, bars |
| `--k-accent-ink` | the project's text colour | = accent | the accent **as text**: links, eyebrows, soft buttons, tabs |
| `--k-accent-tint` | the project's tint | dark tint | project icons, eyebrows, soft buttons, call-to-action bands |
| `--k-ink` / `--k-muted` / `--k-faint` | `#1C1917` / `#57534E` / `#78716C` | `#F5F5F4` / `#C9C4BF` / `#A8A29E` | text |
| `--k-surface` / `--k-surface-2` / `--k-page` | `#FFFFFF` / `#F5F3F0` / `#FAF8F5` | `#1F1B19` / `#292421` / `#141110` | backgrounds |
| `--k-border` / `--k-border-strong` | `#E7E5E4` / `#A8A29E` | `#3A3532` / `#6B6560` | lines, input borders |
| success / warning / danger / info | `#15803D` / `#B45309` / `#B91C1C` / `#1D4ED8` | `#4ADE80` / `#FBBF24` / `#F87171` / `#93C5FD` | status text, with `*-tint` backgrounds |

### Project accents

Set with `data-project` on `<html>` or any ancestor (a card on the hub carries its project's).

| Project | `data-project` | Accent (fill) | Text | Tint | Dark accent | Dark tint | White on fill | Text on tint |
|---|---|---|---|---|---|---|---|---|
| bkesari home | `home` (default) | `#C2560A` | `#A64808` | `#FDF1E8` | `#F08A3C` | `#3A2312` | 4.54 | 5.33 |
| LadWani | `ladwani` | `#7C2D12` maroon | `#7C2D12` | `#FBEDE7` | `#F4A68C` | `#3B1A10` | 9.37 | 8.20 |
| Education | `education` | `#0F766E` teal | `#0F766E` | `#E0F5F2` | `#5EEAD4` | `#0E3532` | 5.47 | 4.82 |
| TaskList | `tasklist` | `#4338CA` indigo | `#4338CA` | `#EBEBFC` | `#A5B4FC` | `#23234A` | 7.90 | 6.71 |
| Environment | `environment` | `#15803D` green | `#166534` | `#E3F6E9` | `#4ADE80` | `#123A22` | 5.02 | 6.32 |
| Driving Simulator | `driving` | `#0369A1` sky | `#0369A1` | `#E0F2FE` | `#7DD3FC` | `#0C2A3D` | 5.93 | 5.17 |
| ATIP | `atip` | `#475569` slate | `#475569` | `#EEF1F5` | `#CBD5E1` | `#1E2632` | 7.58 | 6.69 |

`tests/kesari-ui.test.js` reads every accent block and fails if any of these falls below 4.5:1 in
either theme: accent text on the page, the surface and its own tint, and button text on the fill.
The brand saffron `#C2560A` as text on the page is 4.28:1, which is why `--k-accent-ink` exists.

Dark mode follows `prefers-color-scheme` unless the theme toggle pins `data-theme="light|dark"`,
stored in `localStorage` (`kesari.theme`) with every access wrapped in try/catch. The system and
pinned values are tested to be identical, for the base tokens and for every project.

## Type, space, shape, motion

| Group | Tokens |
|---|---|
| Fonts | `--k-font` Mukta (UI, body); `--k-font-display` Tiro Devanagari Marathi (hub display headings, `.k-display`) |
| Size | base 16 px, **17 px when `<html lang>` is `mr` or `hi`**; line-height 1.6 |
| Scale 1.25 | `--k-text-xs` .8 · `sm` .875 · `md` 1 · `lg` 1.25 · `xl` 1.5625 · `2xl` 1.953 · `3xl` 2.441 · `4xl` 3.052 rem |
| Space (4 px grid) | `--k-1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `8` 32 · `10` 40 · `12` 48 · `16` 64 px |
| Radius | `--k-radius-sm` 8 · `--k-radius` 12 · `--k-radius-lg` 20 · `--k-radius-pill` |
| Elevation | `--k-shadow-1` rest · `--k-shadow-2` hover · `--k-shadow-3` overlays |
| Motion | `--k-motion-fast` 120 ms · `--k-motion` 160 ms · `--k-motion-slow` 280 ms · `--k-ease` `cubic-bezier(.2,0,0,1)` · `--k-ease-out`. All of it stops under `prefers-reduced-motion` |
| Layout | `--k-content` 1120 px; breakpoints **360 · 768 · 1024 · 1440**, mobile first |
| Targets | `--k-target` 48 px: every button, input, nav link and tab. Footer and breadcrumb links 44 px |
| Focus | 3 px outline in `--k-focus` (saffron), 2 px offset, on `:focus-visible`. Never removed (tested) |

Text widths are never fixed in pixels: labels, buttons and cards size to their content and wrap,
so Marathi and Hindi (often 20–40 % longer) fit without changes.

## Icon set

51 icons, one source: `packages/kesari-ui/src/icons.json`. 24 × 24 grid, 2 px safe area, stroke
1.75, round caps and joins, no fills, drawn in `currentColor`, so an icon takes the colour of where
it sits (the project accent on a tile, ink in a menu, white on a solid button).

**Project icons** — the same drawing everywhere the project appears (home grid, switcher, chooser,
My projects, app icons):

| Key | Drawing | Accent |
|---|---|---|
| `home` | house | brand saffron |
| `ladwani` | a family tree: one parent, three children | maroon |
| `education` | mortarboard | teal |
| `tasklist` | a ticked box | indigo |
| `driving` | steering wheel | sky |
| `environment` | leaf | green |
| `atip` | rising line with an arrow | slate |

**Interface icons:** grid, theme (moon), sun, globe, external, arrow-left, arrow-right,
chevron-down, plus, close, check, search, user, users, sign-in, sign-out, lock, shield, pending, alert, info, bell, flag, chat, rupee,
stop, clock, calendar, mail, phone, map-pin, heart, play, repeat, road, route, thermometer,
droplet, waves, cloud, sprout, bolt, book, school.

Use them three ways:

```html
<!-- 1. inline, rendered by the server (the hub: menu.icon('ladwani', 'k-icon')) -->
<svg class="k-icon" viewBox="0 0 24 24" …>…</svg>
<!-- 2. from the sprite (LadWani, Education) -->
<svg class="k-icon" aria-hidden="true"><use href="/kesari-ui/1.1.0/icons.svg#k-i-ladwani"/></svg>
<!-- 3. as a file (docs, app icons, design tools) -->
<img src="/kesari-ui/1.1.0/icons/ladwani.svg" alt="">
```

Icons are decorative (`aria-hidden="true"`); the text beside them, or the control's
`aria-label`, carries the meaning.

### Project icon `.k-picon` — states

```html
<span class="k-picon" data-project="driving"><svg …/></span>      <!-- --sm 36 · default 48 · --lg 64 · --xl 88 -->
```

| State | Look | How |
|---|---|---|
| Rest | accent icon on the accent tint, rounded square (radius 28 % of size) | default |
| Hover | solid accent, icon in `--k-on-accent`, lifts 1 px | the link, button or `.k-pcard` around it is hovered |
| Active / current | solid accent with a 3 px tint ring | `aria-current` on it or an ancestor |
| Focus | the 3 px saffron ring of the link or button around it | `:focus-visible` |
| Solid | always filled | `.k-picon--solid` |

## Components

All are on `/styleguide/` with their states. 1.0.0 components are unchanged.

| Component | Class | States |
|---|---|---|
| App shell header | `/shared/menu.js` (`.ks-bar`) | hub / in-project accent and **back-to-home link**, tier badge (beside the logo; below 960 px it hangs from the accent stripe above the logo so the row is as wide as production's), below 960 px the account as its avatar (its menu shows the name, when it is not the address, and the address) and short project names (D-050); up to 640 px the switcher's panel is held to the bar's right edge so it stays on screen, a project that signs someone in or out after load sends `bkesari:account` and the account menu catches up; a framework must not write into the slots again (LadWani: `shell-slots.tsx`, D-051), switcher open, signed in / out, EN / MR / HI, ≤ 360 px |
| Project switcher | `.ks-switch` (`<details>`) | closed, open; home first, current project marked, **My projects and access** last; ATIP only for the owner, opens in a new window |
| Footer | `.ks-foot` / `.k-footer` | brand + tagline + public projects; About, Privacy, Terms, Contact; © |
| Breadcrumbs | `nav.k-breadcrumbs > ol > li` | link, current (`aria-current="page"`) |
| Bottom nav (phones), side nav (desktop) | `.k-bottomnav`, `.k-sidenav` | current page |
| Buttons | `.k-btn` + `--brand --secondary --ghost --soft --danger --sm --block --icon` | default, hover, focus, disabled, loading (`aria-busy`) |
| Arrow link | `.k-link-arrow` | hover moves the arrow |
| Inputs with inline validation | `.k-field .k-label .k-input .k-hint .k-error` | default, focus, disabled, error |
| OTP input | `.k-otp[data-k-otp]` | per-digit boxes, paste fills all |
| Select / search | `.k-select`, `.k-search` | default, focus |
| Cards, tiles | `.k-card`, `.k-card--link`, `.k-tile` | default, hover |
| **Project card** | `.k-pcard` (+ `data-project`) with `.k-pcard__head`, `__name`, `__text`, `__cta` | rest, hover (lifts, accent border, CTA fills), focus (ring on the CTA); the CTA's link covers the card |
| **Hero** | `.k-hero` > text + `.k-hero__art`; `.k-hero__lead`, `.k-hero__actions` | one column, two from 1024 px |
| **Section head, eyebrow** | `.k-section-head`, `.k-eyebrow` | — |
| **Features** | `ul.k-features > li.k-feature` | — |
| **Stats** | `ul.k-stats > li.k-stat` with `__value`, `__label`, `__source` | — |
| **Numbered steps** | `ol.k-steps > li` | — |
| **Call to action** | `.k-cta` | one column; text + button from 768 px |
| **Questions** | `.k-faq > details > summary` | closed, open |
| **Bars** | `ul.k-bars > li` with `__label`, `__value`, `__track > __fill[style=--v:NN]` | accent, muted; the value is always written out, not only drawn |
| **Status list** | `ul.k-statuslist > li.k-statusrow` with `__meta`, `__action` | loading (skeleton), signed in, signed out, waiting, error |
| Tables → stacked cards on phones | `.k-table--stack` + `data-label` | wide, ≤ 700 px |
| Tabs | `.k-tabs` | selected |
| Modal / bottom sheet | `<dialog class="k-dialog">` + `Kesari.openDialog` | modal ≥ 640 px, sheet below; Esc closes, focus returns |
| Toast | `Kesari.toast(msg, {kind, action})` | info, success, danger, with action |
| Badge / chip | `.k-badge`, `.k-chip--live --beta --soon --danger --accent --plain` | — |
| Avatar, stepper, pager, upload, progress ring | `.k-avatar`, `.k-stepper`, `.k-pager`, `.k-upload`, `.k-ring` | — |
| Empty state, skeleton, banner | `.k-empty`, `.k-skel--line --card`, `.k-banner--success --warning --danger --brand` | — |
| Tree node (LadWani) | `.k-node`, `--spouse`, `--expired` | expanded |

## Runtime (`kesari.js`, `window.Kesari`)

Unchanged from 1.0.0 apart from `VERSION`: theme (`setTheme`, `currentTheme`), language (`setLang`,
which stores `kesari.lang` and the cookie `k_lang` so the server-rendered hub and Laravel can read
it; `t`, `add`, `[data-i18n]`), formatting in IST and the Indian way (`formatDate` → "3 Nov 2026",
`formatTime` → "08:42 AM IST", `formatNumber` → "1,30,000", `formatRupees`, `istToday`), `toast`,
`openDialog`, OTP wiring, and `Kesari.store` (every storage access wrapped).

## Rules

1. **One primary action per screen.** The filled brand or accent button is the screen's main
   action; everything else is secondary, soft, ghost or an arrow link.
2. **Every list has its three states:** loading (`k-skel`), empty (`k-empty` with one action) and
   error (`k-banner--danger` with what to do next).
3. **No hard-coded text widths, and no user-facing strings in code.** English in the markup or the
   `en` dictionary; Marathi and Hindi follow key for key (tests check parity).
4. **Dates as "3 Nov 2026", times with "IST", numbers grouped the Indian way.**
5. **No inline scripts on the hub or TaskList** (CSP `script-src 'self'`). Static pages carry no
   script of their own beyond the shell.
6. **Every project shows the shell**, so every project has the way back home, the switcher and
   the same footer.
7. **ATIP is shown, never changed:** a tile and a menu entry in the same style as the rest; the
   link goes to `/ATIP/` unchanged and opens in its own window.
