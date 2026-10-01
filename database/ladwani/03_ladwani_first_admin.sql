-- Mi Ladwani: the FIRST administrator. Run after 01 and 02. Pick ONE option.
-- Safe to re-run: nothing is duplicated.

-- ============================================================================
-- OPTION A (simplest): promote an account you registered on the site.
--   1. Open https://ladwani.bkesari.com/register (or testladwani...) and register.
--   2. Edit the email below and run ONLY this block.
-- ============================================================================
-- Same collation as the tables, or '=' on text fails ("Illegal mix of collations").
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @admin_email = 'you@example.com';

INSERT INTO user_roles (id, userId, roleId, grantedAt)
SELECT UUID(), x.userId, x.roleId, NOW(3) FROM (
    SELECT u.id AS userId, r.id AS roleId
    FROM users u JOIN roles r ON r.code = 'ADMIN'
    WHERE u.email = @admin_email
) x
LEFT JOIN user_roles ur ON ur.userId = x.userId AND ur.roleId = x.roleId
WHERE ur.id IS NULL;

SELECT u.email, r.code AS role FROM users u
JOIN user_roles ur ON ur.userId = u.id JOIN roles r ON r.id = ur.roleId
WHERE u.email = @admin_email;

-- ============================================================================
-- OPTION B: create the admin directly (no registration). Remove the leading
-- "-- " from every line of the block below, edit the SET lines, then run it.
-- Make the bcrypt hash on your PC (in D:\My_Code\miladwani-source):
--     node -e "console.log(require('bcryptjs').hashSync('Your-Strong-Password', 12))"
-- It looks like  $2a$12$...  (60 characters).
-- ============================================================================
-- SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
-- SET @admin_email  = 'you@example.com';
-- SET @admin_mobile = '9000000000';
-- SET @admin_hash   = '$2a$12$REPLACE_WITH_THE_60_CHARACTER_BCRYPT_HASH';
--
-- INSERT INTO users (id, email, mobile, passwordHash, emailVerified, mobileVerified, status, createdAt, updatedAt)
-- SELECT UUID(), @admin_email, @admin_mobile, @admin_hash, 1, 1, 'ACTIVE', NOW(3), NOW(3)
-- FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM (SELECT email FROM users) e WHERE e.email = @admin_email);
--
-- INSERT INTO user_roles (id, userId, roleId, grantedAt)
-- SELECT UUID(), x.userId, x.roleId, NOW(3) FROM (
--     SELECT u.id AS userId, r.id AS roleId FROM users u JOIN roles r ON r.code = 'ADMIN'
--     WHERE u.email = @admin_email
-- ) x
-- LEFT JOIN user_roles ur ON ur.userId = x.userId AND ur.roleId = x.roleId
-- WHERE ur.id IS NULL;
--
-- INSERT INTO members (id, memberNumber, userId, firstName, lastName, gender, status, createdAt, updatedAt)
-- SELECT UUID(), 'MEM-ADMIN-001', u.id, 'Admin', 'Ladwani', 'MALE', 'ACTIVE', NOW(3), NOW(3)
-- FROM users u WHERE u.email = @admin_email
--   AND NOT EXISTS (SELECT 1 FROM (SELECT memberNumber FROM members) m WHERE m.memberNumber = 'MEM-ADMIN-001');
