<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec sections 8 and 12 — the courses and programmes a school runs, which
 * students and parents can then rate on the curriculum-specific dimensions
 * section 12 lists.
 *
 * Kept separate from `facility_claims` because a course is not a facility: a
 * school can have an excellent laboratory and a poorly-taught chemistry
 * course, and merging the two would hide exactly that difference. Versioned by
 * academic year like everything else a school publishes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('courses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('academic_year', 9);

            $table->string('name', 150);
            $table->enum('course_type', [
                'core_subject', 'elective', 'stream', 'vocational', 'language', 'programme', 'other',
            ])->default('core_subject');

            $table->string('applicable_classes', 100)->nullable();
            $table->string('stream', 60)->nullable();
            $table->text('description')->nullable();

            $table->foreignId('recorded_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['school_id', 'academic_year', 'name'], 'course_unique_per_year');
            $table->index(['school_id', 'academic_year'], 'courses_school_year_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('courses');
    }
};
