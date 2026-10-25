<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * The app was built against MySQL, whose default utf8mb4_unicode_ci
     * collation compares strings case-insensitively. Login, password reset,
     * the `unique:users,email` / `exists:users,email` validation rules and the
     * admin "find user by email" lookup all relied on that, e.g. a user
     * registered as alice@example.com could log in as Alice@Example.com, and
     * Alice@Example.com could not be registered a second time.
     *
     * PostgreSQL compares text case-sensitively, so users.email becomes
     * citext (a standard contrib extension, "trusted" since PostgreSQL 13, so
     * the database owner can enable it without superuser rights). Equality,
     * the unique index and LIKE on this column then behave exactly as they
     * did on MySQL. No-op on other drivers (SQLite is only used by tests).
     */
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('CREATE EXTENSION IF NOT EXISTS citext');
        DB::statement('ALTER TABLE users ALTER COLUMN email TYPE citext');
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        // Laravel's string() default; the extension is left installed since
        // other objects may depend on it.
        DB::statement('ALTER TABLE users ALTER COLUMN email TYPE varchar(255)');
    }
};
