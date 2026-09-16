<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 17 — career interest exploration.
 *
 * Each capture is a new row, never an update of the last one: "interests at 12
 * are not fixed at 12", so the table is a time series of what a child was
 * curious about, and the UI always shows the date. There is no
 * "assigned_track" or "recommended_career" column, and there must never be
 * one — suggestions are computed at read time and presented as options to
 * explore (see App\Services\CareerPathwayService).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('career_interest_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('captured_by_user_id')->constrained('users')->cascadeOnDelete();

            $table->string('academic_term', 40);

            // Broad interest areas the child selected, e.g. ["building_making",
            // "helping_people"]. Deliberately child-facing categories rather
            // than job titles.
            $table->json('interest_areas');

            // Subjects/activities the child says they enjoy — their words,
            // not an inferred aptitude.
            $table->json('enjoyed_activities')->nullable();

            $table->text('reflection')->nullable();
            $table->date('captured_on');

            $table->timestamps();

            $table->index(['student_user_id', 'captured_on'], 'career_profile_student_date_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('career_interest_profiles');
    }
};
