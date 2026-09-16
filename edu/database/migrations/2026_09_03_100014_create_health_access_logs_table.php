<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 21 — "every sensitive action logged (who viewed/uploaded/
 * modified/downloaded, when, what) in a tamper-resistant audit log".
 *
 * Separate from the general `audit_logs` table for the same reason the
 * safeguarding events are: a general audit reader must not learn from the log
 * alone that a named child has counselling records.
 *
 * Append-only. The application never updates or deletes rows here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('health_access_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('actor_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('actor_role', 60)->nullable();

            $table->enum('record_type', [
                'physical_health', 'wellbeing_concern', 'counselling_session', 'followup',
            ]);
            $table->unsignedBigInteger('record_id')->nullable();

            $table->enum('action', ['viewed', 'created', 'updated', 'downloaded', 'denied']);

            // Present on 'denied' rows: an attempted access that was refused is
            // as worth recording as one that succeeded.
            $table->string('detail', 255)->nullable();

            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->index(['student_user_id', 'occurred_at'], 'health_logs_student_time_idx');
            $table->index(['actor_user_id', 'occurred_at'], 'health_logs_actor_time_idx');
            $table->index('action');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('health_access_logs');
    }
};
