<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 8 — what a school says it offers.
 *
 * Versioned by academic year, the same way fees are: a claim made for 2026-27
 * is a separate row from the same claim in 2025-26, so "the website said there
 * was a robotics lab when we joined" stays checkable afterwards.
 *
 * `verification_status` is about evidence, not truth: `verified` means someone
 * checked the submitted document, `unverified` means nobody has. A claim being
 * unverified is never presented as a claim being false.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('facility_claims', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();

            // Key from App\Support\FacilityTaxonomy — the one canonical list
            // shared by claims, ratings and history (spec section 12).
            $table->string('facility_key', 60);
            $table->string('academic_year', 9);

            $table->boolean('is_offered')->default(true);
            $table->text('description')->nullable();
            $table->string('applicable_classes', 100)->nullable();
            $table->enum('availability', ['all_students', 'selected_classes', 'optional_enrolment', 'limited'])
                ->default('all_students');
            $table->unsignedInteger('capacity')->nullable();

            $table->decimal('fee_amount', 12, 2)->nullable();
            $table->boolean('is_mandatory')->default(false);
            $table->string('provider', 150)->nullable();

            $table->string('evidence_path')->nullable();
            $table->text('evidence_note')->nullable();

            $table->enum('verification_status', ['unverified', 'pending', 'verified'])->default('unverified');
            $table->foreignId('verified_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable();

            $table->foreignId('recorded_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['school_id', 'facility_key', 'academic_year'], 'facility_claim_unique');
            $table->index(['school_id', 'academic_year'], 'facility_claims_school_year_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('facility_claims');
    }
};
