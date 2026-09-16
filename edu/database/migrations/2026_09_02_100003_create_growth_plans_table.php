<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 16 — the teacher/parent/student growth loop. One plan per
 * child per school per term; the plan is the shared artefact both the teacher
 * and the parent work from, which is what stops this being a one-way report.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('growth_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();

            $table->string('academic_term', 40);
            $table->enum('status', ['draft', 'active', 'completed', 'archived'])->default('draft');

            $table->text('summary_for_parent')->nullable();

            $table->timestamp('shared_with_parent_at')->nullable();
            $table->timestamp('parent_acknowledged_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();

            $table->timestamps();

            $table->unique(['student_user_id', 'school_id', 'academic_term'], 'growth_plan_student_term_unique');
            $table->index(['school_id', 'status'], 'growth_plan_school_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('growth_plans');
    }
};
