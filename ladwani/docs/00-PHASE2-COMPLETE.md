# Indian Community Platform — Phase 2: Detailed Architecture

Builds directly on [Phase 1](https://claude.ai/code/artifact/48c9dd96-d1c3-4515-b23f-a49f46504521) — system architecture, database architecture, API contracts, authentication, authorization, file storage, and payment integration, all made concrete now that MySQL and the clean-cutover decisions are confirmed.

## Contents

1. [System Architecture](#phase-21--system-architecture-finalized)
2. [Database Architecture](#phase-22--database-architecture-concrete)
3. [API Contracts](#phase-23--api-contracts-finalized-examples)
4. [Authentication & Authorization](#phase-24--authentication--authorization-design-concrete)
5. [File Storage Design](#phase-25--file-storage-design-concrete)
6. [Payment Integration Design](#phase-26--payment-integration-design-concrete)

---

# Phase 2.1 — System Architecture (Finalized)

## 1. Monorepo Layout

```
community-platform/
├── apps/
│   ├── api/            NestJS — all backend modules (§ Phase 1 module map)
│   └── web/             Next.js — all frontend screens
├── packages/
│   ├── shared-types/     DTOs, enums, permission strings — imported by BOTH apps so a
│   │                     contract change is a compile error on whichever side didn't update
│   └── config/           Shared eslint/tsconfig/prettier base
├── prisma/               Schema, migrations (source of truth for the DB)
└── docs/                 This folder
```

npm workspaces (not a separate tool like Turborepo/Nx) — the project doesn't need build-graph caching at this scale yet, and one less tool is one less thing to operate on shared hosting.

## 2. Why Two Apps Instead of the Previous Project's "One Next.js App with API Routes"

The brief calls for a NestJS backend + Next.js frontend specifically (§67), not the integrated Next.js-API-routes pattern the previous Ladwani build used. The trade this makes: real separation of concerns and a backend that isn't tied to Next's request lifecycle (useful once background jobs, webhooks, and a proper DI/module system for 22 modules matter) — at the cost of needing two deployed processes instead of one, and CORS between them.

## 3. Deployment Topology on Hostinger

This is the concrete question the previous build's whole session answered the hard way, so it's worth being explicit now rather than rediscovering it mid-M0:

- Hostinger's Node.js hosting runs **one Node process per site/subdomain** (confirmed from the existing deployment: `devmiladwani.agtci.com` is one "Website" entry with its own Node.js app manager, build pipeline, and env-var panel).
- Two apps therefore need **two subdomains, each its own Hostinger "Website" entry**:
  - `app.<domain>` (or the existing bare subdomain) → `apps/web`, the Next.js frontend
  - `api.<domain>` → `apps/api`, the NestJS backend
- Both connect to the **same MySQL database** (one Hostinger MySQL database, per Phase 1's confirmed engine choice).
- The frontend talks to the backend over HTTPS via `NEXT_PUBLIC_API_URL`; the backend's CORS config allowlists the frontend's exact origin (never `*`, since cookies/credentials are involved).
- **No CLI access on this host** — confirmed repeatedly this session. Every migration and seed operation is generated locally as SQL and run by hand through phpMyAdmin, same pattern already proven working. This is not a workaround to route around eventually; it's a standing constraint the whole M0–M5 plan designs around (see `15-database-architecture.md` §3).
- GitHub-based auto-deploy (already set up for the current site) is reused for both new subdomains once each is created — same "connect repo, set build/start command, set env vars" flow already walked through this session.

## 4. Environments

| Environment | Purpose | Database |
|---|---|---|
| Local dev | Day-to-day development | Docker MySQL container |
| Staging | M0–M5 build/test target | A **second** Hostinger MySQL database (or a free-tier external MySQL if Hostinger's plan limits database count) — never the live one |
| Production | Live cutover, M5 only | The current live Hostinger MySQL database, after the confirmed destructive replacement (Phase 1 §13.1a) |

## 5. Background Jobs

Redis + BullMQ for anything that shouldn't block a request: thumbnail generation after photo upload, payment-reminder scheduling, webhook retry handling, reconciliation runs. Hostinger's shared plan may not support a persistent Redis instance — flagged as a concrete thing to verify before M0 locks in; the fallback is a lightweight polling-based job table (`scheduled_jobs`) if a managed Redis isn't feasible on the current hosting tier.

## 6. Observability (minimum viable for launch)

- Structured JSON logging (NestJS's built-in `Logger`, one line per request with a request-id) — enough to debug production issues via Hostinger's runtime logs, the same log viewer already used throughout this session's debugging.
- No dedicated APM/tracing tool at this scale; revisit if/when member count approaches the 100k mark from the NFR target.

---

# Phase 2.2 — Database Architecture (Concrete)

## 1. ORM: Prisma

Chosen over TypeORM (NestJS's more commonly-tutorialized default) for three concrete reasons specific to this project:

1. **Migration diffing without a live connection.** `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script` generates exact incremental SQL from two schema files alone — no database connection required to produce it. Given this host has no CLI access, that's not a nice-to-have, it's the entire mechanism for ever changing the schema (§3 below).
2. **Generated types flow straight into NestJS's DI** via a `PrismaService` provider — no separate entity/repository boilerplate layer to keep in sync by hand.
3. Directly proven this session against this exact MySQL host, including the specific gotchas (no `mode: 'insensitive'`, no native array columns, `localhost` vs `127.0.0.1` connection quirks) already paid for once — re-litigating the ORM choice would mean re-discovering some of those.

## 2. Naming Conventions

- Table names: `snake_case`, plural (`family_join_requests`, not `FamilyJoinRequest`) — set via `@@map(...)` on every model, Prisma model names stay PascalCase/singular for ergonomic TypeScript usage.
- Column names: `snake_case` in the database (`@map(...)` per field), `camelCase` in generated TypeScript — Prisma bridges this automatically, so the API layer never touches raw snake_case.
- Primary keys: `id`, type `String @id @default(cuid())`, stored as `VARCHAR(191)` — matches the proven pattern from the previous build, safely under MySQL/utf8mb4's index key-length limit.
- Foreign keys: `<referenced_singular>_id` (`family_id`, `member_id`), always with a real `@relation` — no shared polymorphic id columns (Phase 1 §6.J), always separate nullable FK columns per target type instead.
- Enums: modeled as Prisma `enum` where the value set is genuinely fixed and small (e.g. `Gender`, `MaritalStatus`); modeled as a plain `String` referencing an admin-configurable lookup table where the brief calls for admin-extensibility (e.g. `relationship_types.code`, `skills.name`, `asset_categories.code`) — an enum can't be extended by an Admin screen without a code deploy, a lookup table can.

## 3. Migration Workflow (no CLI on the host)

```
1. Edit prisma/schema.prisma locally.
2. `npx prisma generate` locally — validates the schema, regenerates the client, catches
   errors before they ever reach staging/production.
3. `npx prisma migrate diff --from-schema-datamodel <previous-schema-snapshot> \
     --to-schema-datamodel prisma/schema.prisma --script > migration_NNN.sql`
4. Review the generated SQL by hand (this step caught real issues in the previous build —
   never skip it).
5. Run migration_NNN.sql through phpMyAdmin against staging first, then production only at
   the confirmed M5 cutover (Phase 1 §13.1a).
6. Commit both the schema change and the migration_NNN.sql file — the SQL files are the
   durable migration history, since there's no `prisma migrate deploy` run automatically
   anywhere in this pipeline.
```

A `prisma/migrations/` folder holds every `migration_NNN.sql` in order, numbered — effectively a hand-operated version of what `prisma migrate deploy` would do automatically on a host that allowed it.

## 4. Soft Delete

`deleted_at DateTime?` on every table marked `[soft-delete]` in the Phase 1 schema catalog. Enforced via a **Prisma Client Extension** that automatically appends `deleted_at: null` to `where` clauses for those models, rather than trusting every hand-written query to remember it — the one thing worth automating so "soft delete" is actually never bypassable by an easy-to-miss omission in a new query written six months from now.

## 5. Indexing Strategy (for the 100k-member / eventually 1M-member target)

| Table | Index | Why |
|---|---|---|
| `members` | `(status, gender)`, `(current_city)`, `(native_village)` | Directory/search filters (Phase 1 §20) |
| `members` | Fulltext index on `(first_name, last_name)` | Name search without a full scan |
| `family_members` | Unique `(family_id, member_id)` where `left_at IS NULL` (partial-unique via a generated/filtered approach, since MySQL doesn't support true partial indexes — see §7) | One active membership per family per member |
| `member_relationships` | `(from_member_id)`, `(to_member_id)` | Tree traversal in both directions |
| `matrimonial_profiles` | `(is_visible)` | Search only ever filters visible profiles |
| `asset_availability` | Unique `(asset_id, date, slot)` | The row the booking lock (Phase 1 §11.2) depends on |
| `payment_transactions` | `(user_id, status)`, `(purpose_type, purpose_id)` | "My payments" list, reconciliation lookups |
| `fee_invoices` | `(family_id, financial_year_id, status)` | Karta's outstanding-fees view |
| `notifications` | `(recipient_id, is_read, created_at)` | Unread-count and feed queries |
| `audit_logs` | `(entity_type, entity_id)`, `(actor_id, created_at)` | "Show me the history of this record" and "show me what this user did" |

## 6. Pagination & Query Discipline

Every list endpoint uses cursor-free offset pagination (`page`/`limit`, capped at `limit ≤ 100`) to start — simpler to reason about at this scale than cursor pagination, revisit only if a specific list (likely the community feed) shows real performance pressure. No endpoint returns an entire table; the family tree endpoint specifically returns one family's subgraph, never a cross-family traversal.

## 7. MySQL-Specific Adaptations Carried Forward from the Previous Build

- No native array/list columns — `JSON` columns instead (`languages`, `preferred_locations` in the matrimony domain), exactly as fixed in the previous project.
- No `mode: 'insensitive'` in Prisma queries — MySQL's default `utf8mb4_unicode_ci` collation is already case-insensitive, so plain `contains` is correct and this Postgres-only option isn't available to accidentally reintroduce.
- No true partial/filtered unique index — where the logical model wants "unique while active" (e.g. one active `family_members` row per family+member), enforce it at the application layer inside the same transaction that reads-then-writes, backed by a regular (non-partial) unique index on a derived column if a stronger DB-level guarantee is needed later.

---

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

---

# Phase 2.4 — Authentication & Authorization Design (Concrete)

## 1. Authentication

- **Library**: `@nestjs/passport` + `passport-jwt` (access tokens) + a custom `LocalStrategy`-style credential check for login (identifier can be mobile or email, resolved server-side — the exact bug fixed in the previous build's `authorize()` mismatch is avoided here by having exactly one code path that accepts a single `identifier` field, never separate `email`/`mobile` fields the frontend has to choose between).
- **Password hashing**: bcrypt, cost factor 12 — proven, no reason to introduce argon2 complexity at this scale.
- **Access token**: JWT, 15-minute expiry, payload = `{ sub: userId, roles, memberId }` — deliberately minimal, since a role change shouldn't require reasoning about what else might be stale in the token.
- **Refresh token**: opaque random token, stored **hashed** in `refresh_tokens` (never the raw token), delivered to the web client as an httpOnly/Secure/SameSite=Strict cookie. Rotated on every use (old one invalidated, new one issued) — a reused, already-rotated refresh token is treated as a compromise signal and revokes the whole session family.
- **OTP verification**: 6-digit, hashed at rest (bcrypt, same as passwords — never stored or logged in plaintext), 10-minute expiry, rate-limited to 3 requests per identifier per hour.
- **Login rate limiting**: `@nestjs/throttler`, 5 attempts per identifier per 15 minutes, escalating lockout beyond that (mirrors the `failed_attempts`/`locked_until` fields already in the Phase 1 schema catalog).

## 2. Authorization

### 2.1 Role → Permission Resolution

```ts
@Injectable()
class PermissionsGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<string[]>('permissions', ctx.getHandler())
    if (!required?.length) return true
    const { user } = ctx.switchToHttp().getRequest()
    const granted = await this.permissionsForUser(user.sub)   // cached per-request, invalidated on role change
    return required.every(p => granted.has(p))
  }
}

// Usage on a controller method:
@Permissions('family:member:add')
@Post(':id/members')
addMember(...) { ... }
```

### 2.2 Record-Scoped Checks

A permission string alone answers "can this role ever do this," not "can this user do this to this specific record." Scope checks are explicit, per-module policy functions called inside the handler — not folded into the guard, because the guard can't know what "own family" means for an arbitrary route without every module leaking its data model into a generic layer:

```ts
// inside FamiliesService
async assertKartaOrAdmin(familyId: string, user: RequestUser) {
  if (user.roles.includes('ADMIN') || user.roles.includes('OPERATOR')) return
  const membership = await this.prisma.familyMember.findFirst({
    where: { familyId, memberId: user.memberId, isKarta: true, leftAt: null }
  })
  if (!membership) throw new ForbiddenException('Only the family Karta can do this.')
}
```

This is a direct carry-forward of a real gap found and fixed in the previous build (the "add member" endpoint had no ownership check at all, mid-project) — designing the scope-check pattern in from day one here rather than retrofitting it.

### 2.3 Approval-Gated Mutations

Some actions are permission-gated *and* approval-gated simultaneously (e.g. `member.mark_deceased`): the permission check confirms the submitter is even allowed to *propose* the change; the approval engine (Phase 1 §12) governs whether it takes effect immediately or waits for Operator/Admin sign-off, per `approval_rules`. The two systems are deliberately separate — a permission check is a yes/no at request time, an approval is a workflow with state.

## 3. Session/Token Storage on the Frontend

- Access token: in-memory (a React context/store), never `localStorage` — eliminates a whole class of XSS-driven token theft.
- Refresh token: httpOnly cookie, inaccessible to JavaScript entirely.
- On app load, silently attempt `/auth/refresh` using the cookie to re-establish an access token; a 401 there means genuinely logged out.

## 4. What Explicitly Never Changes Based on Role

Per Phase 1 §80's hard rules — encoded here as guard-level invariants, not just documentation: no permission check ever grants Karta the ability to edit another adult member's `PRIVATE`-visibility fields (mobile, income, matrimony settings) without that member's own consent; the guard for `profile:edit:*` always requires `user.sub == target.userId` regardless of family relationship, full stop, with the only exception being the explicit Admin escape hatch (`profile:edit:any`), which is itself `[audit]`-tagged so every use of it is traceable.

---

# Phase 2.5 — File Storage Design (Concrete)

## 1. Provider: Cloudflare R2

Object storage runs off-host — Hostinger's shared MySQL/Node hosting has no S3-compatible storage of its own, and storing uploaded photos on the app server's local disk would tie photo durability to the same box that gets rebuilt/redeployed. R2 specifically because: S3-compatible API (so the `PaymentGateway`-style abstraction pattern applies here too — swappable to AWS S3 or another provider without touching business logic), no egress fees (relevant for a photo-heavy family/community app where members browse a lot of profile photos), and a free tier generous enough to cover this project's early scale.

```ts
interface FileStorage {
  getUploadUrl(key: string, contentType: string): Promise<{ url: string; fields?: Record<string,string> }>
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
  delete(key: string): Promise<void>
}
```

## 2. Upload Flow

```
1. Client asks the API: POST /api/v1/uploads/presign  { contentType, purpose: "PROFILE_PHOTO" }
2. API validates: file-type allowlist (jpeg/png/webp only for photos), a size ceiling per
   purpose (5MB for profile photos), and that the requester is allowed to upload for this
   purpose (e.g. can't presign a "FAMILY_PHOTO" upload for a family they're not in).
3. API returns a short-lived presigned PUT URL + the object key it generated
   (`photos/{memberId}/{cuid}.jpg` — never the client-supplied filename, avoiding path
   traversal and collisions).
4. Client uploads the file bytes DIRECTLY to R2 — the Node app never sees or proxies the
   file body, keeping upload bandwidth off the app server entirely.
5. Client confirms completion: POST /api/v1/photos { key, purpose, memberId }.
6. API queues a background job (BullMQ, or the polling fallback from §14 if Redis isn't
   available on this host) to: virus/malware-scan the object, generate a thumbnail via
   `sharp`, and only then flip the photo record's status to ACTIVE — nothing surfaces the
   photo to other users until this pipeline completes.
```

## 3. Access Control

- Bucket is **private** — no object is ever publicly readable by a guessable/predictable URL, per Phase 1 §64's explicit requirement.
- Every read goes through `GET /api/v1/photos/:id` on our API, which runs the same field-visibility resolution as any other profile field (Phase 1 §9.3) before issuing a short-lived (5-minute) signed R2 GET URL — a viewer who isn't allowed to see the photo gets a 403 before a URL is ever generated, not a URL that happens to still work.
- Original uploads and generated thumbnails are stored as separate objects (`photos/{id}/original.jpg`, `photos/{id}/thumb.jpg`); list views request only the thumbnail.

## 4. Malware/Validation Checks

- MIME-type sniffing on the actual bytes (not just the client-declared `Content-Type` header) before the background pipeline trusts the file.
- A ClamAV-based scan step (or a hosted scanning API if running ClamAV isn't practical on this hosting tier — flagged as a concrete infra decision for M0) gates the ACTIVE flip in step 6 above; a failed scan deletes the object and notifies the uploader.

## 5. What's Explicitly Not Stored As a File

Receipts and invoices are generated as PDFs on demand from `financial_ledger`/`fee_invoices` data (not pre-rendered and stored) for the same reason financial history is never edited in place — the generator always reflects the current source-of-truth record, so there's no "stale PDF" to keep in sync.

---

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

---

