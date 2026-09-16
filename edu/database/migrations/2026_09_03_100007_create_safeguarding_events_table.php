<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec sections 21 and 25 — the append-only trail for safeguarding cases.
 *
 * Separate from the general `audit_logs` table because these rows are as
 * restricted as the case itself: a general audit reader must not learn that a
 * safeguarding case exists at a named school, which a shared log would leak
 * through its subject columns alone.
 *
 * Nothing updates or deletes rows here. The application only ever appends.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('safeguarding_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('safeguarding_report_id')->constrained()->cascadeOnDelete();

            $table->enum('event_type', [
                'submitted', 'legal_duty_shown', 'acknowledged', 'assigned',
                'external_report_recorded', 'investigation_started',
                'note_added', 'closed', 'reopened', 'viewed',
            ]);

            // Nullable because 'submitted' is recorded against an anonymous
            // reporter, who is deliberately not identifiable here.
            $table->foreignId('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('actor_role', 60)->nullable();

            $table->text('detail')->nullable();
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->index(['safeguarding_report_id', 'occurred_at'], 'safeguarding_events_case_time_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('safeguarding_events');
    }
};
