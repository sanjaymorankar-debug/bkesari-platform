<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 12 — course and curriculum ratings from students and parents.
 *
 * The ten named columns are section 12's own list, kept as named columns
 * rather than a JSON blob so a dimension cannot quietly appear or disappear
 * between submissions, and so "how is practical learning rated across the
 * district" stays a query rather than a scan.
 *
 * Anonymous by construction, like every other feedback table here: this stores
 * `anonymous_ref` and never a `user_id` (spec section 26).
 *
 * Every dimension is nullable. A parent can judge whether their child talks
 * about a subject with interest; they usually cannot judge project work they
 * never saw. Forcing a number in that position would manufacture data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('course_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('course_id')->constrained()->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('academic_year', 9);

            $table->string('anonymous_ref', 40);
            $table->enum('rater_role', ['parent', 'student']);

            $table->unsignedTinyInteger('curriculum_relevance')->nullable();
            $table->unsignedTinyInteger('course_quality')->nullable();
            $table->unsignedTinyInteger('conceptual_learning')->nullable();
            $table->unsignedTinyInteger('practical_learning')->nullable();
            $table->unsignedTinyInteger('project_work')->nullable();
            $table->unsignedTinyInteger('learning_resources')->nullable();
            $table->unsignedTinyInteger('teaching_quality')->nullable();
            $table->unsignedTinyInteger('course_organisation')->nullable();
            $table->unsignedTinyInteger('engagement')->nullable();
            $table->unsignedTinyInteger('career_relevance')->nullable();

            $table->text('comment')->nullable();
            $table->timestamp('submitted_at')->useCurrent();
            $table->timestamps();

            // One rating per person, per course, per year.
            $table->unique(['course_id', 'academic_year', 'anonymous_ref'], 'course_rating_unique');
            $table->index(['school_id', 'academic_year'], 'course_ratings_school_year_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('course_ratings');
    }
};
