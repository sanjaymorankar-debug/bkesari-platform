<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DPDP Act 2023 Section 9 — verifiable parental consent, captured before any
 * of a child's capability, career, life-skills or health data is collected.
 * Rows are never updated in place on withdrawal: a withdrawal writes a new
 * status + timestamp on the existing grant, and the grant history stays
 * queryable, because "was consent in force on the date this observation was
 * recorded" has to be answerable after the fact.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consent_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('granted_by_user_id')->constrained('users')->cascadeOnDelete();

            // One purpose per record — purpose limitation is enforced by
            // requiring the consuming code to name the purpose it needs.
            $table->enum('purpose', [
                'capability_growth',
                'career_pathway',
                'life_skills',
                'physical_health',
                'mental_wellbeing',
                'alumni_outcomes',
            ]);

            $table->text('notice_text');
            $table->string('notice_version', 20);
            $table->enum('status', ['granted', 'withdrawn', 'expired'])->default('granted');

            // How the granting adult was confirmed to be the child's
            // parent/guardian — a verified parent_school_relationship, an
            // in-person school confirmation, etc.
            $table->string('verification_method', 60);

            $table->timestamp('granted_at');
            $table->timestamp('withdrawn_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->timestamps();

            $table->index(['student_user_id', 'purpose', 'status'], 'consent_student_purpose_status_idx');
            $table->index('granted_by_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('consent_records');
    }
};
