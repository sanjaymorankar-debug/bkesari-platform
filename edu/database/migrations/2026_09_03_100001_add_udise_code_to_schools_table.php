<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 5 — UDISE+ is the government's unified school identifier, and
 * this platform is a *consumer* of it, never a competing ID system. Hence a
 * nullable column alongside the existing internal `school_code` primary
 * identifier rather than a replacement for it.
 *
 * `udise_verified_at` is set only when a code has actually been confirmed
 * against government data by an officer. It is deliberately separate from the
 * code itself: a school typing a number into a form is a claim, not a
 * verification, and section 8 forbids showing a "UDISE Verified" badge on
 * anything less. Nothing in the seeders sets this.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('schools', function (Blueprint $table) {
            $table->string('udise_code', 20)->nullable()->after('school_code');
            $table->timestamp('udise_verified_at')->nullable()->after('udise_code');
            $table->foreignId('udise_verified_by_user_id')->nullable()->after('udise_verified_at')
                ->constrained('users')->nullOnDelete();

            $table->unique('udise_code');
        });
    }

    public function down(): void
    {
        Schema::table('schools', function (Blueprint $table) {
            $table->dropForeign(['udise_verified_by_user_id']);
            $table->dropUnique(['udise_code']);
            $table->dropColumn(['udise_code', 'udise_verified_at', 'udise_verified_by_user_id']);
        });
    }
};
