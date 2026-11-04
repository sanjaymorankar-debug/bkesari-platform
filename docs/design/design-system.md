# Kesari design system — kesari-ui 1.0.0

One package for the hub, LadWani, Education and TaskList.
- **Source:** `packages/kesari-ui/src`
- **Build:** `npm run build:kesari`, committed to `portal/public/kesari-ui/1.0.0/`
- **Served** by the hub at `/kesari-ui/1.0.0/`, cached immutably for a year
- **Live style guide:** `/styleguide/` on dev and test (404 on production)

```html
<html lang="mr" data-project="ladwani">              <!-- accent: ladwani | education | tasklist | environment -->
<link rel="stylesheet" href="/kesari-ui/1.0.0/kesari.css">
<script src="/kesari-ui/1.0.0/kesari.js"></script>   <!-- in <head>: applies the theme before paint -->
<script src="/shared/menu.js" defer></script>        <!-- the app shell: header + footer -->
```

Budget: **19.6 KB gzipped** in all: CSS 5.8 KB, runtime 3.5 KB, shell 10.3 KB (limit 30 KB, checked by `tests/kesari-ui.test.js`). Fonts are separate. Mukta comes as latin, latin-ext and Devanagari subsets; Tiro Devanagari Marathi is used for hub headings. All are self-hosted under the OFL licence and load with `font-display: swap`.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--k-brand` | `#C2560A` | `#F08A3C` | brand fills (logo, brand button) |
| `--k-brand-hover` | `#A64808` | `#F5A869` | hover |
| `--k-brand-tint` | `#FDF1E8` | `#3A2312` | tinted backgrounds |
| `--k-accent` | brand, or the project's | lighter project accent | buttons, borders, rings |
| `--k-accent-ink` | `#A64808`, or the project's | = accent | the accent **as text**: links, ghost buttons, tabs, chips |
| `--k-ink` / `--k-muted` / `--k-faint` | `#1C1917` / `#57534E` / `#78716C` | `#F5F5F4` / `#C9C4BF` / `#A8A29E` | text |
| `--k-surface` / `--k-surface-2` / `--k-page` | `#FFFFFF` / `#F5F3F0` / `#FAF8F5` | `#1F1B19` / `#292421` / `#141110` | backgrounds |
| `--k-border` / `--k-border-strong` | `#E7E5E4` / `#A8A29E` | `#3A3532` / `#6B6560` | lines, input borders |
| success / warning / danger / info | `#15803D` / `#B45309` / `#B91C1C` / `#1D4ED8` | `#4ADE80` / `#FBBF24` / `#F87171` / `#93C5FD` | status text, with `*-tint` backgrounds |

Project accents (light / dark):
- LadWani maroon `#7C2D12` / `#F4A68C`
- Education teal `#0F766E` / `#5EEAD4`
- TaskList indigo `#4338CA` / `#A5B4FC`
- Environment green `#15803D` / `#4ADE80`

Contrast, as `tests/kesari-ui.test.js` computes it (WCAG relative luminance):

| Pair | Ratio |
|---|---|
| white on brand `#C2560A` | 4.54 |
| brand `#C2560A` as text on page `#FAF8F5` | **4.28: fails AA**, hence `--k-accent-ink` |
| `#A64808` on page | 5.6 |
| white on LadWani / Education / TaskList accent | 10.2 / 5.5 / 7.9 |
| ink on page | 16.6 |
| muted on page | 7.2 |
| status colours on their tints | ≥ 4.9 |
| dark: ink-coloured text on every dark accent | ≥ 5.9 |

Dark mode follows `prefers-color-scheme` unless the theme toggle pins `data-theme="light|dark"`, stored in `localStorage` (`kesari.theme`) with every access wrapped in try/catch. The values chosen by the system and by the toggle are tested to be identical.

## Type, space, shape

- **Fonts:** Mukta for UI and body; Tiro Devanagari Marathi for hub display headings (`.k-display`).
- **Size:** base 16 px, 17 px when `<html lang>` is `mr` or `hi`; line-height 1.6.
- **Scale 1.25:** `--k-text-xs` .8rem … `--k-text-3xl` 2.441rem.
- **Space:** a 4 px grid, `--k-1` 4 px … `--k-16` 64 px.
- **Radius:** 8 / 12 / 20 px.
- **Elevation:** three levels.
- **Targets:** `--k-target` 48 px. Every button, input, nav link and tab is at least 48 × 48.
- **Focus:** a 3 px saffron outline with 2 px offset on `:focus-visible`, never removed. Reduced motion is honoured.

## Components (all on `/styleguide/` with their states)

| Component | Class | States shown |
|---|---|---|
| App shell header | `/shared/menu.js` (`.ks-bar`) | home / in-project accent, tier badge, switcher open, signed in / out, EN / MR / HI, ≤ 360 px |
| Project switcher | `.ks-switch` (`<details>`) | closed, open, current project |
| Bottom nav (phones, ≤ 4 items), side nav (desktop) | `.k-bottomnav`, `.k-sidenav` | current page |
| Buttons | `.k-btn` + `--brand --secondary --ghost --danger --sm --block --icon` | default, hover, focus, disabled, loading (`aria-busy`) |
| Inputs with inline validation | `.k-field .k-label .k-input .k-hint .k-error` | default, focus, disabled, error (`aria-invalid` + message) |
| OTP input | `.k-otp[data-k-otp]` | per-digit boxes, paste/autofill fills all, arrow keys |
| Select / search | `.k-select`, `.k-search` | default, focus |
| Cards, tiles | `.k-card`, `.k-card--link`, `.k-tile` | default, hover |
| Tables → stacked cards on phones | `.k-table--stack` + `data-label` | wide, ≤ 700 px |
| Tabs | `.k-tabs` (`role=tab` or links) | selected |
| Modal / bottom sheet | `<dialog class="k-dialog">` + `Kesari.openDialog` | modal ≥ 640 px, sheet below; Esc closes, focus returns |
| Toast | `Kesari.toast(msg, {kind, action})` | info, success, danger, with action |
| Badge / status chip | `.k-badge`, `.k-chip--live --beta --soon --danger --accent` | — |
| Avatar | `.k-avatar` | initials, image, large |
| Stepper | `.k-stepper` | done, current |
| Empty state | `.k-empty` (illustration + one action) | — |
| Skeleton | `.k-skel--line --card` | animated, still under reduced motion |
| Pagination | `.k-pager` | current |
| File upload with preview | `.k-upload` | default, hover/drag, focus |
| Tree node (LadWani) | `.k-node`, `--spouse`, `--expired` (dashed, grey background, †; never faded below AA) | expanded |
| Banner / alert | `.k-banner--success --warning --danger --brand` | — |
| Progress ring | `.k-ring` with `--p` | 0–100 |

## Runtime (`kesari.js`, `window.Kesari`)

- **Theme:** `setTheme`, `currentTheme`.
- **Language:** `setLang` (stores `kesari.lang` and the cookie `k_lang`, Path=/, so the server-rendered hub and Laravel can read it), `t(key, vars)`, `add(lang, dict)`, `[data-i18n]` / `[data-i18n-attr]` swapping, and the `kesari:lang` event.
- **Formatting, always IST and Indian conventions:**
  - `formatDate` → "3 Nov 2026"
  - `formatTime` → "08:42 AM IST"
  - `formatNumber` → "1,30,000"
  - `formatRupees`
  - `istToday`
- **UI helpers:** `toast`, `openDialog`, OTP wiring.
- **Storage:** every access to local storage goes through `Kesari.store` and is wrapped.

## Rules

1. No hard-coded user-facing strings in new screens. English is in the markup or the `en` dictionary; Marathi and Hindi follow key for key (tests check parity).
2. Show dates as "3 Nov 2026", times with "IST", and numbers grouped the Indian way (1,30,000).
3. Every list has loading (`k-skel`), empty (`k-empty`) and error (`k-banner--danger`) states. Every form has inline errors in the person's language.
4. No inline scripts on the hub or TaskList (CSP `script-src 'self'`).
