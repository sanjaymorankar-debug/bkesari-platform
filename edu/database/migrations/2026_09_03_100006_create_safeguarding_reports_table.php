<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 25 — serious safeguarding cases and mandatory legal reporting.
 *
 * This is a separate table from `complaints` on purpose, and it is never
 * joined into general reporting (spec section 34). A safeguarding case is not
 * a complaint with a higher severity flag: it has a different audience, a
 * different lifecycle, and a legal duty attached that the platform cannot
 * discharge on anyone's behalf.
 *
 * The columns that matter most here are the external-reporting ones. Under
 * POCSO Act 2012 section 19, any person with knowledge of a child sexual abuse
 * case has an independent duty to report to the police or the Special Juvenile
 * Police Unit, and courts have held schools may not run an internal inquiry
 * first. So the platform records three separate things:
 *
 *   - `legal_duty_shown_at` — that the obligation was actually put in front of
 *     the reporter, and when. This is evidence about the platform's own
 *     conduct, not the reporter's.
 *   - `external_report_*` — whether someone has since confirmed a report was
 *     made externally, by whom, through which channel, with what reference.
 *   - `closure_*` — that closure was authorised by someone entitled to close
 *     it, with a reason.
 *
 * Filing here NEVER satisfies the legal duty, and nothing in this schema
 * should be read as evidence that it did — `external_report_acknowledged_at`
 * records an acknowledgement, not a verified police record.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('safeguarding_reports', function (Blueprint $table) {
            $table->id();

            // Human-quotable reference, so a reporter can follow a case
            // without an account lookup exposing anything.
            $table->string('reference', 20)->unique();

            $table->foreignId('school_id')->constrained()->restrictOnDelete();
            $table->foreignId('district_id')->constrained()->restrictOnDelete();
            $table->foreignId('state_id')->constrained()->restrictOnDelete();

            // Anonymised like complaints (spec section 26): no user_id.
            $table->string('anonymous_ref', 40);
            $table->enum('reporter_role', ['parent', 'student', 'teacher', 'staff', 'other']);

            $table->enum('category', [
                'child_sexual_abuse', 'physical_abuse', 'emotional_abuse', 'neglect',
                'serious_violence', 'immediate_danger', 'serious_harassment',
                'criminal_allegation', 'other_serious_concern',
            ]);

            $table->text('description');

            // Drives urgency in the officer queue, and whether the emergency
            // guidance is shown. Not a severity score — this never feeds any
            // rating.
            $table->boolean('immediate_danger')->default(false);

            $table->enum('status', [
                'submitted', 'acknowledged', 'external_report_confirmed',
                'under_investigation', 'closed',
            ])->default('submitted');

            // The POCSO Act section 19 duty, and what happened to it.
            $table->timestamp('legal_duty_shown_at')->nullable();
            $table->timestamp('external_report_acknowledged_at')->nullable();
            $table->foreignId('external_report_acknowledged_by')->nullable()
                ->constrained('users')->nullOnDelete();
            $table->enum('external_report_channel', ['police', 'sjpu', 'childline_1098', 'cwc', 'other'])->nullable();
            $table->string('external_report_reference', 100)->nullable();

            $table->foreignId('assigned_officer_user_id')->nullable()
                ->constrained('users')->nullOnDelete();
            $table->timestamp('acknowledged_at')->nullable();

            $table->timestamp('closed_at')->nullable();
            $table->foreignId('closed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('closure_reason')->nullable();

            $table->timestamps();

            $table->index('status');
            $table->index('anonymous_ref');
            $table->index(['school_id', 'status']);
            $table->index(['district_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('safeguarding_reports');
    }
};
