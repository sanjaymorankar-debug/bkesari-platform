# Phase 2.3 — API Contracts (Finalized Examples)

Full OpenAPI spec is generated from NestJS decorators at build time (`@nestjs/swagger`) once implementation starts — these are the finalized shapes for the highest-stakes endpoints, worked out now because getting them wrong is expensive later (payments, auth, booking concurrency).

## 1. Conventions Recap

- Envelope: `{ "data": ..., "meta"?: { "page", "limit", "total" } }` for lists; bare object for single-resource responses.
- Errors: `{ "statusCode": 422, "error": "ValidationError", "message": "...", "details"?: [...] }`.
- All amounts are integers in paise (₹1 = 100), never floats — the one rule that prevents an entire category of rounding bugs in the fee/payment/booking domains.
- All timestamps are ISO-8601 UTC; the frontend localizes for display.

## 2. Auth

```
POST /api/v1/auth/login
→ { "identifier": "9876543210", "password": "•••" }
← 200 {
    "data": {
      "accessToken": "eyJ...",       // 15 min expiry
      "user": { "id": "...", "roles": ["MEMBER"], "memberId": "..." }
    }
  }
  (refreshToken set as an httpOnly, Secure, SameSite=Strict cookie — never in the JSON body)
← 401 { "statusCode": 401, "error": "InvalidCredentials", "message": "Mobile number/email or password is incorrect." }
← 429 { "statusCode": 429, "error": "TooManyAttempts", "message": "Too many login attempts. Try again in 3 minutes." }
```

## 3. Family Join Request (self-service — the direction added mid-build on the previous project, carried into this design from day one this time)

```
POST /api/v1/join-requests
→ { "relatedToMemberId": "mem_abc123", "relationshipTypeCode": "son" }
← 201 { "data": { "id": "jr_xyz", "status": "PENDING", "familyId": "fam_123" } }
← 409 { "statusCode": 409, "error": "AlreadyMember", "message": "You are already part of this family." }
← 409 { "statusCode": 409, "error": "RequestPending", "message": "You already have a pending request for this family." }
```

## 4. Booking Creation (the concurrency-sensitive one)

```
POST /api/v1/bookings
→ {
    "assetId": "asset_123",
    "date": "2026-11-14",
    "slot": "FULL_DAY",
    "guestCount": 250,
    "serviceIds": ["svc_catering", "svc_decoration"],
    "idempotencyKey": "client-generated-uuid"
  }
← 201 {
    "data": {
      "id": "bk_456",
      "status": "REQUESTED",          // or straight to pending-payment for INSTANT assets
      "totalAmount": 8500000,          // ₹85,000.00 in paise
      "breakdown": {
        "base": 7000000, "services": 1200000, "tax": 300000, "discount": 0
      }
    }
  }
← 409 { "statusCode": 409, "error": "SlotUnavailable", "message": "This date is no longer available — someone else just booked it." }
```

The `409 SlotUnavailable` response is the visible symptom of the row-lock design in `11-booking-architecture.md` §2 doing its job — a client should treat it as "please pick another date," never retry the same request automatically.

## 5. Payment Order Creation

```
POST /api/v1/payments/orders
→ {
    "purposeType": "BOOKING",         // or FEE, DONATION
    "purposeId": "bk_456",
    "amount": 8500000,
    "idempotencyKey": "client-generated-uuid"
  }
← 201 {
    "data": {
      "paymentTransactionId": "pay_789",
      "gateway": "RAZORPAY",
      "gatewayOrderId": "order_Nk8...",
      "checkoutConfig": { "key": "rzp_live_...", "amount": 8500000, "currency": "INR", "orderId": "order_Nk8..." }
    }
  }
```

The frontend hands `checkoutConfig` straight to Razorpay's Checkout.js — the API never constructs a payment form itself.

```
POST /api/v1/payments/pay_789/verify
→ { "razorpayPaymentId": "pay_M9x...", "razorpayOrderId": "order_Nk8...", "razorpaySignature": "..." }
← 200 { "data": { "status": "SUCCESSFUL" } }
← 200 { "data": { "status": "UNDER_VERIFICATION" } }   // signature valid but gateway confirmation still pending — client polls
← 400 { "statusCode": 400, "error": "SignatureMismatch", "message": "Payment could not be verified." }
```

## 6. Member Search

```
GET /api/v1/members/search?q=ramesh&city=Pune&maritalStatus=UNMARRIED&page=1&limit=20
← 200 {
    "data": [
      { "id": "mem_1", "firstName": "Ramesh", "lastName": "L.", "age": 29, "currentCity": "Pune", "familyName": "Ladwani" }
      // ...fields present here are already privacy-filtered server-side — never a superset the client trims
    ],
    "meta": { "page": 1, "limit": 20, "total": 47 }
  }
```

## 7. Webhook (Payment Gateway → Us)

```
POST /api/v1/webhooks/payments/razorpay
Headers: X-Razorpay-Signature: <hmac>
→ { raw Razorpay event payload }
← 200 { "received": true }     // always 200 once signature-verified and stored, even if we choose not to act on this
                                 // specific event type yet — a non-200 makes the gateway retry unnecessarily
← 400                            // signature invalid — logged to payment_webhooks with signature_valid=false, not processed
```
