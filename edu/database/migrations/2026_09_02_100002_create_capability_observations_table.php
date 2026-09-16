<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 15 — NEP 2020 / PARAKH Holistic Progress Card model.
 *
 * There is deliberately NO score, rating, level, band or percentile column on
 * this table, and there must never be one. The spec's rule is that a child is
 * never reduced to a number or a fixed label; the schema enforces that rather
 * than leaving it to UI discipline. Every row is a dated, domain-specific,
 * single-observer note, so the only view that can be built from it is a
 * point-in-time, multi-source one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('capability_observations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('observer_user_id')->constrained('users')->cascadeOnDelete();

            // 360-degree, per the HPC model: teacher, parent, the child
            // themself, and (moderated) peers.
            $table->enum('observer_role', ['teacher', 'parent', 'self', 'peer']);

            $table->enum('domain', [
                'cognitive_scholastic',
                'socio_emotional',
                'creative_co_scholastic',
                'physical_development',
                'life_skills',
            ]);

            // A named facet within the domain, e.g. "problem solving",
            // "collaboration". Kept as free text so the framework can grow
            // with PARAKH's published strands without a migration.
            $table->string('strand', 120);

            // Strength or growth area — the only two framings allowed. Note
            // this is about a moment, not the child: "showed X in Y", never
            // "is weak at X".
            $table->enum('observation_type', ['strength', 'growth_area']);

            $table->text('observation');
            $table->text('evidence_context')->nullable();

            $table->string('academic_term', 40);
            $table->date('observed_on');

            // Peer observations are held until a teacher approves them, so the
            // module can never become a popularity contest or a bullying vector.
            $table->enum('moderation_status', ['approved', 'pending', 'rejected'])->default('approved');
            $table->foreignId('moderated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('moderated_at')->nullable();

            $table->timestamps();

            $table->index(['student_user_id', 'domain', 'observed_on'], 'cap_obs_student_domain_date_idx');
            $table->index(['school_id', 'academic_term'], 'cap_obs_school_term_idx');
            $table->index('observer_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('capability_observations');
    }
};
