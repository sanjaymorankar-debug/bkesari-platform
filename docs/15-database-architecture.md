# Phase 2.2 — Database Architecture (Concrete)

> **Database: PostgreSQL since 2026-10-24.** This document was written for MySQL 8.
> The app now runs on PostgreSQL (Neon in the hosted tiers). Read MySQL-specific
> commands here (mysqldump, phpMyAdmin, InnoDB settings) as their PostgreSQL
> equivalents (pg_dump/pg_restore, the Neon console, Neon branches and restore);
> `docs/26-local-testing.md` describes what changed in the code.

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
