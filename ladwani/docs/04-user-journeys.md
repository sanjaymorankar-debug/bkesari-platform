# Phase 1.4 — User Journeys

Each journey names its trigger, steps, decision points, and what the approval/notification system does along the way.

## J1 — Registration & Family Onboarding

1. User registers (mobile or email + password) → OTP verification.
2. System asks: *"Are you joining an existing family, or registering a new one?"*
3a. **Existing family**: search by family name/registration number → "Request to Join" → request routed to that family's Karta → Karta approves/declines → on approval, `family_members` row created, relationship captured.
3b. **New family**: fill preliminary family record → duplicate-check runs (name + native place + similar member names) → if a possible match is found, show *"Possible duplicate found"* and let the user either continue or switch to 3a → submission enters Operator verification queue → Operator/Admin verifies → family activated, submitter becomes provisional Karta.
4. Either path ends with the member `ACTIVE` and able to use the rest of the platform; family-linkage state (`PENDING`/`ACTIVE`) is visible on their dashboard the whole time.

## J2 — Karta Adds a Family Member

1. Karta opens **My Family → Add Member**.
2. Choose: *brand-new person* (not on the platform) vs. *existing platform member*.
3a. **New person**: fill profile fields, set relationship to an existing family member → member created directly, both directions of the relationship written (e.g. Son ↔ Father) via the relationship type's configured inverse.
3b. **Existing member**: search platform → select → set relationship → request sent to *that person* (not the Karta) for approval, since the person already has their own account and consent matters → on approval, same relationship-write as 3a.
4. Duplicate-check runs before either path commits.

## J3 — Marriage / Spouse Linking

1. Karta or the member themself opens **Update Marital Status → Married**.
2. Choose: existing community member as spouse / add spouse as new member / record as non-community spouse (name/details only, no login).
3. System creates the Husband↔Wife relationship pair (or a one-directional record for a non-community spouse) and updates `marital_status` — original family-of-birth relationships are never removed.
4. Sensitive-change approval rule fires (`member.marital_status.change` → Operator review) unless the community's approval config says otherwise for self-reported status changes.

## J4 — Marking a Member Deceased

1. Karta or Admin opens the member record → **Mark as Deceased**.
2. Enter date/place/age-at-death, optional memorial note and photo.
3. This is an approval-gated action (`member.mark_deceased` → Operator/Admin) — never a same-click status flip, given the sensitivity and irreversibility.
4. On approval: `status = DECEASED`. Record is never deleted; it remains in the tree subject to the same privacy rules as before (a viewer who couldn't see the field before still can't see it after).

## J5 — Matrimony Discovery & Interest

1. Member opts in, fills a matrimonial profile (separate from — but sourced from — their base profile) and sets partner preferences.
2. Other members search/filter (age, location, education, profession, income range, etc.) and only see fields the profile owner has made Matrimony-visible.
3. Viewer sends **Interest**, or **Requests Contact**, or **Contacts Family** (whichever the profile owner has enabled).
4. Profile owner is notified, approves/declines. Contact details are revealed only per the community's configured policy (accept-first vs. family-approval) — never automatically on interest alone.

## J6 — Asset Discovery & Booking (Instant)

1. Member browses/searches Community Services (category, city, date, capacity, price, verified-only).
2. Opens asset detail → checks live availability calendar → selects date/time, add-on services → sees computed price (base + seasonal + add-ons + tax − community discount).
3. Confirms → pays → **server verifies payment** → booking flips to `CONFIRMED` only after verification succeeds (never on the browser's say-so) → confirmation + QR code issued, notifications sent to member and asset owner.

## J7 — Asset Booking (Request-based)

1. Same discovery/selection steps as J6, but the asset requires owner approval (e.g. a large hall).
2. Booking enters `REQUESTED` → owner approves/declines within a configured window.
3. On approval, member is prompted to pay → same server-verified payment step as J6 → `CONFIRMED`.
4. If the owner doesn't respond in time or declines, the request auto-expires/cancels and the held slot is released.

## J8 — Family Fee Payment

1. Karta opens **Community Fees**, sees outstanding items (billed/paid/outstanding, due date, late fee if overdue).
2. **Pay Now** → choose method → gateway checkout → **server-side verification** of the payment → invoice marked paid, receipt generated, ledger entry written, reminder schedule for that invoice cancelled, notification sent.
3. If payment fails or the browser closes mid-flow, the invoice stays outstanding and a reconciliation job later checks the gateway's own record of that order to catch a "paid but not confirmed" edge case.

## J9 — Offline Payment Verification

1. Karta records an offline payment (cash/bank transfer/cheque) against an invoice, attaching a reference/receipt if available.
2. Status: `PENDING_VERIFICATION` — invisible as "paid" to anyone but the Karta and staff until acted on.
3. An Operator/Admin (never the payer) verifies it → status `VERIFIED` → receipt generated, ledger entry written.

## J10 — Approval Queue (Operator/Admin)

1. Operator opens their queue (scoped to their assigned area where applicable): pending families, member changes, relationship edits, marital/deceased status changes, asset submissions, offline payments.
2. Each item shows the proposed change, the submitter, and (where relevant) the duplicate-check result.
3. Approve / Reject / Return-for-correction, with a required reason for reject/return.
4. Action is logged to `audit_logs` and the submitter is notified either way.

## J11 — Duplicate Detection & Merge Review

1. Triggered automatically during family/member creation (name + DOB + mobile + native place + parent/spouse overlap heuristics).
2. Possible matches surfaced to the submitter *and* flagged for Operator/Admin review regardless of what the submitter chooses.
3. Operator/Admin can review both records side-by-side and merge — but the system never auto-merges; a human always confirms which record wins and what happens to the other.
