<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 19 — the counsellor's own records, under the additional
 * confidentiality tier section 19 requires "beyond standard health-record
 * access".
 *
 * `session_notes` is the field that tier exists for. A parent gets the support
 * plan and the fact that sessions happened; the notes themselves are visible
 * only to the authorised counsellor, because a child who knows their exact
 * words go home stops talking. `shareable_summary` is the counsellor's
 * deliberate, written-for-the-parent version — separate field, separate
 * decision, never an automatic extract of the notes.
 *
 * Nothing here is reachable without the `mental_wellbeing` consent purpose
 * under DPDP section 9.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('counselling_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('wellbeing_concern_id')->nullable()->constrained()->nullOnDelete();

            $table->date('session_date');
            $table->enum('session_type', [
                'initial', 'follow_up', 'group', 'parent_meeting', 'crisis', 'other',
            ])->default('follow_up');

            // Restricted to the counsellor. See the class doc on the model.
            $table->text('session_notes');

            // Written by the counsellor specifically for the guardian.
            $table->text('shareable_summary')->nullable();

            $table->text('support_plan')->nullable();
            $table->text('interventions')->nullable();
            $table->boolean('referred_externally')->default(false);
            $table->string('referral_detail', 255)->nullable();

            $table->date('next_session_date')->nullable();

            $table->foreignId('counsellor_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['student_user_id', 'session_date'], 'counselling_student_date_idx');
            $table->index(['counsellor_user_id', 'session_date'], 'counselling_counsellor_date_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('counselling_sessions');
    }
};
