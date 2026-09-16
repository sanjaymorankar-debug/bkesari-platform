# Education Accountability Platform

A national school-quality, complaint, and accountability platform: parents and students can search schools, submit **faceless (anonymized) complaints**, rate schools, and confirm whether issues were actually resolved — while schools and government officers work the case without ever seeing the submitter's real identity.

**Live (test):** https://edutest.agtci.com
**Stack:** Laravel 13, Livewire/Volt, Tailwind, MySQL (Hostinger) / SQLite (local dev)

This is a large spec built incrementally — see [`ROADMAP.md`](ROADMAP.md) for exactly what's built vs. deliberately deferred, and don't take this repo as feature-complete against the original brief.

## What's actually here

- Auth + RBAC for 12 spec roles, each with a real working dashboard (Parent, Student, Teacher, School Admin, District/State Officer, National Admin, Researcher, System Admin)
- Public school registration (`/schools/register`) — the registrant becomes School Admin immediately; the school itself stays `pending` until a District/State Officer verifies it
- Self-service parent/student/teacher onboarding (`/onboarding`) — link your account to a school; the link stays `pending` until the School Admin approves it
- School Admin dashboard includes a "Pending Verifications" queue; District Officer dashboard includes a "Pending School Registrations" queue
- Public school search, school profile pages, per-teacher rating
- Faceless complaint system with real identity anonymization (see [`SECURITY_PRIVACY.md`](SECURITY_PRIVACY.md))
- Resolution-confirmation workflow ("was your issue *actually* resolved?")
- Retaliation reporting — a separate, prioritized-review workflow for parents/students who face retaliation after a complaint
- School Quality Index and Teacher Effectiveness Index, both with admin-configurable weights (Teacher scores are private to the teacher — never public, never shown to the school); TEI blends in an approximate value-add component from admin-entered `student_academic_records`
- Formal appeals workflow — one appeal per resolved/escalated complaint, reviewed by a State Officer one level above whoever handled the original complaint
- Two-factor authentication (TOTP) for School Admin and officer/admin roles, with a real login challenge and single-use recovery codes
- Real notifications system — relationship approvals, complaint status changes, invitation acceptance, and appeal decisions all notify the relevant user, with an unread-count bell in the nav
- Admin panel: rating weights, complaint categories, audit log + identity-access log viewer, fraud-flag review queue, role/permission management, moderation-threshold configuration
- Anti-manipulation flagging — a coordinated-feedback-burst heuristic wired into a real review queue, admin-configurable thresholds
- Analytics-snapshot infrastructure for the National/Researcher dashboards and the State Officer dashboard's summary numbers — scheduled recalculation instead of a live query on every page load
- Advisory AI-assist (rule-based, no model configured yet): category suggestion and possible-duplicate detection on the complaint form, possible-duplicate detection on the retaliation and school-registration forms — never auto-applied, always overridable
- A hard reason-required gate before any officer can reverse an anonymized identity, with mandatory audit logging
- **Fee transparency** — a per-year fee register with a required reason on any mid-year change, and an estimated cost that separates first-year from continuing-year and mandatory from optional, instead of one misleading total. Change history is public
- **Facilities: claimed vs experienced** — schools list what they offer against a canonical taxonomy; verified parents and students report anonymously what they actually find. Gaps show as a *reported difference*, never an accusation, and nothing is labelled below three independent reports
- **Course ratings** — section 12's ten curriculum dimensions, with a response count on each: students answer all of them, parents only the ones they are actually in a position to see. A course can score well overall and badly on practical learning, and the platform shows that rather than averaging it away
- **Improvement over time** — a public trend view comparing a school against its own history, because a school that started badly and improved is doing something a snapshot cannot show. Directions are only claimed with two years and enough responses behind them, and rising complaint volume is explicitly never scored as a decline — it may mean families finally trust the process
- **How India compares** — a structural comparison layer, not a scoreboard. The page opens by saying there is no Indian PISA score to show, keeps platform-measured numbers visibly separate from published descriptions of what other systems do, and flags any figure whose coverage is too thin to read as representative
- **Safeguarding & mandatory reporting** — serious concerns about a child travel a hardened path separate from ordinary complaints. A school's administration never sees them, a POCSO case cannot be closed until an external report to the police or SJPU is recorded, and the platform states the legal duty up front without ever claiming to discharge it
- **Health & wellbeing** — consent-gated screenings with a follow-up lifecycle so a finding can't be quietly lost; teacher observations kept structurally apart from clinical notes, because teachers must never diagnose; and a counsellor tier where raw session notes stay with the counsellor and guardians see a summary written for them
- **Student growth, career & life readiness** — a dated, multi-source record of what each child is doing well and where they need support (aligned to NEP 2020 / PARAKH's Holistic Progress Card), a shared teacher–parent growth plan, and exploratory career-interest and life-skills tracking. Deliberately carries no score, no ability label and no assigned career track; see [`STUDENT_GROWTH_FRAMEWORK.md`](STUDENT_GROWTH_FRAMEWORK.md)
- **DPDP Act 2023 Section 9 consent layer** — per-child, per-purpose guardian consent, granted only by a school-verified guardian, withdrawable instantly without a reason. Nothing in the growth/career modules is collected or shown without it, and government roles have no path to an individual child's record at all
- Full audit logging + identity-access logging

## Quick start (local dev)

See [`SETUP.md`](SETUP.md).

## Deploying

See [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Docs index

- [`SETUP.md`](SETUP.md) — local development setup
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Hostinger deployment steps
- [`DATABASE.md`](DATABASE.md) — schema overview
- [`SECURITY_PRIVACY.md`](SECURITY_PRIVACY.md) — identity-separation design, what's hardened vs. not yet
- [`STUDENT_GROWTH_FRAMEWORK.md`](STUDENT_GROWTH_FRAMEWORK.md) — the growth/career modules' non-negotiable rules (no labeling, no streaming, no bias inputs, consent gating). **Read before extending those modules**
- [`TESTING.md`](TESTING.md) — how to run the test suite, what's covered
- [`TEST_ACCOUNTS.md`](TEST_ACCOUNTS.md) — demo login credentials (synthetic data only)
- [`ROADMAP.md`](ROADMAP.md) — what's deferred to later phases, and why
