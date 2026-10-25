# Phase 1.12 — Approval Workflow

## 1. One Engine, Every Sensitive Action

Rather than each module hand-rolling its own "needs review" logic, every sensitive mutation across the platform funnels through the same `ApprovalsService`, configured declaratively per action via `approval_rules`.

```
approval_rules
  action_code          e.g. "family.create", "member.mark_deceased", "asset.register"
  requires_approval    boolean
  approver_role        which role's queue this lands in (OPERATOR/ADMIN), scoped to area where applicable
  auto_approve_role    if the submitter already holds this role, skip the queue entirely (e.g. Admin editing directly)
```

## 2. State Machine

```
DRAFT ──► SUBMITTED ──► UNDER_REVIEW ──┬──► APPROVED ──► (change applied)
                                        ├──► REJECTED ──► (change discarded, submitter notified with reason)
                                        └──► RETURNED  ──► (back to submitter for correction, re-submit re-enters SUBMITTED)
```

- `DRAFT` exists for multi-step forms (e.g. asset registration) so a submitter can save progress before formally submitting.
- `UNDER_REVIEW` is set the moment an Operator/Admin opens the item, so two reviewers don't work the same item without knowing someone else is already on it.
- `ESCALATED` (from the brief's `Approval` status list) is a lateral move available to an Operator who wants Admin to decide instead — not a terminal state.

## 3. What Actually Applies the Change

An `approvals` row stores `entity_type + entity_id + field_name (nullable) + old_value + new_value` as a **proposed diff**, not a live mutation. The underlying table is only written to when the approval reaches `APPROVED` — applied inside the same transaction that flips the approval's own status, so a crash mid-way can't leave "approved but not applied" or "applied but still shows pending" inconsistencies.

For actions that aren't simple field diffs (e.g. "add member" creates several rows: member, family_members, member_relationships), the approval's `new_value` holds a structured payload the relevant module's own "apply" handler knows how to interpret — the approvals table stays generic, but application of the approved change is still delegated to the owning module rather than the approval engine trying to know how to write to every table in the schema.

## 4. Actions Routed Through This Engine (from the brief, §60 + duplicates found across other sections)

| Action code | Approver | Notes |
|---|---|---|
| `family.create` | Operator | Duplicate-check result attached to the review item |
| `family.member.add` | Operator | |
| `family.member.remove` | Karta (self-service, no queue) unless Admin override | Karta authority — see hard rules |
| `family.karta.transfer` | Admin | Higher bar than ordinary member changes |
| `family.merge` | Admin | Never automatic (§62) |
| `member.marital_status.change` | Operator | |
| `member.mark_deceased` | Operator/Admin | |
| `member.relationship.change` | Operator | |
| `asset.register` | Operator/Admin | Feeds the Asset Verification workflow (§24), which is this same engine specialized for assets |
| `asset.suspend` | Admin | |
| `offline_payment.verify` | Operator/Admin | Never the payer (hard rule) |
| `data.correction_request` | Operator | From the Privacy Center |
| `data.deletion_request` | Admin | Anonymization, not row deletion (§9.5) |
| `member.edit_own` | *(no approval — auto-approved)* | Configured `requires_approval = false` |

## 5. Notifications

Every transition (submit, under-review, approved, rejected, returned) fires a notification to the submitter; approved/rejected additionally notify anyone the change directly affects (e.g. the *other* member in a relationship change, not just the submitter).

## 6. Audit

Every `approvals` transition writes an `audit_logs` row referencing the approval id — the audit trail and the approval history are two views over the same event stream, not two separately-maintained logs that can drift apart.
