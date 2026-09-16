# Roadmap — what's deferred, and why

## Phase 4 (current) — Student Growth, Career & Life Readiness

The spec was revised (v2) to extend the platform past accountability into each child's development:
capability mapping aligned to NEP 2020 / PARAKH's Holistic Progress Card, a teacher–parent–student
growth loop, and exploratory career/life-skills tracking — all sitting on a DPDP Act Section 9
consent layer that did not exist before. That's what this phase built (spec sections 15–17, 40).

Shipped: `consent_records` + `ConsentService` (per-purpose, verifiable-guardian-only, withdrawable);
`capability_observations` with the 360-degree observer model and peer moderation;
`growth_plans`/`growth_goals` with the share-and-acknowledge loop; `career_interest_profiles` with
read-time-only pathway suggestions; `life_skills_tracking`; `DevelopmentAccessService` implementing
section 20's access matrix; four policies; guardian consent screen, shared growth view, observation
entry, plan management, career exploration and life-skills screens; two new roles (`career_mentor`,
`data_protection_officer`); and 35 tests covering the consent gate, access boundaries, and the
no-labeling/no-bias rules.

**The rules these modules must not break are documented in
[`STUDENT_GROWTH_FRAMEWORK.md`](STUDENT_GROWTH_FRAMEWORK.md) — read it before extending them.**

Still open in this area:

- **Peer observation UI.** Model, moderation workflow and policy support it; no screen collects it
  yet. Deliberate — it's the highest-risk surface here and should follow real usage of the rest.
- **`alumni_outcomes` (spec §17 post-school).** Not built. Needs its own separate opt-in consent
  flow, which is distinct work.
- **Aggregate government views of growth/career trends (spec §32).** Not built. Must be anonymised
  aggregates that never select an individual `student_user_id` — `DevelopmentAccessService` has no
  officer branch by design, and adding one would be the wrong fix.
- **Bias review checkpoint.** Spec section 45 Phase 6 asks for an explicit bias review and a narrow
  single-school pilot before general availability. The automated gender-parity test is a regression
  guard, not that review. **This module should not be switched on widely until that review happens.**
- **Class rosters.** "A teacher's students" currently resolves to school-level enrolment, which is
  wider than the spec's per-subject intent. Documented in `STUDENT_GROWTH_FRAMEWORK.md`.

---

## Phase 5 — School core: UDISE, fees, facilities

Spec Phase 1 (sections 5, 8, 9, 11, 12). Shipped: `udise_code` on schools with a
non-mass-assignable verification; the fee register with per-year history, in-year `fee_revisions`
requiring a reason, and `AnnualCostCalculator` producing separate first-year and continuing-year
totals; the canonical `FacilityTaxonomy` shared by claims and ratings; `facility_claims`
(versioned per year, evidence-gated verification) and anonymous `facility_ratings`; and
`ClaimedVsExperiencedService` implementing section 11's comparison with a 3-report floor before
anything is labelled at all.

Still open in this area:

- **Evidence file uploads on facility claims.** `evidence_path` exists on the table; only the text
  note is wired up. Needs the same malware-scan/size-limit treatment complaint evidence gets.

---

## Phase 6 — Safeguarding, exams & coaching, health & wellbeing

Closes spec Phase 1 and Phase 5, and fills the Phase 4 gap left when the growth modules were
built out of order.

**Safeguarding (§25).** Its own table, event trail and access rules, separate from complaints.
School administrators cannot see these cases at all; a POCSO-engaging case cannot be closed until
an external report to police/SJPU is recorded; and the platform records that it surfaced the legal
duty without ever implying the duty was discharged.

**Exams & coaching (§10).** Completes Phase 1. The useful part is the feedback into §9: a
compulsory programme billed outside the fee register is shown as a cost the published totals don't
include.

**Health & wellbeing (§18–21).** Consent-gated screenings with a real follow-up lifecycle,
teacher observations structurally separated from clinical notes, a counsellor tier where raw notes
never leave the counsellor, and an append-only access log that records refusals too.

Still open in this area:

- **Document uploads on health records (§18, §21).** The spec asks for malware-scanned,
  access-controlled medical reports served outside public URLs. Not built; records are structured
  fields only.
- **A counsellor caseload view.** `HealthAccessService::caseloadStudentIds()` exists and is
  unused; the portal is driven by the observation queue instead.
- **Retention *enforcement* (§21, §40).** Per-category retention periods are declared in
  `App\Support\DataRetention` and drive data-subject erasure, but nothing sweeps records past their
  retention period automatically yet. That needs a scheduled job and a policy decision about what
  "past retention" means for a child who has left the school.
- **Retention periods need legal review.** The figures in `DataRetention` are a starting position,
  not legal advice, and the 30-day response window on a data-subject request is a working
  assumption rather than a statutory figure. Both should be checked against the DPDP Rules as
  finalised and the deployment state's own record-keeping obligations.

---

## Phase 7 (partial) — International benchmarking

Spec section 3, the "How India Compares" view. Built as a **structural and aggregate** comparison
layer, never a score table.

- `benchmark_references` has no score, rank or numeric column at all — rule 44 enforced by the
  schema rather than by policy, with a test asserting none is ever added.
- The page leads with "There is no Indian PISA score on this page" rather than burying the
  limitation, and states plainly what it deliberately does not do.
- Platform-measured numbers and structural practice are separately typed and separately rendered,
  each measure carrying its provenance and coverage. With ~20 seeded schools every percentage is
  flagged "too little data to read as representative", which is the correct behaviour, not a bug.

**Needs a human before this goes public:** every seeded citation lands with `source_verified =
false` and the page says so. Someone has to check each reference against the actual published
source and set the flag. The rows describe structural practice drawn from the specification's own
reference list; they have not been verified against the originals.

Aggregate health and wellbeing statistics for government (§20, §32) are now computed by
`HealthAggregateService` with small-cell suppression, closing the gap where the access matrix
correctly gave officers nothing individual but nothing anonymised either. They surface on the
District, State and National dashboards through one shared component, so the wording and the
suppression treatment cannot drift apart between them.

Still open in Phase 7: NAS data is not integrated (no public
dataset wired in); and the AI-assist layer (§28) remains stubbed pending an API key.

## Phase 8 (partial) — Accessibility

Spec section 33 / RPWD Act 2016, with WCAG 2.1 AA as the technical baseline. An audit of the
platform's own markup found and fixed five real failures: no skip-to-content link (2.4.1), one
shared page title across every page (2.4.2), confirmation messages announced only visually
(4.1.3), rating scales where a screen reader heard "1, radio button" with no idea what was being
rated (1.3.1 / 3.3.2 / 4.1.2), and visually hidden radios with no focus state (2.4.7). The rating
fix lives in one shared `<x-rating-scale>` component so both rating forms cannot drift apart.

**What this is not.** These are regression guards written against specific criteria, not an
accessibility audit. Nothing here has been tested with an actual screen reader, magnifier or
switch device, colour contrast has not been measured across the palette, and the forms have not
been walked keyboard-only end to end. Spec section 38 asks for a real audit before deployment and
that still has to happen with assistive technology and, ideally, disabled users.

Note also that the skip link's focus behaviour was verified by inspecting the compiled CSS rule
rather than visually: the automated browser pane does not hold window focus, so `:focus` never
matches inside it.

---

## Multilingual (§33) — deliberately on hold

**Decision: not started, pending professional translators.** The spec asks for twelve languages.
The architecture is straightforward; the content is not. This platform carries two categories of
text where an unreviewed translation is worse than English:

- the **POCSO Act section 19** mandatory-reporting notice, which tells a reporter that filing here
  does not discharge their legal duty to go to the police;
- the **DPDP Act section 9** consent notices, which are the legal basis on which a child's health,
  wellbeing and capability data is collected.

A parent may act on either. Machine-translating them into twelve languages without review is a
risk the platform should not take on a guardian's behalf, and shipping a half-translated interface
would be worse UX than English alone. Held until reviewed translations are available; the i18n
scaffolding should be built at the same time so translated strings land in a structure that fits
them, rather than being retrofitted around English.

Also not started: the alumni-outcomes module (§17).

---


The original spec for this platform is a multi-month, national-scale system (50+ tables, national gov analytics, AI moderation, teacher value-add scoring, anti-manipulation ML, a full 12-document security/privacy test regime). Phase 1 was a **fully working, fully tested core vertical slice**. Phase 2 added the remaining dashboards, an admin panel, retaliation reporting, the Teacher Effectiveness Index, and a first pass at AI-assisted features. Phase 3 (this update) closed out nearly everything Phase 2 had marked deferred or partial: 2FA, a hard identity-access reason gate, a formal appeals workflow, analytics-snapshot infrastructure, a real notifications system, the TEI value-add component, account-level fraud flagging wired into a real review queue, admin role/permission management, and attempted real mail delivery. This file lists what's still deliberately left out, so it's never mistaken for "built but broken."

## Deferred entirely (not built, not stubbed)

- **Real AI provider integration** — `AIAssistService` (category suggestion, duplicate detection across complaints/retaliation reports/schools, summarization, feedback-spike detection) is entirely rule-based/heuristic; no AI API key is configured for this environment (a deliberate choice — see "Decisions" below). The service is the intended integration seam — swapping in a real model call means editing that one class, not call sites.
- **Translation / sentiment-theme analysis** — part of spec's AI-assisted features list, not built even as a heuristic. Blocked on the same missing AI provider key as above.
- **Classroom-observation and professional-development components of the Teacher Effectiveness Index** — spec section AD describes these as additional TEI inputs beyond feedback and value-add; this build has no data source for either (no observation records, no PD tracking), so they're not approximated.

## Partially built

- **Student dashboard** — fully functional but reuses the Parent dashboard's visual language rather than a dedicated age-appropriate design pass (simplified language, safety-resource links). Cosmetic, still on the list if it becomes a priority.
- **Analytics snapshot infrastructure** — National and Researcher dashboards, and the State Officer dashboard's top-line summary numbers, now read from `analytics_snapshots` (populated by `php artisan analytics:recalculate`, scheduled hourly in `routes/console.php`) instead of live-querying on every page load, with a same-request fallback (compute + save) if no snapshot exists yet, and a manual "Recalculate now" button. The State Officer's complaint list and retaliation queue below that summary stay live-query on purpose — those are actionable queues, not reports, and must reflect the current record set exactly. The hourly schedule needs an actual OS cron entry calling `php artisan schedule:run` every minute on the host — see `DEPLOYMENT.md` for whether that was confirmed working.
- **Mail delivery** — Mailable classes now exist (`StaffCredentialsMail`, `SchoolInvitationMail`) and are sent via `Mail::to()->send()` for: school-registration additional-staff invites, school-initiated member invitations, and parent-registered new-child accounts. Production `.env` was switched to `MAIL_MAILER=sendmail` (Hostinger's local relay) per the user's choice — no external SMTP credentials needed. **Delivery is not guaranteed**: shared-hosting sendmail relays are commonly rate-limited or land in spam, and every send is wrapped in try/catch (`SendsMailSafely` trait) so a mail failure never breaks the underlying flow. All three flows still show the credential/invite-link on-screen as the reliable fallback — treat mail as a convenience, the on-screen value as the source of truth.

## Closed since last update

- **2FA for officer/admin accounts** — TOTP-based (`pragmarx/google2fa`), manual secret-key entry (no QR image library), 8 single-use recovery codes, available to School Admin and all four government-officer roles via Profile → "Two-Factor Authentication" → Manage. Login redirects to a separate challenge step when enabled; the user is not considered authenticated until that step passes.
- **Government identity-access "reason required" hard gate** — `IdentityResolutionService::resolve()` now requires a non-empty reason and throws a validation exception without one; there is no code path to reveal an identity without one, and every reveal is still logged to `identity_access_logs`. The Complaint detail page's "Reveal Submitter Identity" panel surfaces this as a real reason field, not just a soft prompt.
- **Formal appeals workflow** — beyond the resolution confirmation's escalate-on-"no" path. A submitter can file one appeal per complaint (`/appeals/create/{complaint}`) once it's escalated/resolved/closed; a State Officer (or National/System Admin) — deliberately one level above whoever handled the original complaint, so a District Officer cannot review an appeal against their own district — reviews and upholds/denies it with a decision note. The submitter is notified of the outcome.
- **Real notifications system** — the `notifications` table (present since Phase 1) is now actually written to. Four events notify the relevant user: a relationship being approved, a complaint status change (school responds/proposes resolution → notifies submitter; submitter confirms → notifies school staff), an invitation being accepted (notifies the inviter), and an appeal being decided (notifies the submitter). A bell icon with an unread count sits in the main nav, linking to `/notifications` (list, mark-one-read, mark-all-read).
- **Anti-manipulation detection wired to a real review queue** — `AIAssistService::detectFeedbackSpike()` now runs on every school-feedback and teacher-feedback submission, creating a `fraud_flags` row (advisory only, never auto-penalizing) when a school or teacher gets an unusual burst of submissions. System Admin reviews flags at `/admin/fraud-flags` (open/reviewing/confirmed/dismissed workflow), and the window/threshold are admin-configurable at `/admin/moderation` (backed by a generic `settings` table).
- **Value-add component of the Teacher Effectiveness Index** — `student_academic_records` (School Admin-entered subject/term/score) now feeds a second TEI component: each student's earliest-vs-latest recorded score in the teacher's own `subject_specialization`, at a school the teacher is verified at, averaged and blended as 20% of the final score when data exists (80% feedback, unchanged, when it doesn't). Explicitly documented in the service as an approximation — there's no real teacher-to-student roster linkage in this build, it's a school+subject proxy.
- **Admin role/permission management** — `/admin/roles`: a role × permission matrix (toggle any of the 10 roles' permissions — the role *names* themselves stay code-defined, since route middleware and policies key off them directly) plus a per-user role search/assign/remove tool.
- **AI-assisted suggestions extended beyond the complaint form** — possible-duplicate detection now also runs on the retaliation-report form (compares against other retaliation reports at the same school) and the school-registration form (warns if a similarly-named school already exists in the same city, to catch accidental duplicate registrations). Teacher-feedback submissions now run the same feedback-spike check as school feedback. Category suggestion stays complaint-only — retaliation categories are a fixed enum, not the admin-editable `complaint_categories` table it matches against.

## Decisions made this round

- **AI provider**: kept rule-based/heuristic rather than integrating a real model — no API key was available, and the user chose to defer rather than block this round on acquiring one.
- **Mail delivery**: Hostinger's local sendmail relay over a third-party SMTP provider — no external credentials to manage, at the cost of no delivery guarantee (see "Partially built" above).

## Full doc set

Spec asked for 12 docs; this build ships 8 (`README`, `SETUP`, `DEPLOYMENT`, `DATABASE`, `SECURITY_PRIVACY`, `TESTING`, `TEST_ACCOUNTS`, `ROADMAP`). `API.md`, `ADMIN_GUIDE.md`, `USER_GUIDE.md`, `TROUBLESHOOTING.md`, `ENVIRONMENT.md` still aren't written — there's no public API, and the admin panel is real but small enough that a dedicated guide would mostly restate this file.

## Suggested next phase order

1. Confirm the `analytics:recalculate` cron entry is actually running on the host (see `DEPLOYMENT.md`) — the manual "Recalculate now" button and same-request fallback mean the dashboards work either way, but scheduled freshness needs the real cron.
2. Confirm production mail deliverability in practice (check spam placement, bounce rate) — if Hostinger's sendmail relay proves unreliable, revisit with a transactional email provider.
3. Account-level anti-manipulation detection beyond feedback-timing (e.g. coordinated multi-account patterns) — should follow, not precede, having enough real usage data to design against.
4. Real AI provider integration behind `AIAssistService`, once an API key is available.
5. Student dashboard age-appropriate design pass.
