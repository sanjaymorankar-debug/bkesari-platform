-- Education: create the FIRST system administrator (production; optional on test).
-- Run after 01 and 02. Edit the three SET lines first; nothing else needs changing.
--
-- The password is stored as a bcrypt hash, never as text. Make the hash on your PC
-- (PHP is installed), then paste it below:
--     php -r "echo password_hash('Your-Strong-Password', PASSWORD_BCRYPT), PHP_EOL;"
-- It looks like  $2y$10$...  (60 characters).
--
-- Safe to re-run: an existing email is left unchanged and the role is only added once.

-- Same collation as the tables, or '=' on text fails ("Illegal mix of collations").
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @admin_name  = 'Your Name';
SET @admin_email = 'you@example.com';
SET @admin_hash  = '$2y$10$REPLACE_WITH_THE_60_CHARACTER_BCRYPT_HASH_FROM_THE_COMMAND_ABOVE';

INSERT IGNORE INTO users (name, email, email_verified_at, password, created_at, updated_at)
VALUES (@admin_name, @admin_email, NOW(), @admin_hash, NOW(), NOW());

INSERT INTO model_has_roles (role_id, model_type, model_id)
SELECT x.role_id, x.model_type, x.model_id FROM (
    SELECT r.id AS role_id, 'App\\Models\\User' AS model_type, u.id AS model_id
    FROM users u JOIN roles r ON r.name = 'system_admin' AND r.guard_name = 'web'
    WHERE u.email = @admin_email
) x
LEFT JOIN model_has_roles m ON m.role_id = x.role_id AND m.model_type = x.model_type AND m.model_id = x.model_id
WHERE m.role_id IS NULL;

-- Check: one row, role system_admin
SELECT u.id, u.email, r.name AS role
FROM users u JOIN model_has_roles m ON m.model_id = u.id AND m.model_type = 'App\\Models\\User'
JOIN roles r ON r.id = m.role_id
WHERE u.email = @admin_email;

-- Then on the server: php artisan permission:cache-reset
