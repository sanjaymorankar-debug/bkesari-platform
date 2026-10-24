-- Education: create the FIRST system administrator (production; optional on test).
-- Run after 01 and 02. Edit the three values in the `params` list of the FIRST statement,
-- and the email in the other two; nothing else needs changing. (PostgreSQL has no
-- @session variables, so each statement carries its own values.)
--     psql "$EDU_DATABASE_URL" -v ON_ERROR_STOP=1 -f 04_edu_first_admin.sql
--
-- The password is stored as a bcrypt hash, never as text. Make the hash on your PC
-- (PHP is installed), then paste it below:
--     php -r "echo password_hash('Your-Strong-Password', PASSWORD_BCRYPT), PHP_EOL;"
-- It looks like  $2y$10$...  (60 characters).
--
-- Safe to re-run: an existing email is left unchanged and the role is only added once.
-- users.email is citext, so the email matches whatever its capitalisation.
-- Timestamps are written in UTC, as Laravel writes them.

WITH params AS (
    SELECT 'Your Name'::text       AS admin_name,
           'you@example.com'::text AS admin_email,
           '$2y$10$REPLACE_WITH_THE_60_CHARACTER_BCRYPT_HASH_FROM_THE_COMMAND_ABOVE'::text AS admin_hash
)
INSERT INTO users (name, email, email_verified_at, password, created_at, updated_at)
SELECT admin_name, admin_email, now() AT TIME ZONE 'UTC', admin_hash,
       now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
FROM params
ON CONFLICT (email) DO NOTHING;

WITH params AS (SELECT 'you@example.com'::text AS admin_email)
INSERT INTO model_has_roles (role_id, model_type, model_id)
SELECT r.id, 'App\Models\User', u.id
FROM params
JOIN users u ON u.email = params.admin_email
JOIN roles r ON r.name = 'system_admin' AND r.guard_name = 'web'
ON CONFLICT DO NOTHING;

-- Check: one row, role system_admin
WITH params AS (SELECT 'you@example.com'::text AS admin_email)
SELECT u.id, u.email, r.name AS role
FROM params
JOIN users u ON u.email = params.admin_email
JOIN model_has_roles m ON m.model_id = u.id AND m.model_type = 'App\Models\User'
JOIN roles r ON r.id = m.role_id;

-- Then on the server: php artisan permission:cache-reset
