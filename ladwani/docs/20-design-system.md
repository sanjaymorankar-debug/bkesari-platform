# Phase 3.0 — Visual Identity & Design System

Translating the brief's "Modern, Trustworthy, Indian/community-oriented, Professional, Simple, Clean, Mobile-first... avoid looking primarily like a dating app" into concrete, reusable tokens.

## 1. How "not a dating app" actually gets enforced

Not a style note — a structural rule: **rose/pink is scoped exclusively to the Matrimony module's own components** (interest buttons, matrimony badges). It never appears in the global nav, dashboards, family tree, or any other module's chrome. If a screen outside Matrimony ever reaches for the rose token, that's a design-system violation, not a stylistic choice.

## 2. Palette

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F5F0` (warm parchment, not stark white) | `#14171F` | Page background |
| `--surface` | `#FFFFFF` | `#1C202B` | Cards, panels |
| `--ink` | `#1B1F2E` | `#EDEBE4` | Primary text |
| `--ink-muted` | `#5C6070` | `#9AA0B0` | Secondary text |
| `--border` | `#E4E0D6` | `#2A2E3B` | Hairlines, dividers |
| `--primary` | `#1E2A5A` (deep indigo — institutional trust) | `#7C8CC4` | Primary actions, links, headers |
| `--accent` | `#E0902C` (marigold — warmth, festivity, community) | `#F0A94E` | CTAs, highlights, active states |
| `--success` | `#2F8F5B` | `#4FAF78` | Verified, paid, confirmed |
| `--warning` | `#C97A22` | `#D99248` | Pending, due soon |
| `--danger` | `#B23A3A` | `#D1615F` | Overdue, rejected, deceased-marker |
| `--matrimony` | `#B85C72` (scoped, see §1) | `#C97D90` | Matrimony-only accents |

Semantic colors (success/warning/danger) are separate from `--accent` — a status pill is never confused with a call-to-action.

## 3. Typography

| Role | Face | Fallback | Notes |
|---|---|---|---|
| Display (H1, family/member names in headers, hero) | **Fraunces** | Georgia, serif | Used with restraint — page titles and identity moments only, not body copy |
| UI / body | **Work Sans** | -apple-system, sans-serif | All labels, paragraphs, nav, forms |
| Data (amounts, IDs, receipt numbers, dates in tables) | **IBM Plex Mono** | ui-monospace, monospace | `font-variant-numeric: tabular-nums` wherever digits line up in a column |

Type scale: 12 / 14 / 16 / 20 / 26 / 34 / 44px, one step of the scale per UI hierarchy level — never an arbitrary in-between size. Body copy line length capped near 65 characters in prose contexts (privacy center, about sections).

## 4. Shape & Elevation

- Corner radius: 10px for cards, 8px for inputs/buttons, 999px (full) only for status pills and avatars — deliberately not "rounded-lg on everything," which reads as templated.
- Elevation via a single soft shadow token (`0 1px 3px rgba(20,20,30,.08)`) plus a 1px border — cards are grounded by a border, not floating purely on shadow.
- Photos (member/family) are the one place a slightly larger radius (14px) signals "a person," distinct from data-card geometry.

## 5. Status Language (used everywhere, not reinvented per module)

A single pill component with five semantic states, reused for member status, family verification, booking status, payment status, approval status:

```
ACTIVE/VERIFIED/PAID/CONFIRMED/APPROVED   → --success, filled
PENDING/UNDER_REVIEW/PROCESSING           → --warning, filled
REJECTED/DECLINED/FAILED/OVERDUE          → --danger, filled
DECEASED/INACTIVE/CLOSED                  → --ink-muted, outline only (quiet, respectful — never --danger red for a deceased marker)
DRAFT/UNPAID                              → --border, outline only
```

## 6. Navigation Pattern

Fixed left sidebar (collapsible on tablet, bottom tab bar on mobile) — one shared shell across Member/Karta/Operator/Asset-Owner/Admin, with the nav *item set* changing by role rather than five different shell designs. This is what makes "22 screens" feel like one product instead of five bolted-together apps.

## 7. Family Tree — the one screen with its own visual rules

- Living member node: photo (or initials avatar) + solid `--border` outline.
- Deceased member node: photo desaturated to 40%, dashed outline, small quiet marker (a diya/lamp glyph, not a skull or heavy red X) — respectful, not clinical.
- Marriage connector: a horizontal line with a small ring at the midpoint (a subtle nod to the mangalsutra/wedding-ring motif without being literal or twee).
- Karta: a thin `--accent` ring around their node, no badge clutter on the canvas itself (the badge shows on click-through to their profile, not on the tree node, which needs to stay legible at zoomed-out scale with 50+ nodes).

## 8. Iconography

One icon set throughout (Lucide, matching what's readable at small UI sizes) — no emoji as functional UI markers (a status pill's *color and label* carry meaning, not an emoji glued next to it). Emoji are acceptable only inside user-generated content (community post categories, exactly as scoped in Phase 1's post-type catalog), never in system chrome.
