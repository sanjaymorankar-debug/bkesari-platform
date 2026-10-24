-- Mi Ladwani (NestJS + Next.js rebuild): the FIRST administrator. Run after 01 and 02.
-- Pick ONE option. Safe to re-run: nothing is duplicated.
-- PostgreSQL. Run it with psql, or paste it into any SQL console connected to the
-- LadWani database (each statement is self-contained: the values you edit sit in a
-- `params` list at the top of each one, because PostgreSQL has no @session variables).
-- SUPERSEDES the Sep 28 version, which used the old schema's camelCase column names
-- (userId, roleId, passwordHash, memberNumber) — this schema uses snake_case
-- (user_id, role_id, password_hash) and has no memberNumber column at all.

-- ============================================================================
-- OPTION A (simplest): promote an account you registered on the site.
--   1. Open https://ladwani.bkesari.com/register (or testladwani...) and register.
--      Registration already creates both the user and their member record.
--   2. Edit the email in BOTH statements below and run ONLY this block.
-- ============================================================================
WITH params AS (SELECT 'you@example.com'::text AS admin_email)
INSERT INTO user_roles (id, user_id, role_id, granted_at)
SELECT gen_random_uuid()::text, u.id, r.id, now() AT TIME ZONE 'UTC'
FROM params
JOIN users u ON u.email = params.admin_email
JOIN roles r ON r.code = 'ADMIN'
WHERE NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
);

-- Check: one row, role ADMIN
WITH params AS (SELECT 'you@example.com'::text AS admin_email)
SELECT u.email, r.code AS role
FROM params
JOIN users u ON u.email = params.admin_email
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id;

-- ============================================================================
-- OPTION B: create the admin directly (no registration). Remove the leading
-- "-- " from every line of the block below, edit the `params` values (the same
-- in all three statements), then run it.
-- Make the bcrypt hash on your PC (in /Users/agtci/Documents/Project_Documents/Projects/community-platform/apps/api):
--     node -e "console.log(require('bcryptjs').hashSync('Your-Strong-Password', 12))"
-- It looks like  $2a$12$...  (60 characters).
-- ============================================================================
-- WITH params AS (SELECT 'you@example.com'::text AS admin_email,
--                        '9000000000'::text      AS admin_mobile,
--                        '$2a$12$REPLACE_WITH_THE_60_CHARACTER_BCRYPT_HASH'::text AS admin_hash)
-- INSERT INTO users (id, email, mobile, password_hash, email_verified, mobile_verified, status, created_at, updated_at)
-- SELECT gen_random_uuid()::text, admin_email, admin_mobile, admin_hash, true, true, 'ACTIVE',
--        now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
-- FROM params
-- WHERE NOT EXISTS (SELECT 1 FROM users e WHERE e.email = params.admin_email);
--
-- WITH params AS (SELECT 'you@example.com'::text AS admin_email)
-- INSERT INTO members (id, user_id, first_name, last_name, gender, status, created_at, updated_at)
-- SELECT gen_random_uuid()::text, u.id, 'Admin', 'Ladwani', 'MALE', 'ACTIVE',
--        now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
-- FROM params JOIN users u ON u.email = params.admin_email
-- WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id);
--
-- WITH params AS (SELECT 'you@example.com'::text AS admin_email)
-- INSERT INTO user_roles (id, user_id, role_id, granted_at)
-- SELECT gen_random_uuid()::text, u.id, r.id, now() AT TIME ZONE 'UTC'
-- FROM params
-- JOIN users u ON u.email = params.admin_email
-- JOIN roles r ON r.code = 'ADMIN'
-- WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id);
