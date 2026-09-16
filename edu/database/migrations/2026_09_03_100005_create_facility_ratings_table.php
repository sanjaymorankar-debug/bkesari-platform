<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec sections 11 and 12 — what parents and students actually experience.
 *
 * Anonymous by construction: this table stores `anonymous_ref`, never a
 * `user_id`, matching the identity separation in section 26 that the complaint
 * and school-feedback tables already follow. A school seeing "the robotics lab
 * is never open" must not be able to work out which family said it.
 *
 * `availability_report` is the half that feeds claimed-vs-experienced; the
 * structured 1-5 scores are the quality half. Section 12 asks for structured
 * questions rather than a bare star rating, hence the named columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('facility_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('facility_key', 60);
            $table->string('academic_year', 9);

            $table->string('anonymous_ref', 40);
            $table->enum('rater_role', ['parent', 'student']);

            $table->enum('availability_report', ['available', 'partially_available', 'not_available']);

            // Null where the rater couldn't judge — an honest "don't know"
            // beats a made-up score.
            $table->unsignedTinyInteger('quality')->nullable();
            $table->unsignedTinyInteger('equipment')->nullable();
            $table->unsignedTinyInteger('usage_frequency')->nullable();
            $table->unsignedTinyInteger('staff_support')->nullable();
            $table->unsignedTinyInteger('overall_usefulness')->nullable();

            $table->text('comment')->nullable();
            $table->timestamp('submitted_at')->useCurrent();
            $table->timestamps();

            // One rating per person, per facility, per year — so a single
            // unhappy family cannot outvote everyone by submitting repeatedly.
            $table->unique(['school_id', 'facility_key', 'academic_year', 'anonymous_ref'], 'facility_rating_unique');
            $table->index(['school_id', 'facility_key', 'academic_year'], 'facility_ratings_lookup_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('facility_ratings');
    }
};
