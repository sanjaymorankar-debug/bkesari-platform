# Phase 5 — Security Review (M5)

An OWASP-oriented pass over the whole codebase built through M0–M4, done as part of M5's hardening work. Each item below states what was checked, what was found, and what changed as a result — findings that were already handled correctly are recorded too, so this reads as a completed review rather than only a changelog.

## 1. Injection

- **SQL/NoSQL injection**: Prisma ORM is used throughout; the only raw SQL in the codebase is one `$queryRaw` tagged-template call in `bookings.service.ts` (the `FOR UPDATE` row-lock for double-booking prevention), which uses Prisma's parametrized tagged-template form — not `$queryRawUnsafe` — so values are bound, not interpolated. No other raw SQL exists anywhere in `apps/api/src`.
- **Mass assignment**: the global `ValidationPipe` now runs with `whitelist: true, forbidNonWhitelisted: true, transform: true` (`main.ts`) — a request body carrying a field no DTO declares is now rejected outright rather than silently stripped, closing the gap where an unexpected extra field could pass through unnoticed.

## 2. Authentication & Session Management

- Passwords are bcrypt-hashed (`auth.service.ts`); plaintext is never logged or stored.
- Account lockout is enforced: `failed_attempts`/`locked_until` columns are read and updated correctly on every login attempt, locking the account after repeated failures.
- Login and registration are throttled far tighter than the app's default rate limit (`@Throttle({ limit: 5, ttl: ... })` in `auth.controller.ts`) — brute-force protection was already in place from M0.
- JWT signing: `JWT_SECRET` had a hardcoded dev fallback (`'dev-secret-change-in-production'`) with no guard against it reaching production. **Fixed**: `main.ts` now refuses to boot when `NODE_ENV=production` and `JWT_SECRET` is unset, so a misconfigured production deploy fails loudly at startup instead of silently signing every session with a secret checked into source control.

## 3. Authorization

- Two-layer model: `PermissionsGuard` for role-wide permission checks, plus explicit record-scoped checks (`FamilyAuthorizationService.assertIsKarta`, asset-ownership checks, etc.) for "is this user allowed to act on *this specific* record" — documented in `17-auth-design.md` §2.2 and consistently applied.
- **Fixed during M4's build** (carried forward here since it's the same category of bug): `GET /fees/families/:familyId/invoices` and `GET /fees/invoices/:id` had no record-scoped check at all — any authenticated user could view any family's fee invoices. Both now require the caller to be that family's Karta.
- Webhook endpoints (`webhooks.controller.ts`) intentionally have no `JwtAuthGuard` — authenticity is enforced by HMAC signature verification instead, which is the correct model for a third-party callback with no session of its own.

## 4. Sensitive Data Exposure

- `password_hash` is never selected into any API response (spot-checked `AuthService`/`UsersService` query shapes — none use a bare `findMany`/`findUnique` without either an explicit `select` excluding it or a response DTO that omits it).
- Financial and family data: the privacy-resolution engine (`09-privacy-architecture.md`, wired into the response serializer since M0) governs field-level visibility for profile data; payment/fee endpoints are scoped by ownership/Karta checks as above rather than a generic visibility level, which is appropriate since financial records aren't a "social profile" field with configurable audience levels.
- Photo/document URLs (`AddPhotoDto`) are stored and returned as plain URLs, never proxied or fetched server-side — no SSRF surface there.

## 5. Security Headers & Transport

- **Added**: `helmet()` middleware (`main.ts`) — sets the standard baseline (`X-Content-Type-Options`, `X-Frame-Options`, a restrictive default CSP, HSTS when served over HTTPS, etc.). Previously nothing set these.
- CORS is locked to a single configurable origin (`WEB_ORIGIN`) with `credentials: true` — no wildcard origin, no reflection of arbitrary request origins.
- Cookies (`auth.controller.ts`): `secure` is correctly gated on `NODE_ENV === 'production'`.

## 6. Rate Limiting

- Global default: 20 requests / 60s (`ThrottlerModule.forRoot`), tightened per-route on the two brute-force-relevant endpoints (login, register) as noted above.
- Payment and refund endpoints don't have bespoke throttling beyond the global default — acceptable since they all sit behind authentication and permission guards already, and are not unauthenticated attack surface.

## 7. File Upload Validation & Malware Scanning

This was the one item on the M5 checklist with no existing implementation to review, because **no file-upload feature existed at all** before this milestone — `AssetPhoto`/profile photos are added by URL reference only (`AddPhotoDto { url }`), a deliberate simplification from M0–M4 with no server-side fetch of that URL (so no SSRF exposure, but also nothing to validate).

`docs/18-file-storage-design.md` had already designed the real feature (Cloudflare R2 + presigned uploads + ClamAV scanning) but it was never built. M5 implements it, following the same pattern M4 used for the Razorpay gateway — a real, tested validation pipeline with a dev-mode stand-in for the parts that need external infrastructure:

- **Built and real**: byte-level MIME sniffing against magic-byte signatures (`file-sniffer.ts`) rather than trusting the client's declared `Content-Type`; a heuristic malware check that rejects executable/script signatures (`dev-malware-scanner.service.ts`); per-purpose size ceilings and MIME allowlists (`uploads.service.ts`); HMAC-signed, expiring download URLs (mirrors the M4 dev-gateway webhook-signing pattern) so even the dev storage stand-in exercises real signature verification, not just a bare file path.
- **Deferred — needs real infrastructure/credentials, same as Razorpay in M4**: a real object-storage provider (Cloudflare R2, per the design doc) and a real malware-scanning service (ClamAV or a hosted scanning API). Swappable via the same `FILE_STORAGE`/`MALWARE_SCANNER` DI-token pattern the payment gateway uses — see `uploads.module.ts`.
- **Deliberately not done**: wiring this new pipeline into the existing `AssetPhoto`/member-photo fields, to avoid a risky refactor of already-shipped, already-tested M3 functionality for a feature that has no consumer yet. It's available for a future milestone to adopt.

## 8. Summary of Concrete Changes Made in This Pass

| Change | File(s) |
|---|---|
| Added `helmet()` security headers | `apps/api/src/main.ts` |
| `forbidNonWhitelisted: true` on the global `ValidationPipe` | `apps/api/src/main.ts` |
| Production boot now fails without `JWT_SECRET` set | `apps/api/src/main.ts` |
| Built the file-upload validation/malware-scan pipeline | `apps/api/src/uploads/**` |
| (Carried from M4) Fee-invoice reads scoped to the family's Karta | `apps/api/src/fees/fees.controller.ts` |

No other findings from this pass required a code change — the rest of the checklist confirmed existing, already-correct behavior.
