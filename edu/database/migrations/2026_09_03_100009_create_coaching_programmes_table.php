<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 10 — coaching and exam-preparation programmes.
 *
 * The two columns doing the real work here are `is_mandatory` and
 * `bundled_into_school_fees`. Coaching that is compulsory in practice but
 * billed separately is one of the clearest ways a published fee figure
 * understates what a family actually pays, and section 9's estimated annual
 * cost cannot see it unless it is recorded somewhere. Recording both lets the
 * profile show the gap without anyone having to allege one.
 *
 * `during_school_hours` is here for the same reason: coaching held inside the
 * timetable is not optional in any meaningful sense, whatever it is labelled.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('coaching_programmes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('academic_year', 9);

            $table->string('programme_name', 150);

            $table->enum('programme_type', [
                'jee', 'neet', 'cuet', 'clat', 'nda', 'olympiad',
                'scholarship', 'coding', 'robotics', 'languages', 'other',
            ])->default('other');

            $table->enum('provider_type', ['school', 'external_partner'])->default('school');
            $table->string('provider_name', 150)->nullable();

            $table->string('applicable_classes', 100)->nullable();
            $table->string('faculty', 200)->nullable();
            $table->string('duration', 100)->nullable();
            $table->string('timing', 100)->nullable();
            $table->boolean('during_school_hours')->default(false);

            $table->decimal('fee', 12, 2)->nullable();
            $table->boolean('bundled_into_school_fees')->default(false);
            $table->boolean('is_mandatory')->default(false);
            $table->boolean('certification_offered')->default(false);

            $table->foreignId('recorded_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['school_id', 'academic_year'], 'coaching_school_year_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coaching_programmes');
    }
};
