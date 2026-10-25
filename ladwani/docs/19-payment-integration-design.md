# Phase 2.6 — Payment Integration Design (Concrete)

This finalizes the abstraction described in Phase 1's `10-payment-architecture.md` with an actual first provider and the specific mechanics of integrating it.

## 1. Provider: Razorpay (first integration)

Chosen as the concrete first implementation of the `PaymentGateway` interface because: strong native UPI support (the dominant payment method for the amounts involved here — fee payments and hall bookings), a well-documented Node SDK, and wide familiarity among Indian community/nonprofit organizations collecting membership fees — meaning whoever administers this platform's payment settings later is more likely to already have or be able to get a Razorpay account than some alternatives. Cashfree/PayU remain valid second implementations of the same interface if ever needed — nothing about the booking/fee/donation modules changes to add one.

## 2. Signature Verification (the part that must never be skipped)

Razorpay signs both the client-side checkout response and the async webhook, with two different secrets:

```ts
// After checkout redirect — verifying the payment itself
function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))   // constant-time compare — never `===`
}

// Verifying an inbound webhook
function verifyWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

Both checks use `timingSafeEqual`, not string equality — a naive `===` comparison leaks timing information that can theoretically assist signature forgery; this is a one-line difference that costs nothing and closes a real (if narrow) attack surface.

## 3. Webhook Endpoint Requirements

- Raw request body is captured **before** any JSON body-parser middleware touches it — the signature is computed over the exact bytes Razorpay sent, and a re-serialized JSON object will not produce the same signature.
- Every webhook call is persisted to `payment_webhooks` (event type, raw payload, signature-valid flag, timestamp) **before** any business logic runs — so a bug in the handler never means the event is lost, only that it needs replaying from a durable record.
- Deduplication key: `(gateway_code='RAZORPAY', gateway_event_id)` — Razorpay's own event id, not our internal transaction id, since one of our transactions can legitimately receive multiple distinct events (`payment.authorized`, `payment.captured`, etc.).
- Always returns `200` once the event is durably stored and signature-checked, regardless of whether we act on that specific event type yet — a non-200 makes Razorpay retry unnecessarily and doesn't change the fact that we already have the event on file.

## 4. Reconciliation Job

Runs on a schedule (every 15 minutes for transactions stuck in `PROCESSING`/`UNDER_VERIFICATION` past a 10-minute threshold): queries Razorpay's Orders API directly for the order's actual current state and reconciles our `payment_transactions` row to match, writing a `payment_reconciliation` entry either way (resolved-automatically or flagged-for-admin). This is the safety net for the specific failure mode called out in Phase 1 §33 — browser closed mid-payment, webhook delayed or dropped — so a payment that genuinely succeeded doesn't sit invisible to the payer for hours.

## 5. Refunds

`POST /payments/orders/:id/refund` (Admin/authorized Asset Owner only, per the permission matrix) calls Razorpay's refund API with an idempotency key equal to our internal `refunds.id` — a retried refund request (e.g. a flaky network causing a client retry) can never issue two refunds for the same intent, since Razorpay itself dedupes on that key.

## 6. Fees Charged By Razorpay

Razorpay's own transaction fee (roughly 2% for UPI/cards, varies by method) is **not** silently absorbed into the ledger as a discrepancy — it's recorded as its own `financial_ledger` line (`entry_type = 'GATEWAY_FEE'`) so the family/donor is shown they paid the full invoiced amount, and the community's net collection is separately visible as invoiced-minus-gateway-fees in financial reports.
