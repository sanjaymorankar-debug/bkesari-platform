# Phase 5 — Load & Performance Review (M5)

## 1. Methodology and Its Limits

The roadmap's target is 10,000 families / 100,000 members. This review does not include a literal load test generating that volume of synthetic data and firing concurrent traffic at it — the local dev environment this build runs against is a single modest MySQL instance shared with active schema migrations throughout M0–M5, and a 100k-row synthetic load test against it would be slow to run and not representative of the eventual production host's hardware anyway. What this review does instead, and what it found:

1. **A full audit of every `findMany`/`findFirst`/`count`/`groupBy`/`aggregate` call across `apps/api/src/**` service files**, cataloguing exactly which columns each hot query filters or sorts on.
2. **A check of the schema against that audit** — and the finding was stark: before this pass, `schema.prisma` had **zero explicit `@@index` declarations anywhere**. Every list/search/report query was relying only on Prisma's automatic indexes for `@id`, `@unique`, and foreign-key columns — which cover joins, but not the `status`/`deletedAt`/`isVisible`/date-range/boolean filters that every list view and search actually runs on.
3. **Composite indexes added for every hot path identified**, in migration `m5_performance_indexes`, matched to the exact `where`/`orderBy` shape of the query that needs it (column order matters for a composite index's usefulness — each one below is ordered to match its query).

This is the load-bearing part of a performance pass at this project stage: at 100k rows, a query that table-scans because it has no supporting index doesn't degrade gracefully, it falls over. The concurrency-safe booking lock (`FOR UPDATE` in `bookings.service.ts`, load-tested for double-booking prevention back in M3) remains the one query pattern in this codebase that's actually been exercised under concurrent load.

## 2. Indexes Added and Why

| Model | Index | Query it serves |
|---|---|---|
| `User` | `deletedAt` | Login lookup excludes soft-deleted accounts — every login |
| `Family` | `deletedAt` | Family search/duplicate-check |
| `Member` | `(deletedAt, gender)`, `(deletedAt, maritalStatus)`, `(deletedAt, status)` | Directory search, matrimony search, demographics report |
| `FamilyMember` | `(memberId, leftAt)`, `(familyId, leftAt)` | Karta-authorization check (`isKartaOf` — fires on nearly every family-scoped write), family tree render |
| `FamilyJoinRequest` | `(familyId, status)` | Karta's pending-join-requests view |
| `MemberRelationship` | `(isActive, fromMemberId)` | Family tree traversal |
| `UserRole` | `(userId, familyId)` | The Karta-authorization check — cross-cutting, called from members/family/fees services |
| `VerificationToken` | `(userId, type, usedAt)` | OTP verification during register/login |
| `MatrimonyProfile` | `isVisible` | Matrimony search's top-level filter |
| `MatrimonyInterest` | `(toMemberId, createdAt)`, `(fromMemberId, createdAt)`, `status` | Sent/received interest lists, admin report |
| `Post` | `(deletedAt, status, isPinned, createdAt)` | **The community feed — fires on every visit** |
| `Report` (moderation) | `(status, createdAt)` | Moderation queue |
| `Asset` | `(deletedAt, status)`, `(deletedAt, categoryId)` | Asset browse/search, services report |
| `Booking` | `(userId, createdAt)`, `(status, assetId)` | "My bookings" dashboard, revenue-by-asset report |
| `Review` | `(assetId, createdAt)` | Asset detail's reviews tab |
| `Notification` | `(recipientId, isRead, createdAt)` | **The unread-count badge in `TopBar` — fires on every single page load** |
| `AuditLog` | `(actorId, createdAt)`, `(entityType, createdAt)` | The M5 audit log viewer's filters — this table previously had no indexes at all, not even a FK-derived one, since it has no relations |
| `Approval` | `(status, submittedAt)` | The approval queue — loaded every time an Operator/Admin opens it |
| `PaymentTransaction` | `(gatewayCode, status, updatedAt)` | The reconciliation job's stuck-transaction scan |
| `PaymentGatewayTransaction` | `gatewayOrderId` | Webhook lookup — fires on every inbound gateway webhook, and was previously unindexed (not unique, not a FK) |
| `FinancialLedgerEntry` | `entryType` | Financial report's groupBy |
| `FamilyArea` | `areaId` | Demographics-by-area report (the model's primary key is `(familyId, areaId)`, so `areaId` alone had no usable index) |
| `Donation` | `(donorUserId, createdAt)` | "My donations" list |
| `FeeInvoice` | `(familyId, createdAt)` | Family's fee-invoice dashboard |

Not indexed, deliberately: `AssetAvailability`'s `(assetId, date)` lookup is already served by its existing `@@unique([assetId, date, slot])` constraint's leftmost prefix — a separate index would be redundant. Small reference/lookup tables (`PostType`, `AssetCategory`, `Area`, `DonationCause`, `CommunityFeeType`) were left alone — row counts there stay small regardless of platform scale, so a full scan is never the bottleneck.

## 3. What Wasn't Covered

- **`Member.firstName`/`lastName` substring search** (`contains` queries in directory/duplicate-detection search) doesn't benefit from a standard B-tree index the way equality/range filters do. A real fix at scale is a MySQL `FULLTEXT` index or moving search to a dedicated engine (e.g. Meilisearch/Elasticsearch) — flagged here as a known gap rather than solved, since it's a bigger architectural change than an index migration.
- **N+1 query patterns**: this pass focused on missing indexes, not query-shape review (e.g. whether a list endpoint issues one query per row instead of a single joined/batched one). That's a legitimate follow-up but wasn't in scope for the time available in M5.
- **Actual concurrent-load testing** against a realistic production-sized dataset — noted in §1 as intentionally out of scope for this pass given the environment constraints; the recommendation for whoever does that testing later is to seed a synthetic dataset at the target scale and run `EXPLAIN ANALYZE` on the exact queries catalogued above to confirm each index is actually being chosen by the query planner, not just present.

## 4. Migration

`prisma/migrations/*_m5_performance_indexes/` — additive only (no columns changed, no data touched), so it carries none of the risk a column/type migration would.
