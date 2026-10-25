# Phase 1.8 — Screen / Wireframe List

Full wireframes are a Phase 3 deliverable; this is the confirmed screen inventory each dashboard is built from, per the brief's numbered list (§82 Phase 3, §71 navigation, §55-57 dashboards).

| # | Screen | Primary role(s) | Key components |
|---|---|---|---|
| 1 | Landing page | Anonymous | Value prop, sample (anonymized) community feel, login/register CTAs |
| 2 | Login | All | Identifier+password, forgot-password link |
| 3 | Registration | All | Account form → OTP step → existing-vs-new-family choice |
| 4 | Member dashboard | Member | Profile completeness, family snapshot, feed preview, notifications, quick links |
| 5 | Karta dashboard | Karta | Family snapshot, pending approvals on their family, fee status, family bookings |
| 6 | Family profile/dashboard | Member/Karta | Family info card, member grid, address, Kuladevata/Gotra, action bar (add member, view tree, pay fees) |
| 7 | Family tree | Member/Karta | Zoomable/pannable canvas, node = photo+name+age+relationship+marital badge, search-within-tree, print/export |
| 8 | Member profile | Member/Karta/Operator/Admin | Photo, identity, education/employment/skills (visibility-filtered), family link, matrimony link if visible |
| 9 | Family profile (public view) | Any authenticated | Same as #6 but visibility-filtered for a non-member viewer |
| 10 | Member search | Member | Filter panel + paginated result grid, each card links to #8 |
| 11 | Matrimony hub | Member | My-profile status card, search/filter panel, result grid |
| 12 | Matrimony profile detail | Member | Field-filtered detail, Send Interest / Request Contact / Save / Report |
| 13 | Community feed | Member | Scope tabs (My Area/City/Community), post composer, post cards with comment/react |
| 14 | Community Services directory | Member | Category tiles → filterable asset grid |
| 15 | Asset detail | Member | Gallery, facilities, map, pricing table, availability calendar, reviews, Book button |
| 16 | Booking flow | Member | Date/slot picker → add-ons → price breakdown → confirm |
| 17 | Payment checkout | Member | Method selection, gateway redirect/embed, post-payment status page (polls server verification, never trusts the redirect alone) |
| 18 | Community fees | Karta | Outstanding table, Pay Now, history, receipt downloads |
| 19 | Payment/booking history | Member/Karta | Unified list across fee/booking/donation payments, filter by type/date |
| 20 | Operator dashboard | Operator | Queues: family approvals, member-change approvals, asset verification, offline-payment verification — scoped to assigned area |
| 21 | Asset Owner dashboard | Asset Owner | My assets, calendar, pending requests, revenue snapshot, reviews |
| 22 | Admin dashboard | Admin | KPI grid (§53), quick links into every config/report screen |
| 23 | Approval workflow screen | Operator/Admin | Shared component: item detail, duplicate-check panel, decision + reason, used across every approvable action type |
| 24 | Asset registration/edit | Asset Owner | Multi-step form: details → location → photos → facilities/capacity → pricing → policies → submit |
| 25 | Admin configuration screens | Admin | One consistent CRUD-table pattern reused for: roles/permissions, relationship types, statuses, education levels, occupations, skills, areas, post types, asset categories/facilities, fee types/rules, financial years, discounts/waivers/late-fee rules, notification rules |
| 26 | Reports | Admin/Operator | Report picker → filter bar → chart+table → CSV/Excel export |
| 27 | Privacy & consent center | Member | Per-field visibility controls, consent history, data export/correction/deactivation/deletion request |
| 28 | Notifications | All | Chronological list, mark-read, deep-link to source |

## Responsive Requirements

- Mobile-first layout; the family tree (#7) is the one screen that needs a dedicated touch-interaction design pass (pinch-zoom, drag-pan) rather than a simple reflow.
- Every table-heavy admin/report screen (#25, #26) collapses to a card list below tablet width — never a horizontally-scrolling table as the only mobile option.
