# Phase 1.13 — Development Roadmap

## 0. Honest Scope Framing

This is, in real engineering terms, a multi-month build for a small team — a full booking marketplace, a payment/refund/reconciliation system, a financial ledger, and a family-tree/matrimony/social platform are each independently substantial products. Building all of it correctly (not superficially) in one continuous pass isn't realistic, which is exactly why the brief itself calls for phased delivery with a checkpoint after each phase. This roadmap takes that literally: each milestone below ends with a working, tested slice — not a stub — before the next one starts.

## 1. Migration Decisions (confirmed)

This builds into the **existing `sanjaymorankar-debug/miladwani` repo and `devmiladwani.agtci.com` deployment**, which currently runs a live, working family-registry app with real registered users. Two decisions were open at the end of Phase 1 review and are now settled:

- **Database engine: MySQL** (Hostinger's inbuilt, same server as the app). Chosen over an external managed Postgres (e.g. Neon) specifically for latency — a local MySQL connection has no network round-trip, while a remote Postgres service adds one on every query plus, on free tiers, a multi-second cold-start after idling. The schema catalog (`06-database-schema.md`) and diagrams (`05-er-diagrams.md`) already reflect this: string/cuid primary keys instead of native UUID, `JSON` columns instead of native arrays, and the polymorphic-relationship rule in §J of the schema catalog applies regardless of engine.
- **Existing data: deleted, not migrated.** The live site's current users/families/data will be wiped when this build goes live — a clean start on the new schema, not a migration script. This is the point flagged as destructive back in Phase 1: it happens once, deliberately, at the actual cutover in M5, not before. Nothing before that point touches the live database or repo.

## 1a. What This Means Concretely for M0–M5

M0 will build and test against a **fresh local/staging MySQL database** — not the live one. The live repo and live database are only touched once, at the end of M5, as an explicit, confirmed cutover step: deploy the new build, run the new schema's migrations against the live MySQL database (which requires first truncating/dropping the old tables — the actual destructive action), and go live. That step gets its own explicit go-ahead when M5 is ready, the same way every other step in this project has.

## 2. Milestones

Each milestone is a vertical slice: schema + API + UI + tests for that scope, matching the brief's own "test after every phase, fix before proceeding" instruction — applied per milestone rather than deferred to one giant Phase 7 at the end.

### M0 — Foundations (infra, no user-facing features yet)
- Monorepo scaffold: `apps/web` (Next.js + TS), `apps/api` (NestJS + TS), shared `packages/types`
- MySQL schema for Identity & Access + Family Registry & Tree domains (sections A–B of the schema catalog), migrations, seed data
- Auth: register/verify/login/refresh/logout, RBAC guard + permission decorator
- Privacy resolution engine (the algorithm in `09-privacy-architecture.md`) wired into the response serializer from day one, not bolted on later
- Approval engine (generic, no action types wired yet)
- Audit logging interceptor
- CI: lint, typecheck, test, build gates on every PR

### M1 — Family Registry, Tree & Directory
- Family create/join/verify flow (J1), duplicate detection (J11)
- Karta member management: add (new + link-existing), remove, status change (J2)
- Marriage linking (J3), deceased handling (J4)
- Family tree rendering (privacy-filtered, zoom/pan/search/export)
- Member directory search
- **Tests**: relationship creation/inverse correctness, Karta-vs-member permission boundaries, deceased members never hard-deleted, duplicate-check triggers correctly

### M2 — Matrimony & Community Social
- Matrimonial profile + preferences + search + interests (J5)
- Community feed: posts/comments/reactions/reports, area-scoped feed ranking
- Notifications (in-app + email) wired to the events introduced so far
- **Tests**: matrimony field visibility never leaks beyond configured level, moderation queue, feed scope filters

### M3 — Community Services & Booking
- Asset registration + verification workflow (via the approval engine)
- Asset search, detail, availability calendar
- Booking flow (instant + request), the availability-locking transaction from `11-booking-architecture.md`
- QR verification, reviews
- **Tests**: double-booking prevention under concurrent requests (this is the one to actually load-test, not just unit-test), booking state machine transitions, review-gate enforcement

### M4 — Payments, Fees & Financial Ledger
- Payment gateway abstraction + one real provider integration (Razorpay first, per market fit)
- Webhook handling, server-side verification, idempotency
- Community fee types/rules, fee invoices, Karta payment flow (J8)
- Offline payments + verification (J9)
- Donations
- Financial ledger, refunds, reconciliation
- **Tests**: duplicate webhook handling, payment retry, partial/split payments, refund math, reconciliation catches an intentionally-mismatched fixture

### M5 — Admin, Reporting & Hardening
- Admin config screens for every `[Cfg]` item across earlier milestones
- Approval queues UI (Operator/Admin), audit log viewer
- Reporting module (demographics/matrimony/services/financial) + CSV export
- Security review pass (OWASP checklist), rate limiting, upload validation/malware scanning
- Load/performance pass against the 10k-family/100k-member target
- Deployment documentation, backup strategy, production cutover plan — the explicit, confirmed live-database replacement described in §1a

## 3. Per-Milestone Checkpoint Report Format

Matching §89 of the brief, each milestone ends with:
- What was implemented (feature list against this doc's Feature Map)
- Files created/modified
- Database changes (migration files)
- APIs created
- Tests written and their pass/fail status
- Known issues / deferred items
- What's next

No milestone starts until the previous one's report is reviewed and you've said to proceed.

## 4. Immediate Next Step

This document set (Phase 1) is what's ready for your review: `01` through `13` in this `docs/` folder. Both open decisions from the first review (database engine, existing-data handling) are now resolved per §1 above. Once you confirm this Phase 1 plan matches your intent — anything to add, cut, or reprioritize — Phase 2 (detailed architecture: system diagrams, finalized API contracts, auth/storage/payment implementation design) starts, followed by M0.
