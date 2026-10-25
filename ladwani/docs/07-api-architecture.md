# Phase 1.7 — API Architecture

## 1. Style & Conventions

- REST, versioned base path `/api/v1`.
- NestJS modules mirror the 22 product modules (one Nest module per module, each with its own controller/service/DTOs) — the API's folder structure should make it obvious where a given feature lives without cross-referencing this doc.
- Auth: `Authorization: Bearer <JWT>` (access token, short-lived) + refresh-token rotation endpoint. Session/cookie-based auth for the web app's own first-party calls, JWT for anything else (mobile app later, integrations).
- Pagination: `?page=&limit=` everywhere a list is returned, response envelope `{ data, meta: { page, limit, total } }` — never an unbounded array.
- Filtering: consistent `?filter[field]=value` style across list endpoints rather than ad hoc query param names per module.
- Errors: RFC7807-style problem responses (`{ statusCode, error, message, details? }`), consistent across every module — a client should never need module-specific error parsing.
- Idempotency: any endpoint that creates a financial side effect (payment order creation, refund) requires an `Idempotency-Key` header.

## 2. Resource Map (representative — full OpenAPI spec is a Phase 5 deliverable)

### Auth
```
POST   /auth/register
POST   /auth/verify-otp
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
```

### Users & Roles (Admin)
```
GET    /users
GET    /users/:id
PATCH  /users/:id/status
POST   /users/:id/roles
DELETE /users/:id/roles/:roleId
```

### Family Registry
```
POST   /families
GET    /families/:id
PATCH  /families/:id
GET    /families/:id/members
POST   /families/:id/members            (add new member)
POST   /families/:id/join-requests      (Karta invites an existing member)
POST   /join-requests                   (self-service: member requests to join)
POST   /join-requests/:id/respond
PATCH  /families/:id/members/:memberId  (status change)
DELETE /families/:id/members/:memberId  (remove, soft)
```

### Family Tree
```
GET    /families/:id/tree               (privacy-filtered graph, ready to render)
GET    /families/:id/tree/export        (PDF/image)
```

### Member Directory
```
GET    /members/search?...filters
GET    /members/:id
PATCH  /members/:id                     (own profile only, enforced server-side)
POST   /members/:id/photos
```

### Matrimony
```
POST   /matrimony/profiles
GET    /matrimony/profiles/mine
PATCH  /matrimony/profiles/:id
GET    /matrimony/profiles/search?...filters
GET    /matrimony/profiles/:id          (field-filtered by viewer's permissions)
POST   /matrimony/interests
PATCH  /matrimony/interests/:id         (accept/decline/withdraw)
POST   /matrimony/saves
```

### Community Social
```
GET    /posts?scope=area|city|community
POST   /posts
POST   /posts/:id/comments
POST   /posts/:id/reactions
DELETE /posts/:id/reactions
POST   /reports
GET    /admin/moderation/queue
```

### Areas (Admin config + read)
```
GET    /areas?parentId=
POST   /areas
```

### Community Services / Assets
```
GET    /asset-categories
POST   /assets                          (Asset Owner submits)
GET    /assets/search?...filters
GET    /assets/:id
PATCH  /assets/:id
POST   /assets/:id/photos
GET    /assets/:id/availability?from=&to=
POST   /assets/:id/blocked-dates
POST   /admin/assets/:id/verify         (approve/reject)
```

### Booking
```
POST   /bookings                        (creates REQUESTED or pending-payment INSTANT booking)
GET    /bookings/mine
GET    /bookings/:id
POST   /bookings/:id/approve            (owner, request-type only)
POST   /bookings/:id/cancel
GET    /bookings/:id/qr
POST   /bookings/:id/reviews            (only if COMPLETED)
```

### Payments
```
POST   /payments/orders                 (creates payment_transaction + gateway order)
POST   /payments/:id/verify             (server-side verification after client redirect)
POST   /webhooks/payments/:gateway      (signature-verified, idempotent)
GET    /payments/mine
POST   /payments/:id/refund-request
```

### Community Fees
```
GET    /families/:id/fee-invoices
POST   /fee-invoices/:id/pay            (→ /payments/orders under the hood)
POST   /fee-invoices/:id/offline-payment
POST   /admin/offline-payments/:id/verify
GET    /admin/fee-types
POST   /admin/fee-rules
```

### Donations
```
GET    /donation-causes
POST   /donations
```

### Approvals
```
GET    /approvals?status=&assignedToMe=
POST   /approvals/:id/decision          (approve/reject/return, with reason)
```

### Notifications
```
GET    /notifications
PATCH  /notifications/:id/read
PATCH  /notifications/read-all
```

### Reporting (Admin/Operator)
```
GET    /reports/demographics
GET    /reports/matrimony
GET    /reports/services
GET    /reports/financial?from=&to=&groupBy=area|month
GET    /reports/:reportId/export.csv
```

## 3. Cross-Cutting Concerns Implemented Once, Used Everywhere

- **Auth guard + permission decorator** — every controller method declares the permission(s) it needs; the guard resolves role→permission and, where scoped, checks the record's actual owner/family against the requester.
- **Visibility interceptor** — response serializers for member/family/matrimony payloads run every field through the privacy-resolution algorithm (see `09-privacy-architecture.md`) before the response leaves the server. Field filtering never happens client-side.
- **Audit interceptor** — any handler tagged `@Audited()` automatically writes an `audit_logs` row from the request context + before/after diff, so individual modules don't hand-roll logging.
- **Idempotency interceptor** — for POSTs tagged `@Idempotent()`, replays the cached response for a repeated key instead of re-executing the side effect.
