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
