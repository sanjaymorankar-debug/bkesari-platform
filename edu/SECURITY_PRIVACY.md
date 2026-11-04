# Security & Privacy

## Identity separation (the core design constraint)

A school or officer must never see a submitter's real name/email/phone directly on a complaint or rating.

```
users (real identity)
   |
   | anonymous_identities: (user_id, school_id, context) -> anonymous_ref
   v
complaints / school_feedback  — store anonymous_ref only, NO user_id column at all
```

This isn't a view or a hidden column — `complaints.anonymous_ref` and `school_feedback.anonymous_ref` are the *only* identity-shaped columns on those tables (verified by `AnonymizationTest::test_complaints_table_has_no_user_identifying_column`). A school admin's query can never accidentally join to `users`.

**Reversal is a single, audited code path.** `App\Services\IdentityResolutionService::resolve()` is the only place `anonymous_ref` is ever turned back into a `User`. It:
1. Requires the `access-protected-identity` permission (district/state/national officers + system admin only)
2. Requires a non-empty `reason` argument — throws a `ValidationException` without one, so there is no code path that reveals an identity without recording why
3. Writes one row to `identity_access_logs` (officer, anonymous_ref, action, reason, timestamp) on every call, whether or not the lookup succeeds

The Complaint detail page's "Reveal Submitter Identity" panel (visible only to users who both pass the `review` policy and hold `access-protected-identity`) surfaces this as a required reason field, server-validated at a minimum of 10 characters before the reveal proceeds. What's **not yet built**: a dedicated admin screen for browsing/searching identity-access logs beyond the general audit log viewer at `/admin/audit-log`.

## Audit trails (and why one of them records nobody)

Four trails, each with its own table:

| Trail | Table | Written by |
|---|---|---|
| General audit log | `audit_logs` | `AuditLog::record()` / `recordAnonymous()` |
| Identity reveals | `identity_access_logs` | `IdentityResolutionService::resolve()` |
| Health-record access | `health_access_logs` | `HealthAccessService::log()` |
| Safeguarding case events | `safeguarding_events` | `SafeguardingService::log()` |

Every **official decision** goes into `audit_logs` named against the person who
took it: an officer verifying a school (`school.recognition_verified`), a School
Admin approving or rejecting a parent/student/teacher link
(`relationship.approved` / `relationship.rejected`), answering or proposing a
resolution on a complaint, deciding an appeal, entering an academic record,
sending or revoking an invitation, and enabling or disabling 2FA. The officer
and school-side verification decisions are also stamped on the record itself
(`schools.recognition_verified_by_user_id`, `*_school_relationships.decided_by_user_id`),
and those columns are deliberately outside `$fillable` — `School::markRecognitionVerified()`
and `RecordsVerificationDecision::recordDecision()` are the only ways to set
them, so no mass-assigned update can forge a decision.

**Submitter actions are logged with no actor and no IP.** Filing a complaint,
rating a school or a teacher, reporting retaliation, filing an appeal and
confirming a resolution all write an `audit_logs` row through
`AuditLog::recordAnonymous()`, which never sets `user_id` or `ip_address`.
This is not an oversight to tidy up later. `complaints` and `school_feedback`
carry no `user_id` column precisely so that the link cannot be made (see above);
writing "user 7 confirmed complaint 3" — or user 7's IP next to complaint 3 —
into a table every System Admin can read at `/admin/audit-log` would rebuild
that link and hand it over, bypassing `IdentityResolutionService` and its
reason gate entirely. The row still records *that* the action happened, with
the `anonymous_ref`, which is safe: it is already on the record itself and
reversing it still goes through the audited service.

The same rule binds the **complaint timeline**.
`complaint_status_history.changed_by_user_id` names the member of staff or the
officer who moved a complaint's status, and never the submitter.
`Complaint::recordStatusChange()` drops a submitter's id before the row is
written, whatever the caller passes — enforced there rather than at the call
sites, so a future caller reaching for `Auth::id()` on a submitter-driven
transition cannot reintroduce the link. Submitter-driven transitions stay
legible from the note ("Submitter confirmed: yes"), which is what the timeline
renders; it never renders the actor. The rows written before that gate existed
were cleared by `2026_11_04_000001_clear_submitter_ids_from_complaint_status_history`,
which matched them by resolving each row's user against its own complaint's
`anonymous_ref` rather than by reading the note.

The timeline was not the only writer on the official side of a complaint, and
one person can hold two hats: a clerk or teacher whose own child attends the
school they work at is both staff and a verified parent, and an officer can be
a parent in their own jurisdiction. They may file a complaint, but they may not
then act on it officially — `ComplaintPolicy::respond()` and `::review()` refuse
a complaint the actor submitted, and the appeal screen's `canReview()` refuses
an appeal they filed. Without those, `complaint_responses.responder_user_id`,
`appeals.reviewed_by_user_id`, an `identity_access_logs` row from
`revealIdentity`, and an `audit_logs` row carrying the actor's **IP** would each
have named the submitter beside their own complaint, in tables the school and
every officer read — and the `audit_logs` one is not even data-layer only:
`/admin/audit-log` renders `actorLabel()`, so it would have shown the
submitter's **name** next to `Complaint #N`. Refusing the conflicted action,
rather than dropping the actor's id, keeps the accountability the trail exists
for: an official act is still always named (CR-22). Viewing is untouched — a
submitter still sees their own complaint and appeal — and another member of
staff can answer it.

`AuditLoggingTest` enforces this directly — if a future call site reaches for
`record()` where it should have used `recordAnonymous()`,
`test_no_audit_row_ever_names_a_user_alongside_a_complaint_or_feedback` fails.

**Safeguarding cases follow the same rule, and it matters most there.**
`safeguarding_reports` is anonymised exactly like `complaints` — an
`anonymous_ref` and no `user_id` — but its own row carries three actor columns
(`assigned_officer_user_id`, `external_report_acknowledged_by`,
`closed_by_user_id`), and `safeguarding_events.actor_user_id` records even an
*open*. The reporting form has a `staff` branch because staff do file these, so
a Child Safety Officer whose own child attends the school they work at can be
both reporter and handler. Any one of those columns naming the reporter would
rebuild the reporter→report link, in the most sensitive records the platform
holds, and POCSO section 19 is the reason this workflow separates reporting
from handling in the first place. So `SafeguardingService::canView()` refuses
the reporter outright — before the `system_admin` branch, which otherwise
passes everything — and `canManage()` inherits that refusal, which covers
acknowledging, recording the external report, starting an investigation,
adding a note and closing. The queue leaves the reporter's own case out rather
than offering a link that 403s. Unlike a complaint, a reporter was never an
audience for the case record: they follow it by the `reference` they were
given, and `canView()` has no owner branch by design.

The rule is stated once as a set of queries in
`tests/Feature/Platform/Concerns/AssertsAnonymityInvariants.php`: **no row may
name a user beside an anonymous record that same user submitted**, over all ten
relations that could carry such a link (complaint responses, the complaint
timeline, identity access, appeals, `audit_logs` for complaints and for
appeals, the three safeguarding columns and the safeguarding trail). Asserting
it as a query rather than per action is deliberate — the per-action tests only
cover the writers that exist today, and
`AnonymizationTest::test_the_submitter_link_invariant_detects_a_leak_in_every_relation_it_covers`
plants a leak in each relation in turn to prove the joins actually bite.

The rating side has the same two-hats problem with a different consequence. A
teacher whose own child attends the school they teach at is a verified teacher
*and* a verified parent there, which was all the shared-school check on the
teacher-rating form asked for — so they could file anonymous ratings of
**themselves**, repeatedly (`teacher_feedback` has no one-rating-per-rater
constraint), straight into the Teacher Effectiveness Index. Beyond the obvious
— an index the platform publishes must not be gameable by its own subject, the
same objection as "a school cannot verify itself" — the row carried
`teacher_user_id` beside an `anonymous_ref` resolving to the same person, so a
feedback row named its own submitter. The form now refuses the rater as their
own subject. Rating a school one works at is *not* refused: a verified parent's
view of their child's school is a genuine one, and `school_feedback` carries no
user column for it to leak.

## RBAC

`spatie/laravel-permission`, 10 roles matching the spec (public/parent/student/teacher/school_admin/district_officer/state_officer/national_admin/researcher/system_admin). Authorization is enforced via Laravel Policies (`app/Policies/ComplaintPolicy.php`, `SchoolPolicy.php`), not just route middleware — e.g. a school_admin route-level check alone wouldn't stop them viewing another school's complaint; the policy checks their actual `school_staff` assignment.

Covered by `tests/Feature/Platform/RbacBoundaryTest.php`: cross-school access, cross-jurisdiction district-officer access, and complaints from users with no real staff/relationship record.

## Standard web security

- CSRF: Laravel default (all forms)
- Password hashing: bcrypt, `BCRYPT_ROUNDS=12` in production
- Rate limiting: Laravel's default auth throttling applies to login/register
- File uploads (complaint evidence): type-restricted (jpg/jpeg/png/pdf), 5MB cap, stored on the **private** `local` disk (`storage/app/private`, never `public/`), served only through `ComplaintEvidenceController` which re-checks the `view` policy on the parent complaint before streaming the file — no direct public URL exists for evidence files.
- `.env` is never committed; see `.env.example` for the required keys and `DEPLOYMENT.md` for how production secrets get onto the server.

## 2FA

TOTP-based (`pragmarx/google2fa`), available to School Admin and all four government-officer roles from Profile → "Two-Factor Authentication". Setup shows a manual-entry secret key (no QR code library) and, on confirmation, 8 single-use recovery codes shown once. Login checks `two_factor_authentications.confirmed_at`; if set, the password check succeeds but the session is **not** authenticated yet — `Auth::login()` only happens after a separate TOTP/recovery-code challenge (`/two-factor-challenge`) passes. Not yet mandatory for any role — an officer can choose not to enable it.

## Anti-manipulation / fraud flagging

`AIAssistService::detectFeedbackSpike()` runs on every school-feedback and teacher-feedback submission (see `AIAssistService`'s own doc comment — heuristic, advisory only, never auto-penalizing). A detected spike creates one `fraud_flags` row (deduplicated — no repeat flag while one is already open for the same subject), reviewed by System Admin at `/admin/roles`'s sibling page `/admin/fraud-flags`. Window/threshold are admin-configurable at `/admin/moderation`, backed by the `settings` table — a change only affects future submissions, there's no backfill/rescan of history.

## What's explicitly NOT hardened yet

- No AI-assisted moderation (real model, not the current rule-based heuristics)
- No account-level anti-manipulation detection (coordinated multi-account patterns) — only the feedback-timing-spike heuristic above exists
- Serious child-safety allegations are flagged (`is_child_safety_flag`) and prioritized in the District Officer dashboard, but there's no dedicated escalation workflow beyond that flag yet
- 2FA is opt-in, not enforced, for the roles that can use it

All of the above are listed in `ROADMAP.md`, not silently skipped. **Do not put real parent/student/complaint data into this test environment** until these are addressed — seed data is 100% synthetic and this should stay that way until a proper security review happens.
