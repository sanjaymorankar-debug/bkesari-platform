<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 9 — the fee register behind "what does this school actually
 * cost", which is the question the published tuition figure usually doesn't
 * answer.
 *
 * Rows are scoped by `academic_year`, so history is inherent in the table
 * rather than bolted on: last year's fees are simply last year's rows, never
 * overwritten by this year's. Edits within a year are captured separately in
 * `fee_revisions`.
 *
 * `state_cap_status` exists because fee regulation is a state subject — the
 * platform records whether an amount sits within that state's approved cap,
 * or hasn't been reviewed, without pretending there is one national rule.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();

            $table->string('academic_year', 9); // e.g. "2026-27"

            // Null means the charge applies to every class at the school.
            $table->string('class_grade', 20)->nullable();
            $table->string('stream', 60)->nullable();

            $table->enum('category', [
                'admission', 'registration', 'tuition', 'annual', 'development',
                'term', 'examination', 'assessment', 'laboratory', 'computer',
                'library', 'sports', 'activity', 'transport', 'hostel', 'meals',
                'books', 'uniform', 'id_card', 'diary', 'field_trips',
                'competitions', 'external_exam', 'certification', 'coaching', 'other',
            ]);

            $table->string('label', 150);
            $table->decimal('amount', 12, 2);

            $table->enum('frequency', ['one_time', 'monthly', 'quarterly', 'term', 'annual']);

            $table->boolean('is_mandatory')->default(true);
            $table->boolean('is_refundable')->default(false);
            $table->text('conditions')->nullable();

            $table->date('effective_from');

            $table->enum('state_cap_status', [
                'not_applicable', 'within_cap', 'pending_review', 'exceeds_cap',
            ])->default('not_applicable');

            $table->foreignId('recorded_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['school_id', 'academic_year'], 'fees_school_year_idx');
            $table->index(['school_id', 'academic_year', 'class_grade'], 'fees_school_year_class_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fees');
    }
};
