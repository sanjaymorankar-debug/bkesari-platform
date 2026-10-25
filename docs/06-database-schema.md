# Phase 1.6 — Database Schema (Entity Catalog)

**Engine: MySQL 8** (Hostinger-hosted, same server as the app — see `13-development-roadmap.md` for why). This is the **logical schema catalog** for sign-off: every table, its purpose, and its key/distinguishing fields. Full DDL, exact column types, indexes, and migration files are the concrete output of **Phase 4 — Database**, not duplicated here. All tables include `id (string, pk — app-generated cuid, stored as varchar(191))`, `created_at`, `updated_at` unless noted; mutable community-owned records also carry `created_by`/`updated_by`. Nothing described as "soft delete" is ever hard-deleted. Structured/nested fields (`jsonb` in a Postgres-native design) are `JSON` columns — MySQL 8's native JSON type — noted as `jsonb` in table cells below only because that's the more universally-recognized shorthand for "structured JSON blob column"; the actual column type is MySQL's `JSON`.

Conventions: `FK→table` = foreign key. `[soft-delete]` = has `deleted_at`. `[audit]` = mutations to this table are expected to also write an `audit_logs` row.

## A. Identity & Access

| Table | Purpose | Key fields |
|---|---|---|
| `communities` | Tenant boundary (one row today) | name, slug, logo_url, settings jsonb |
| `users` | Login identity | email, mobile, password_hash, status (PENDING/ACTIVE/SUSPENDED/BLOCKED/DEACTIVATED), email_verified, mobile_verified, last_login_at, failed_attempts, locked_until `[soft-delete]` |
| `roles` | MEMBER/KARTA/OPERATOR/ASSET_OWNER/ADMIN, admin-editable | code, label, is_system |
| `permissions` | Granular `resource:action` strings | code, label, module |
| `user_roles` | User↔role, scoped optionally to a family/area | user_id FK→users, role_id FK→roles, family_id FK→families (nullable), area_id FK→areas (nullable) |
| `role_permissions` | Role↔permission bundle | role_id, permission_id |
| `refresh_tokens` | Session/refresh token store | user_id, token_hash, device_info, expires_at, revoked_at |
| `verification_tokens` | OTP/email-verify tokens | user_id, type, token_hash, expires_at, used_at |
| `consent_records` | Explicit consent trail | user_id, consent_type, granted, version, ip_address |

## B. Family Registry & Tree

| Table | Purpose | Key fields |
|---|---|---|
| `families` `[audit][soft-delete]` | The family unit | community_id, registration_number (unique), name, surname, karta_member_id FK→members, kuladevata, kuladevi, gotra, native_village/district/state/country, verification_status, status |
| `members` `[audit][soft-delete]` | A person (may or may not have a login) | user_id FK→users (nullable), first/middle/last_name, gender, date_of_birth, marital_status, status (ACTIVE/INACTIVE/DECEASED/SUSPENDED), deceased_at/place/notes, profile_photo_id |
| `family_members` | Family↔member membership, with history | family_id, member_id, is_karta, joined_at, joined_by, left_at, left_reason (unique on family_id+member_id while active) |
| `family_join_requests` | Consent gate for linking an existing member into a family, from either direction (Karta-invites or member-requests) | family_id, member_id, related_to_member_id, relationship_type_code, requested_by, status (PENDING/APPROVED/DECLINED) |
| `relationship_types` | Configurable relationship vocabulary | code (unique), label, inverse_code, gender_applicable, is_spouse, sort_order |
| `member_relationships` | The graph edges the tree is built from | from_member_id, to_member_id, relationship_type_id, family_id, is_active |
| `marital_status_history` | Every status transition, not just current | member_id, status, effective_date, changed_by, approval_id |
| `marriage_records` | Marriage-specific facts (may reference a non-community spouse) | member_id_1, member_id_2 (nullable), external_spouse_name/info, marriage_date, status |
| `addresses` | Current + native addresses for a family or member | addressable_type, family_id (nullable FK), member_id (nullable FK) — **two nullable FKs, not one polymorphic column**, address_type, line1/2, city/district/state/pincode, is_primary |

## C. Education, Employment, Skills, Income

| Table | Purpose | Key fields |
|---|---|---|
| `education_records` | One member, many entries | member_id, level, qualification, specialization, institution, year_completed, is_highest |
| `employment_records` | Job history | member_id, employment_type, employer_name, designation, industry, income_range_id, is_current |
| `businesses` | Business ownership | member_id, business_name, business_type, industry, income_range_id, is_active |
| `skills` | Admin-managed skill catalog | name (unique), category |
| `member_skills` | Member↔skill, with level | member_id, skill_id, level |
| `income_ranges` | Configurable buckets, never exact salary | label, min_value, max_value, sort_order |

## D. Matrimony

| Table | Purpose | Key fields |
|---|---|---|
| `matrimonial_profiles` | Opt-in extension of a member profile | member_id (unique), is_visible, about, height_cm, languages jsonb |
| `matrimonial_preferences` | Partner preferences | matrimonial_profile_id (unique), min/max_age, preferred_gender, preferred_locations jsonb, education/occupation preference, income_range_id |
| `matrimonial_interests` | Send Interest / Request Contact | from_member_id, to_member_id, message, status (PENDING/ACCEPTED/DECLINED/WITHDRAWN) |
| `matrimonial_saves` | Save-for-later | member_id, saved_member_id |

## E. Community Social Network & Areas

| Table | Purpose | Key fields |
|---|---|---|
| `areas` | Country→State→District→City→Area→Group hierarchy | community_id, parent_id (self FK), name, type, code |
| `member_areas` / `family_areas` | Many-to-many area membership | member_id/family_id, area_id, is_primary |
| `post_types` | Configurable post categories | code, label, icon, requires_approval |
| `posts` `[soft-delete]` | Community feed content | author_id, post_type_id, title, content, visibility, target_area_id, status, is_pinned |
| `comments` `[soft-delete]` | Threaded replies | post_id, author_id, parent_id (self FK), content |
| `reactions` | Like/love/etc. on a post **or** comment | post_id (nullable FK), comment_id (nullable FK) — again, two nullable FKs rather than one polymorphic column, unique per (post_id, user_id) and (comment_id, user_id) | 
| `reports` | User-filed content/user reports | reportable_type, reportable_id, reporter_id, reason, status |

## F. Community Services, Assets & Booking

| Table | Purpose | Key fields |
|---|---|---|
| `asset_categories` | Extensible category tree (accommodation, events, future: caterers, photographers, etc.) | code, label, parent_id |
| `asset_owners` | Owner/service-provider profile | user_id (unique), business_name, verified_at |
| `assets` `[audit][soft-delete]` | The bookable thing | asset_owner_id, category_id, name, description, address/city/district/state/pincode, geo_lat/lng, area_id, capacity, status |
| `asset_photos` / `asset_documents` | Media & compliance docs | asset_id, url, sort_order |
| `asset_facilities` | Facility tags (parking, AC, catering-allowed, etc.) | asset_id, facility_code |
| `asset_pricing` | Base/seasonal/weekend/community-member pricing | asset_id, price_type, amount, valid_from/to |
| `asset_availability` | Materialized per-date/slot availability | asset_id, date, slot, status (AVAILABLE/RESERVED/PENDING/BLOCKED/MAINTENANCE/HOLIDAY) — **unique (asset_id, date, slot)**, this is the row a booking transaction locks |
| `asset_blocked_dates` | Owner-initiated blocks | asset_id, date_from, date_to, reason |
| `asset_services` | Add-on services offered by an asset | asset_id, code, label |
| `asset_service_pricing` | Pricing for an add-on | asset_service_id, amount, unit |
| `asset_verification` | The approval-workflow instance for an asset | asset_id, status, submitted_by, reviewed_by, notes |
| `bookings` `[audit]` | A confirmed-or-in-progress reservation | asset_id, user_id, status (REQUESTED/CONFIRMED/CANCELLED/COMPLETED/EXPIRED), booking_type (INSTANT/REQUEST), date_from/to, total_amount |
| `booking_items` | Line items: base rate + selected services | booking_id, item_type, description, quantity, unit_price |
| `booking_guests` | Minimal guest/attendee info where relevant | booking_id, name, contact |
| `booking_status_history` | Every status transition | booking_id, from_status, to_status, changed_by, reason |
| `reviews` / `ratings` | Post-completion feedback, gated on a completed booking | booking_id (unique per reviewer), asset_id, overall/cleanliness/facilities/service/value/location scores, comment |
| `asset_reports` | Reports against an asset (distinct from generic content reports) | asset_id, reporter_id, reason |

## G. Payments

| Table | Purpose | Key fields |
|---|---|---|
| `payment_methods` | Enabled methods per gateway | gateway_code, method_code (UPI/CARD/NETBANKING/WALLET), is_active |
| `payment_transactions` | **The single row every payment flow (fee, booking, donation) creates one of** | user_id, purpose_type (FEE/BOOKING/DONATION), purpose_id, gateway_code, amount, currency, status |
| `payment_gateway_transactions` | Raw gateway-side state, 1:1 with the above | payment_transaction_id, gateway_order_id, gateway_payment_id, gateway_signature, raw_response jsonb |
| `payment_webhooks` | Every inbound webhook, verified or not, for replay/audit | payment_transaction_id (nullable until matched), event_type, signature_valid, payload jsonb, received_at |
| `payment_receipts` | Generated receipt artifact | payment_transaction_id, receipt_number (unique), pdf_url |
| `refunds` | Refund against a transaction | payment_transaction_id, amount, reason, status, gateway_refund_id |
| `booking_payments` | Ties a booking to one or more payment_transactions (advance + balance) | booking_id, payment_transaction_id, payment_stage (ADVANCE/BALANCE/FULL) |
| `booking_invoices` | Tax invoice for a booking | booking_id, invoice_number, tax_amount, total_amount |
| `booking_refunds` | Cancellation refund detail for a booking | booking_id, refund_id FK→refunds, cancellation_charge |

## H. Community Fees & Donations

| Table | Purpose | Key fields |
|---|---|---|
| `financial_years` | e.g. "2026-27" | label (unique), start_date, end_date |
| `community_fee_types` | Registration/annual/monthly/event/etc. | code, label, default_amount, frequency |
| `community_fee_rules` | Amount + applicability for a fee type in a financial year | fee_type_id, financial_year_id, amount, applicable_area_id/family_category, late_fee_config jsonb, grace_period_days |
| `family_fee_assignments` / `member_fee_assignments` | Which fee rule applies to which family/member | family_id or member_id, fee_rule_id, effective_date |
| `fee_invoices` `[audit]` | A billed amount for a family, one financial year | family_id, fee_rule_id, financial_year_id, amount_billed, amount_paid, status (UNPAID/PARTIAL/PAID/OVERDUE/WAIVED), due_date |
| `fee_invoice_items` | Line items (base amount, late fee, discount as negative line) | fee_invoice_id, description, amount |
| `discounts` / `waivers` | Applied reductions, always with a reason | fee_invoice_id, type, original_amount, reduction_amount, reason, approved_by |
| `late_fees` | Accrued late-fee records | fee_invoice_id, amount, accrued_on |
| `payment_reminders` | Scheduled/sent reminder log | fee_invoice_id, channel, scheduled_for, sent_at |
| `offline_payments` `[audit]` | Cash/bank/cheque payment pending human verification | fee_invoice_id, amount, method, reference, status (PENDING_VERIFICATION/VERIFIED), verified_by |
| `donation_causes` | Configurable donation causes | code, label, is_active |
| `donations` | A donation, always distinct from a mandatory fee | donor_user_id, cause_id, amount, payment_transaction_id |
| `financial_ledger` | **The append-only source of truth for every rupee** | entry_type (FEE/BOOKING/DONATION/REFUND/ADJUSTMENT), family_id, member_id, booking_id, invoice_id, payment_transaction_id, amount, tax, discount, net_amount, financial_year_id, created_by, verified_by |
| `payment_reconciliation` | Reconciliation run output | run_date, gateway_code, mismatches jsonb, resolved_by |

## I. Approval, Privacy, Notifications, Audit

| Table | Purpose | Key fields |
|---|---|---|
| `approval_rules` | Which action codes require approval and by whom | action_code (unique), requires_approval, approver_role, auto_approve_role |
| `approvals` | An in-flight or resolved approval instance | action_code, entity_type, entity_id, field_name, old_value/new_value jsonb, status, submitted_by, reviewed_by, reason |
| `audit_logs` | Immutable action trail | actor_id, actor_role, action, entity_type, entity_id, field_name, old_value/new_value jsonb, approval_id, ip_address |
| `field_visibility_settings` | Per-member, per-field visibility override (defaults come from `field_visibility_defaults`) | member_id, field_name, visibility (PUBLIC/COMMUNITY/AREA/FAMILY/MATRIMONY/ADMIN/PRIVATE) |
| `field_visibility_defaults` | Community-wide default per field | field_name (unique), default_visibility, is_user_configurable |
| `notifications` | In-app notification feed | recipient_id, sender_id, type, title, body, data jsonb, is_read, email_sent, sms_sent |
| `reports` | (see section E — shared table for post/comment/member/asset reports via `reportable_type`) | |
| `settings` | Free-form community config | key (unique), value jsonb, description |

## J. Polymorphism Policy

Several tables above (`addresses`, `reactions`, future `photos`) hold data that conceptually attaches to more than one parent type (a family *or* a member; a post *or* a comment). Every one of them uses **separate nullable foreign-key columns per target type** with real referential-integrity constraints — never a single shared "any-table" id column. A single shared id column can't carry a real foreign-key constraint in MySQL (or any relational database) since a physical FK constraint is inherently table-and-column specific — this exact mistake in the previous Ladwani project's schema broke Prisma's own constraint-naming validation before it ever reached a real database. Building it correctly from the start avoids a class of bug that would otherwise surface only once real data volume made it expensive to fix.
