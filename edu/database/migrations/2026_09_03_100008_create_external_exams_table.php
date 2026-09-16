<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 10 — external examinations a school runs or supports.
 *
 * Versioned by academic year like fees and facility claims, so what a school
 * offered when a family joined stays on record.
 *
 * `is_mandatory` matters more than it looks: an "optional" olympiad that every
 * child is entered into, at a fee, is a cost parents cannot see in the tuition
 * figure. Recording the fee here and its compulsion separately is what makes
 * that visible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('external_exams', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('academic_year', 9);

            $table->string('exam_name', 150);
            $table->string('conducting_body', 150)->nullable();

            $table->enum('exam_type', [
                'olympiad', 'scholarship', 'competitive', 'entrance',
                'international', 'language', 'skill_certification', 'other',
            ])->default('other');

            $table->string('applicable_classes', 100)->nullable();
            $table->text('eligibility')->nullable();
            $table->text('registration_process')->nullable();

            // Whether the school handles registration, which determines
            // whether a parent can opt out in practice.
            $table->boolean('through_school')->default(true);

            $table->decimal('exam_fee', 12, 2)->nullable();
            $table->boolean('preparation_offered')->default(false);
            $table->decimal('preparation_fee', 12, 2)->nullable();

            $table->boolean('is_mandatory')->default(false);
            $table->enum('frequency', ['annual', 'biannual', 'termly', 'one_off'])->default('annual');

            $table->foreignId('recorded_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['school_id', 'academic_year'], 'external_exams_school_year_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('external_exams');
    }
};
