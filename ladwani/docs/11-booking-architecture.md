# Phase 1.11 — Booking Architecture

## 1. Availability Model

`asset_availability` holds one row per `(asset_id, date, slot)` — for a whole-day asset (e.g. a marriage hall booked by the day) `slot` is a fixed sentinel like `FULL_DAY`; for an hourly asset it's a real time-slot key. This table is the **single writable source of truth for whether a specific date/slot can be booked** — the booking flow never computes availability by scanning existing bookings on the fly, both for performance at scale and because it's the row this section's locking strategy actually locks.

Status values: `AVAILABLE`, `RESERVED` (a confirmed booking holds it), `PENDING` (a request-type booking is awaiting owner decision or payment), `BLOCKED` (owner-initiated), `MAINTENANCE`, `HOLIDAY`.

## 2. Preventing Double-Booking

```sql
-- Illustrative, not final DDL
BEGIN;
SELECT status FROM asset_availability
  WHERE asset_id = $1 AND date = $2 AND slot = $3
  FOR UPDATE;                              -- row lock, blocks a concurrent competing booking

-- application checks status == 'AVAILABLE' here, inside the same transaction
UPDATE asset_availability SET status = 'PENDING' -- or RESERVED for instant bookings
  WHERE asset_id = $1 AND date = $2 AND slot = $3;

INSERT INTO bookings (...) VALUES (...);
COMMIT;
```

A `UNIQUE (asset_id, date, slot)` constraint on `asset_availability` plus `SELECT ... FOR UPDATE` inside the booking transaction means two concurrent booking attempts for the same slot serialize at the database — the second one sees the row already flipped and fails cleanly with a "no longer available" response, never a silent double-write. This is enforced at the DB layer specifically because relying on application-level "check then write" (two separate statements, no lock) is exactly the race condition that causes double-bookings in practice.

## 3. Booking State Machine

```
                 ┌─────────────┐
   (instant)     │             │
  ───────────────►  REQUESTED  │──(auto, instant type)──► awaiting payment
                 │             │
                 └──────┬──────┘
                        │ (request type: owner decision)
              ┌─────────┴─────────┐
              ▼                   ▼
          APPROVED            DECLINED ──► availability row released back to AVAILABLE
              │
              ▼ (payment verified server-side — see Payment Architecture)
          CONFIRMED
              │
       ┌──────┼───────────────┐
       ▼      ▼               ▼
   CANCELLED  COMPLETED    (no-show handling: Phase 2)
   (per cancellation        (post-event, enables reviews)
    policy, refund per
    §37 rules)
```

`EXPIRED` is a terminal state reached automatically when a `REQUESTED`/`APPROVED` booking sits unpaid past a configured window — the availability hold is released and the slot returns to `AVAILABLE`.

## 4. Price Engine

Computed server-side at both quote time (shown to the user before confirming) and confirm time (re-validated — never trust a price the client sent back):

```
base_price (from asset_pricing, resolved by date: seasonal > weekend > base)
+ Σ selected asset_service_pricing lines
− community_member_discount (if applicable, community-configured)
+ tax (community-configured rate/rule)
= total_amount

security_deposit tracked separately, refundable per policy, not part of total_amount's revenue recognition in the ledger
```

If `total_amount` computed at confirm-time differs from what was quoted (pricing changed between quote and confirm), the booking is rejected with a re-quote prompt rather than silently charging a different amount than what was shown.

## 5. Cancellation & Refund

- Each asset carries a cancellation policy (`asset` → policy config: deadline in days-before-event, refund percentage tiers, flat cancellation charge, security-deposit handling).
- Cancelling a `CONFIRMED` booking: computes the refund per policy → creates a `booking_refunds` row → triggers the Refund flow (§10.7) → on refund completion, `asset_availability` for that slot is released back to `AVAILABLE` (not before — a pending refund shouldn't free the slot for double-booking risk before the cancellation is actually final).

## 6. QR Verification

A `CONFIRMED` booking generates a signed QR payload (booking id + a short-lived HMAC, not the raw booking id alone, so it can't be guessed/enumerated). Asset staff scan it via a lightweight verification screen that resolves: booking id, asset, date/slot, status, and only the guest name/count needed for check-in — never the member's contact details, payment amount, or other personal data.

## 7. Reviews Gate

`reviews` requires `booking.status = COMPLETED` and `booking.user_id = reviewer` — enforced as a DB check at write time, not just a UI affordance, so a review can't be posted for a booking that was cancelled or never happened.
