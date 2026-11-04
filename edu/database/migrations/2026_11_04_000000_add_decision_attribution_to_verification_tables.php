<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section I — two verification decisions were being taken with no record
 * of who took them.
 *
 * A District Officer moving a school to `recognition_status = 'verified'` is a
 * government act: it is what makes the school real on the platform. It was a
 * bare status update, so afterwards nothing on the record said which officer
 * did it or when. The same held for a School Admin approving or rejecting a
 * parent/student/teacher link: `verified_at` was stamped on approval, but the
 * actor was never stored and a rejection left no trace at all.
 *
 * `decided_*` rather than `verified_*` on the relationship tables on purpose:
 * the columns are set on a rejection too, and calling that "verified" would
 * misread every rejected row. `verified_at` keeps its existing meaning —
 * stamped on approval only — so existing reads are unaffected.
 */
return new class extends Migration
{
    private const RELATIONSHIP_TABLES = [
        'parent_school_relationships',
        'student_school_relationships',
        'teacher_school_relationships',
    ];

    public function up(): void
    {
        Schema::table('schools', function (Blueprint $table) {
            $table->timestamp('recognition_verified_at')->nullable()->after('recognition_status');
            $table->foreignId('recognition_verified_by_user_id')->nullable()->after('recognition_verified_at')
                ->constrained('users')->nullOnDelete();
        });

        foreach (self::RELATIONSHIP_TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->timestamp('decided_at')->nullable()->after('verified_at');
                $table->foreignId('decided_by_user_id')->nullable()->after('decided_at')
                    ->constrained('users')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::table('schools', function (Blueprint $table) {
            $table->dropForeign(['recognition_verified_by_user_id']);
            $table->dropColumn(['recognition_verified_at', 'recognition_verified_by_user_id']);
        });

        foreach (self::RELATIONSHIP_TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropForeign(['decided_by_user_id']);
                $table->dropColumn(['decided_at', 'decided_by_user_id']);
            });
        }
    }
};
