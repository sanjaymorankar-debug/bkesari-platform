<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 19's hard rule: **teachers must never diagnose**, and their
 * input is captured strictly as "Teacher Observation / Concern" — enforced at
 * the data-model level.
 *
 * This table is that enforcement. It is deliberately a separate table from
 * `counselling_sessions`, not a shared table with a role column, because a
 * shared table would need only one careless write to put a teacher's opinion
 * where a clinical note belongs.
 *
 * What is absent is the point:
 *   - no diagnosis column
 *   - no severity score, no risk rating, no clinical category
 *   - no treatment or intervention column
 *
 * A teacher records what they observed and that they are concerned. Deciding
 * what it means is a counsellor's job, in their own table, under a stricter
 * tier. There is a schema test asserting none of those columns ever appear.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wellbeing_concerns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();

            // What was observed, and where. Description of behaviour and
            // context only.
            $table->text('observation');
            $table->string('context', 200)->nullable();
            $table->date('observed_on');

            $table->foreignId('raised_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('raised_by_role', 60);

            // Whether a counsellor has picked it up. This is a routing state,
            // not an assessment of the child.
            $table->enum('referral_status', ['raised', 'seen_by_counsellor', 'closed_without_referral'])
                ->default('raised');
            $table->timestamp('seen_at')->nullable();
            $table->foreignId('seen_by_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->index(['student_user_id', 'observed_on'], 'wellbeing_student_date_idx');
            $table->index(['school_id', 'referral_status'], 'wellbeing_school_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wellbeing_concerns');
    }
};
