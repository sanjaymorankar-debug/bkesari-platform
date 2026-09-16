<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 18 — school health screening records.
 *
 * Longitudinal by construction: one row per examination, never overwritten, so
 * a child's height, weight and vision over five years is a history rather than
 * a current snapshot that erased its own past. `examination_date` plus
 * `academic_year` make the series queryable both ways.
 *
 * Gated behind DPDP Act section 9 verifiable parental consent — the
 * `physical_health` purpose in ConsentRecord::PURPOSES — enforced in
 * HealthAccessService, not here.
 *
 * Note what is absent: there is no free-text "diagnosis" column. Findings are
 * observations recorded by a health professional, and section 19's hard rule
 * that teachers must never diagnose is enforced by keeping teacher input in a
 * different table entirely.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('physical_health_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('academic_year', 9);

            $table->date('examination_date');
            $table->enum('examination_type', [
                'annual_screening', 'follow_up', 'incident', 'immunisation', 'other',
            ])->default('annual_screening');

            // Measurements, all nullable — a screening that only checked vision
            // should record only vision rather than zeros standing in for
            // things nobody measured.
            $table->decimal('height_cm', 5, 1)->nullable();
            $table->decimal('weight_kg', 5, 1)->nullable();
            $table->decimal('bmi', 4, 1)->nullable();

            $table->string('vision_left', 20)->nullable();
            $table->string('vision_right', 20)->nullable();
            $table->enum('hearing', ['normal', 'concern_noted', 'not_tested'])->nullable();
            $table->enum('dental', ['normal', 'concern_noted', 'not_tested'])->nullable();

            $table->text('general_examination')->nullable();
            $table->text('nutrition_observations')->nullable();
            $table->text('health_concerns')->nullable();
            $table->text('recommendations')->nullable();

            $table->date('next_due_date')->nullable();

            // Recorded by a nurse/medical officer, never by a teacher.
            $table->foreignId('recorded_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('recorded_by_designation', 100)->nullable();

            $table->timestamps();

            $table->index(['student_user_id', 'examination_date'], 'health_student_date_idx');
            $table->index(['school_id', 'academic_year'], 'health_school_year_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('physical_health_records');
    }
};
