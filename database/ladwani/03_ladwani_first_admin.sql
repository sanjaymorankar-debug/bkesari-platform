-- Mi Ladwani (NestJS + Next.js rebuild): the FIRST administrator. Run after 01 and 02.
-- Pick ONE option. Safe to re-run: nothing is duplicated.
-- SUPERSEDES the Sep 28 version, which used the old schema's camelCase column names
-- (userId, roleId, passwordHash, memberNumber) — this schema uses snake_case
-- (user_id, role_id, password_hash) and has no memberNumber column at all.

-- ============================================================================
-- OPTION A (simplest): promote an account you registered on the site.
--   1. Open https://ladwani.bkesari.com/register (or testladwani...) and register.
--      Registration already creates both the user and their member record.
--   2. Edit the email below and run ONLY this block.
-- ============================================================================
-- Same collation as the tables, or '=' on text fails ("Illegal mix of collations").
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @admin_email = 'you@example.com';

INSERT INTO user_roles (id, user_id, role_id, granted_at)
SELECT UUID(), x.user_id, x.role_id, NOW(3) FROM (
    SELECT u.id AS user_id, r.id AS role_id
    FROM users u JOIN roles r ON r.code = 'ADMIN'
    WHERE u.email = @admin_email
) x
LEFT JOIN user_roles ur ON ur.user_id = x.user_id AND ur.role_id = x.role_id
WHERE ur.id IS NULL;

SELECT u.email, r.code AS role FROM users u
JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
WHERE u.email = @admin_email;

-- ============================================================================
-- OPTION B: create the admin directly (no registration). Remove the leading
-- "-- " from every line of the block below, edit the SET lines, then run it.
-- Make the bcrypt hash on your PC (in /Users/agtci/Documents/Project_Documents/Projects/community-platform/apps/api):
--     node -e "console.log(require('bcryptjs').hashSync('Your-Strong-Password', 12))"
-- It looks like  $2a$12$...  (60 characters).
-- ============================================================================
-- SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
-- SET @admin_email  = 'you@example.com';
-- SET @admin_mobile = '9000000000';
-- SET @admin_hash   = '$2a$12$REPLACE_WITH_THE_60_CHARACTER_BCRYPT_HASH';
--
-- INSERT INTO users (id, email, mobile, password_hash, email_verified, mobile_verified, status, created_at, updated_at)
-- SELECT UUID(), @admin_email, @admin_mobile, @admin_hash, 1, 1, 'ACTIVE', NOW(3), NOW(3)
-- FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM (SELECT email FROM users) e WHERE e.email = @admin_email);
--
-- INSERT INTO members (id, user_id, first_name, last_name, gender, status, created_at, updated_at)
-- SELECT UUID(), u.id, 'Admin', 'Ladwani', 'MALE', 'ACTIVE', NOW(3), NOW(3)
-- FROM users u WHERE u.email = @admin_email
--   AND NOT EXISTS (SELECT 1 FROM (SELECT user_id FROM members) m WHERE m.user_id = u.id);
--
-- INSERT INTO user_roles (id, user_id, role_id, granted_at)
-- SELECT UUID(), x.user_id, x.role_id, NOW(3) FROM (
--     SELECT u.id AS user_id, r.id AS role_id FROM users u JOIN roles r ON r.code = 'ADMIN'
--     WHERE u.email = @admin_email
-- ) x
-- LEFT JOIN user_roles ur ON ur.user_id = x.user_id AND ur.role_id = x.role_id
-- WHERE ur.id IS NULL;
