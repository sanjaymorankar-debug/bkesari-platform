-- Mi Ladwani (NestJS + Next.js rebuild) reference data: communities, permissions, roles,
-- role-permission bundles, relationship types, approval rules, post types, asset categories,
-- and the M6 profile catalogs (education levels, occupations, skills).
-- Generated 2026-10-02 by hand from apps/api/prisma/seed.ts and
-- packages/shared-types/src/roles.ts on branch `rebuild` of
-- github.com/sanjaymorankar-debug/Ladwani (renamed from `miladwani`) at 516d3b9 —
-- mirrors exactly what `npm run db:seed` does there. On the Mac that tree is at
-- /Users/agtci/Documents/Project_Documents/Projects/community-platform.
-- SUPERSEDES the 2026-10-01 version, which predates M6 and therefore left
-- education_levels, occupations and skills EMPTY — the profile and matrimony dropdowns
-- those feed would have had nothing to show.
-- SUPERSEDES the Sep 28 version, which was copied from the older single-Next.js app
-- and does not match this schema (different column names, fewer/different post types,
-- a `settings` table this schema doesn't have, and no ASSET_OWNER role or fee/config/report
-- permissions). Run after 01_ladwani_schema.sql. Safe to re-run (every INSERT ends in
-- ON CONFLICT DO NOTHING, so a row whose code already exists is left alone).
--
-- PostgreSQL 13 or newer (gen_random_uuid() is built in from 13). Timestamps are written in
-- UTC, which is how Prisma stores DateTime in these TIMESTAMP(3) columns.
--     psql "$LADWANI_DATABASE_URL" -v ON_ERROR_STOP=1 -f 02_ladwani_reference_data.sql

-- ── Community ────────────────────────────────────────────────────
INSERT INTO communities (id, name, slug, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'Ladwani Samaj', 'ladwani-samaj', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
ON CONFLICT DO NOTHING;

-- ── Permissions ──────────────────────────────────────────────────
INSERT INTO permissions (id, code, label, module) VALUES
(gen_random_uuid()::text, 'profile:edit:own', 'profile:edit:own', 'profile'),
(gen_random_uuid()::text, 'profile:edit:any', 'profile:edit:any', 'profile'),
(gen_random_uuid()::text, 'family:create', 'family:create', 'family'),
(gen_random_uuid()::text, 'family:edit:own', 'family:edit:own', 'family'),
(gen_random_uuid()::text, 'family:join', 'family:join', 'family'),
(gen_random_uuid()::text, 'family:member:add', 'family:member:add', 'family'),
(gen_random_uuid()::text, 'family:member:remove', 'family:member:remove', 'family'),
(gen_random_uuid()::text, 'family:karta:transfer', 'family:karta:transfer', 'family'),
(gen_random_uuid()::text, 'member:marital_status:edit', 'member:marital_status:edit', 'member'),
(gen_random_uuid()::text, 'member:mark_deceased', 'member:mark_deceased', 'member'),
(gen_random_uuid()::text, 'approval:review', 'approval:review', 'approval'),
(gen_random_uuid()::text, 'matrimony:manage:own', 'matrimony:manage:own', 'matrimony'),
(gen_random_uuid()::text, 'matrimony:manage:family', 'matrimony:manage:family', 'matrimony'),
(gen_random_uuid()::text, 'post:create', 'post:create', 'post'),
(gen_random_uuid()::text, 'moderation:review', 'moderation:review', 'moderation'),
(gen_random_uuid()::text, 'asset:register', 'asset:register', 'asset'),
(gen_random_uuid()::text, 'asset:approve', 'asset:approve', 'asset'),
(gen_random_uuid()::text, 'asset:manage:own', 'asset:manage:own', 'asset'),
(gen_random_uuid()::text, 'booking:create', 'booking:create', 'booking'),
(gen_random_uuid()::text, 'booking:manage:own', 'booking:manage:own', 'booking'),
(gen_random_uuid()::text, 'fee:configure', 'fee:configure', 'fee'),
(gen_random_uuid()::text, 'fee:pay:family', 'fee:pay:family', 'fee'),
(gen_random_uuid()::text, 'payment:verify:offline', 'payment:verify:offline', 'payment'),
(gen_random_uuid()::text, 'refund:approve', 'refund:approve', 'refund'),
(gen_random_uuid()::text, 'role:manage', 'role:manage', 'role'),
(gen_random_uuid()::text, 'audit:view', 'audit:view', 'audit'),
(gen_random_uuid()::text, 'config:manage', 'config:manage', 'config'),
(gen_random_uuid()::text, 'report:view', 'report:view', 'report')
ON CONFLICT DO NOTHING;

-- ── Roles ────────────────────────────────────────────────────────
INSERT INTO roles (id, code, label, is_system) VALUES
(gen_random_uuid()::text, 'MEMBER', 'Member', true),
(gen_random_uuid()::text, 'KARTA', 'Family Head (Karta)', true),
(gen_random_uuid()::text, 'OPERATOR', 'Operator', true),
(gen_random_uuid()::text, 'ASSET_OWNER', 'Asset Owner', true),
(gen_random_uuid()::text, 'ADMIN', 'Administrator', true)
ON CONFLICT DO NOTHING;

-- ── Role-permission bundles (docs/03-roles-and-permissions.md defaults) ───
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'MEMBER' AND p.code IN (
  'profile:edit:own','family:create','family:join','member:marital_status:edit',
  'matrimony:manage:own','post:create','booking:create'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'KARTA' AND p.code IN (
  'profile:edit:own','family:create','family:join','family:edit:own','family:member:add',
  'family:member:remove','family:karta:transfer','member:marital_status:edit','member:mark_deceased',
  'matrimony:manage:own','matrimony:manage:family','post:create','booking:create','fee:pay:family'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'OPERATOR' AND p.code IN (
  'profile:edit:own','family:member:add','family:edit:own','member:mark_deceased','approval:review',
  'moderation:review','matrimony:manage:own','asset:approve','payment:verify:offline','post:create',
  'booking:create','audit:view','report:view'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ASSET_OWNER' AND p.code IN (
  'profile:edit:own','matrimony:manage:own','asset:register','asset:manage:own','booking:manage:own',
  'post:create','booking:create','audit:view'
)
ON CONFLICT DO NOTHING;

-- ADMIN gets every permission that exists.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- ── Relationship Types ───────────────────────────────────────────
INSERT INTO relationship_types (id, code, label, inverse_code, gender_applicable, is_spouse, is_active, sort_order) VALUES
(gen_random_uuid()::text, 'father', 'Father', 'son', 'MALE', false, true, 0),
(gen_random_uuid()::text, 'mother', 'Mother', 'son', 'FEMALE', false, true, 0),
(gen_random_uuid()::text, 'son', 'Son', 'father', 'MALE', false, true, 0),
(gen_random_uuid()::text, 'daughter', 'Daughter', 'father', 'FEMALE', false, true, 0),
(gen_random_uuid()::text, 'husband', 'Husband', 'wife', 'MALE', true, true, 0),
(gen_random_uuid()::text, 'wife', 'Wife', 'husband', 'FEMALE', true, true, 0),
(gen_random_uuid()::text, 'brother', 'Brother', 'brother', 'MALE', false, true, 0),
(gen_random_uuid()::text, 'sister', 'Sister', 'brother', 'FEMALE', false, true, 0),
(gen_random_uuid()::text, 'grandfather_p', 'Grandfather (Paternal)', 'grandson', 'MALE', false, true, 0),
(gen_random_uuid()::text, 'grandmother_p', 'Grandmother (Paternal)', 'grandson', 'FEMALE', false, true, 0),
(gen_random_uuid()::text, 'grandson', 'Grandson', 'grandfather_p', 'MALE', false, true, 0),
(gen_random_uuid()::text, 'granddaughter', 'Granddaughter', 'grandfather_p', 'FEMALE', false, true, 0),
(gen_random_uuid()::text, 'son_in_law', 'Son-in-law', 'father_in_law', 'MALE', false, true, 0),
(gen_random_uuid()::text, 'daughter_in_law', 'Daughter-in-law', 'father_in_law', 'FEMALE', false, true, 0),
(gen_random_uuid()::text, 'father_in_law', 'Father-in-law', 'son_in_law', 'MALE', false, true, 0),
(gen_random_uuid()::text, 'mother_in_law', 'Mother-in-law', 'son_in_law', 'FEMALE', false, true, 0)
ON CONFLICT DO NOTHING;

-- ── Approval Rules (docs/12-approval-workflow.md §4) ─────────────
INSERT INTO approval_rules (id, action_code, requires_approval, approver_role) VALUES
(gen_random_uuid()::text, 'family.create', true, 'OPERATOR'),
(gen_random_uuid()::text, 'family.member.add', true, 'OPERATOR'),
(gen_random_uuid()::text, 'family.karta.transfer', true, 'ADMIN'),
(gen_random_uuid()::text, 'family.merge', true, 'ADMIN'),
(gen_random_uuid()::text, 'member.marital_status.change', true, 'OPERATOR'),
(gen_random_uuid()::text, 'member.mark_deceased', true, 'OPERATOR'),
(gen_random_uuid()::text, 'member.relationship.change', true, 'OPERATOR'),
(gen_random_uuid()::text, 'asset.register', true, 'OPERATOR'),
(gen_random_uuid()::text, 'asset.suspend', true, 'ADMIN'),
(gen_random_uuid()::text, 'offline_payment.verify', true, 'OPERATOR'),
(gen_random_uuid()::text, 'data.deletion_request', true, 'ADMIN'),
(gen_random_uuid()::text, 'member.edit_own', false, NULL)
ON CONFLICT DO NOTHING;

-- ── Post Types (starter catalog — Admin can add more via /admin/config) ───
INSERT INTO post_types (id, code, label, icon, requires_approval, is_active) VALUES
(gen_random_uuid()::text, 'GENERAL', 'General', 'message-circle', false, true),
(gen_random_uuid()::text, 'ANNOUNCEMENT', 'Announcement', 'megaphone', true, true),
(gen_random_uuid()::text, 'EVENT', 'Event', 'calendar', false, true),
(gen_random_uuid()::text, 'HELP_REQUEST', 'Help Request', 'life-buoy', false, true),
(gen_random_uuid()::text, 'CONDOLENCE', 'Condolence', 'flower', false, true)
ON CONFLICT DO NOTHING;

-- ── Asset Categories (starter catalog — Admin can add more via /admin/config) ───
INSERT INTO asset_categories (id, code, label, sort_order, is_active) VALUES
(gen_random_uuid()::text, 'MARRIAGE_HALL', 'Marriage Hall', 1, true),
(gen_random_uuid()::text, 'COMMUNITY_HALL', 'Community Hall', 2, true),
(gen_random_uuid()::text, 'GUEST_HOUSE', 'Guest House', 3, true),
(gen_random_uuid()::text, 'GROUND', 'Open Ground', 4, true)
ON CONFLICT DO NOTHING;

-- ── Education Levels (M6 starter catalog — Admin can add more via /admin/config) ───
INSERT INTO education_levels (id, code, label, sort_order, is_active) VALUES
(gen_random_uuid()::text, 'BELOW_10TH', 'Below 10th', 1, true),
(gen_random_uuid()::text, 'SSC', 'SSC / 10th', 2, true),
(gen_random_uuid()::text, 'HSC', 'HSC / 12th', 3, true),
(gen_random_uuid()::text, 'DIPLOMA', 'Diploma', 4, true),
(gen_random_uuid()::text, 'GRADUATE', 'Bachelor''s Degree', 5, true),
(gen_random_uuid()::text, 'POST_GRADUATE', 'Master''s Degree', 6, true),
(gen_random_uuid()::text, 'DOCTORATE', 'Doctorate', 7, true),
(gen_random_uuid()::text, 'OTHER', 'Other', 8, true)
ON CONFLICT DO NOTHING;

-- ── Occupations (M6 starter catalog — Admin can add more via /admin/config) ───
INSERT INTO occupations (id, code, label, sort_order, is_active) VALUES
(gen_random_uuid()::text, 'STUDENT', 'Student', 1, true),
(gen_random_uuid()::text, 'SALARIED', 'Salaried Professional', 2, true),
(gen_random_uuid()::text, 'BUSINESS', 'Business Owner', 3, true),
(gen_random_uuid()::text, 'GOVERNMENT', 'Government Service', 4, true),
(gen_random_uuid()::text, 'FARMER', 'Agriculture', 5, true),
(gen_random_uuid()::text, 'HOMEMAKER', 'Homemaker', 6, true),
(gen_random_uuid()::text, 'RETIRED', 'Retired', 7, true),
(gen_random_uuid()::text, 'NOT_WORKING', 'Not Working', 8, true),
(gen_random_uuid()::text, 'OTHER', 'Other', 9, true)
ON CONFLICT DO NOTHING;

-- ── Skills (M6 starter catalog — Admin can add more via /admin/config) ───
-- `skills` has no sort_order in the schema; the app orders by label.
INSERT INTO skills (id, code, label, is_active) VALUES
(gen_random_uuid()::text, 'COOKING', 'Cooking', true),
(gen_random_uuid()::text, 'MUSIC', 'Music', true),
(gen_random_uuid()::text, 'TEACHING', 'Teaching', true),
(gen_random_uuid()::text, 'ACCOUNTING', 'Accounting', true),
(gen_random_uuid()::text, 'IT_SOFTWARE', 'IT / Software', true),
(gen_random_uuid()::text, 'HANDICRAFT', 'Handicraft', true),
(gen_random_uuid()::text, 'PUBLIC_SPEAKING', 'Public Speaking', true)
ON CONFLICT DO NOTHING;

-- member_skills is a join table filled by members themselves; it has no seed data.

-- The first administrator is set up by 03_ladwani_first_admin.sql.
