<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 17 — life skills tracked as participation in structured
 * activities, explicitly "not as another test score". Hence
 * `participation_level` as an enum of engagement, with no marks, grade or
 * percentage column anywhere on the table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('life_skills_tracking', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('recorded_by_user_id')->constrained('users')->cascadeOnDelete();

            $table->enum('skill_area', [
                'financial_literacy',
                'digital_literacy_safety',
                'civic_citizenship',
                'communication',
                'leadership',
                'critical_thinking',
                'emotional_intelligence',
                'environmental_awareness',
            ]);

            $table->string('activity_title', 200);
            $table->text('activity_description')->nullable();

            $table->enum('participation_level', ['participated', 'engaged', 'led']);

            $table->string('academic_term', 40);
            $table->date('recorded_on');

            $table->timestamps();

            $table->index(['student_user_id', 'skill_area'], 'life_skills_student_area_idx');
            $table->index(['school_id', 'academic_term'], 'life_skills_school_term_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('life_skills_tracking');
    }
};
