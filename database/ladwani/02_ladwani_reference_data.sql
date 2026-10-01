-- Mi Ladwani (NestJS + Next.js rebuild) reference data: communities, permissions, roles,
-- role-permission bundles, relationship types, approval rules, post types, asset categories.
-- Generated 2026-10-01 by hand from D:\My_Code\community-platform\apps\api\prisma\seed.ts
-- and packages\shared-types\src\roles.ts — mirrors exactly what `npm run db:seed` does there.
-- SUPERSEDES the Sep 28 version, which was copied from the older miladwani-source project
-- and does not match this schema (different column names, fewer/different post types,
-- a `settings` table this schema doesn't have, and no ASSET_OWNER role or fee/config/report
-- permissions). Run after 01_ladwani_schema.sql. Safe to re-run (INSERT IGNORE throughout).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── Community ────────────────────────────────────────────────────
INSERT IGNORE INTO communities (id, name, slug, created_at, updated_at)
VALUES (UUID(), 'Ladwani Samaj', 'ladwani-samaj', NOW(3), NOW(3));

-- ── Permissions ──────────────────────────────────────────────────
INSERT IGNORE INTO permissions (id, code, label, module) VALUES
(UUID(), 'profile:edit:own', 'profile:edit:own', 'profile'),
(UUID(), 'profile:edit:any', 'profile:edit:any', 'profile'),
(UUID(), 'family:create', 'family:create', 'family'),
(UUID(), 'family:edit:own', 'family:edit:own', 'family'),
(UUID(), 'family:join', 'family:join', 'family'),
(UUID(), 'family:member:add', 'family:member:add', 'family'),
(UUID(), 'family:member:remove', 'family:member:remove', 'family'),
(UUID(), 'family:karta:transfer', 'family:karta:transfer', 'family'),
(UUID(), 'member:marital_status:edit', 'member:marital_status:edit', 'member'),
(UUID(), 'member:mark_deceased', 'member:mark_deceased', 'member'),
(UUID(), 'approval:review', 'approval:review', 'approval'),
(UUID(), 'matrimony:manage:own', 'matrimony:manage:own', 'matrimony'),
(UUID(), 'matrimony:manage:family', 'matrimony:manage:family', 'matrimony'),
(UUID(), 'post:create', 'post:create', 'post'),
(UUID(), 'moderation:review', 'moderation:review', 'moderation'),
(UUID(), 'asset:register', 'asset:register', 'asset'),
(UUID(), 'asset:approve', 'asset:approve', 'asset'),
(UUID(), 'asset:manage:own', 'asset:manage:own', 'asset'),
(UUID(), 'booking:create', 'booking:create', 'booking'),
(UUID(), 'booking:manage:own', 'booking:manage:own', 'booking'),
(UUID(), 'fee:configure', 'fee:configure', 'fee'),
(UUID(), 'fee:pay:family', 'fee:pay:family', 'fee'),
(UUID(), 'payment:verify:offline', 'payment:verify:offline', 'payment'),
(UUID(), 'refund:approve', 'refund:approve', 'refund'),
(UUID(), 'role:manage', 'role:manage', 'role'),
(UUID(), 'audit:view', 'audit:view', 'audit'),
(UUID(), 'config:manage', 'config:manage', 'config'),
(UUID(), 'report:view', 'report:view', 'report');

-- ── Roles ────────────────────────────────────────────────────────
INSERT IGNORE INTO roles (id, code, label, is_system) VALUES
(UUID(), 'MEMBER', 'Member', 1),
(UUID(), 'KARTA', 'Family Head (Karta)', 1),
(UUID(), 'OPERATOR', 'Operator', 1),
(UUID(), 'ASSET_OWNER', 'Asset Owner', 1),
(UUID(), 'ADMIN', 'Administrator', 1);

-- ── Role-permission bundles (docs/03-roles-and-permissions.md defaults) ───
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'MEMBER' AND p.code IN (
  'profile:edit:own','family:create','family:join','member:marital_status:edit',
  'matrimony:manage:own','post:create','booking:create'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'KARTA' AND p.code IN (
  'profile:edit:own','family:create','family:join','family:edit:own','family:member:add',
  'family:member:remove','family:karta:transfer','member:marital_status:edit','member:mark_deceased',
  'matrimony:manage:own','matrimony:manage:family','post:create','booking:create','fee:pay:family'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'OPERATOR' AND p.code IN (
  'profile:edit:own','family:member:add','family:edit:own','member:mark_deceased','approval:review',
  'moderation:review','matrimony:manage:own','asset:approve','payment:verify:offline','post:create',
  'booking:create','audit:view','report:view'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ASSET_OWNER' AND p.code IN (
  'profile:edit:own','matrimony:manage:own','asset:register','asset:manage:own','booking:manage:own',
  'post:create','booking:create','audit:view'
);

-- ADMIN gets every permission that exists.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'ADMIN';

-- ── Relationship Types ───────────────────────────────────────────
INSERT IGNORE INTO relationship_types (id, code, label, inverse_code, gender_applicable, is_spouse, is_active, sort_order) VALUES
(UUID(), 'father', 'Father', 'son', 'MALE', 0, 1, 0),
(UUID(), 'mother', 'Mother', 'son', 'FEMALE', 0, 1, 0),
(UUID(), 'son', 'Son', 'father', 'MALE', 0, 1, 0),
(UUID(), 'daughter', 'Daughter', 'father', 'FEMALE', 0, 1, 0),
(UUID(), 'husband', 'Husband', 'wife', 'MALE', 1, 1, 0),
(UUID(), 'wife', 'Wife', 'husband', 'FEMALE', 1, 1, 0),
(UUID(), 'brother', 'Brother', 'brother', 'MALE', 0, 1, 0),
(UUID(), 'sister', 'Sister', 'brother', 'FEMALE', 0, 1, 0),
(UUID(), 'grandfather_p', 'Grandfather (Paternal)', 'grandson', 'MALE', 0, 1, 0),
(UUID(), 'grandmother_p', 'Grandmother (Paternal)', 'grandson', 'FEMALE', 0, 1, 0),
(UUID(), 'grandson', 'Grandson', 'grandfather_p', 'MALE', 0, 1, 0),
(UUID(), 'granddaughter', 'Granddaughter', 'grandfather_p', 'FEMALE', 0, 1, 0),
(UUID(), 'son_in_law', 'Son-in-law', 'father_in_law', 'MALE', 0, 1, 0),
(UUID(), 'daughter_in_law', 'Daughter-in-law', 'father_in_law', 'FEMALE', 0, 1, 0),
(UUID(), 'father_in_law', 'Father-in-law', 'son_in_law', 'MALE', 0, 1, 0),
(UUID(), 'mother_in_law', 'Mother-in-law', 'son_in_law', 'FEMALE', 0, 1, 0);

-- ── Approval Rules (docs/12-approval-workflow.md §4) ─────────────
INSERT IGNORE INTO approval_rules (id, action_code, requires_approval, approver_role) VALUES
(UUID(), 'family.create', 1, 'OPERATOR'),
(UUID(), 'family.member.add', 1, 'OPERATOR'),
(UUID(), 'family.karta.transfer', 1, 'ADMIN'),
(UUID(), 'family.merge', 1, 'ADMIN'),
(UUID(), 'member.marital_status.change', 1, 'OPERATOR'),
(UUID(), 'member.mark_deceased', 1, 'OPERATOR'),
(UUID(), 'member.relationship.change', 1, 'OPERATOR'),
(UUID(), 'asset.register', 1, 'OPERATOR'),
(UUID(), 'asset.suspend', 1, 'ADMIN'),
(UUID(), 'offline_payment.verify', 1, 'OPERATOR'),
(UUID(), 'data.deletion_request', 1, 'ADMIN'),
(UUID(), 'member.edit_own', 0, NULL);

-- ── Post Types (starter catalog — Admin can add more via /admin/config) ───
INSERT IGNORE INTO post_types (id, code, label, icon, requires_approval, is_active) VALUES
(UUID(), 'GENERAL', 'General', 'message-circle', 0, 1),
(UUID(), 'ANNOUNCEMENT', 'Announcement', 'megaphone', 1, 1),
(UUID(), 'EVENT', 'Event', 'calendar', 0, 1),
(UUID(), 'HELP_REQUEST', 'Help Request', 'life-buoy', 0, 1),
(UUID(), 'CONDOLENCE', 'Condolence', 'flower', 0, 1);

-- ── Asset Categories (starter catalog — Admin can add more via /admin/config) ───
INSERT IGNORE INTO asset_categories (id, code, label, sort_order, is_active) VALUES
(UUID(), 'MARRIAGE_HALL', 'Marriage Hall', 1, 1),
(UUID(), 'COMMUNITY_HALL', 'Community Hall', 2, 1),
(UUID(), 'GUEST_HOUSE', 'Guest House', 3, 1),
(UUID(), 'GROUND', 'Open Ground', 4, 1);

-- The first administrator is set up by 03_ladwani_first_admin.sql.
