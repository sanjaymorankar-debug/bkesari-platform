<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 21's follow-up lifecycle:
 * Identified → Referred → Follow-up → Completed → Closed.
 *
 * A screening that finds something and then loses track of it is worse than
 * no screening, because it creates a record that looks like care was taken.
 * This table is what makes "we found a vision problem in March" answerable in
 * November.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('health_followups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();

            // Which record raised it. Nullable so a follow-up can outlive a
            // deleted source record rather than vanishing with it.
            $table->foreignId('physical_health_record_id')->nullable()
                ->constrained()->nullOnDelete();

            $table->enum('area', ['vision', 'hearing', 'dental', 'nutrition', 'general', 'other'])
                ->default('general');
            $table->text('finding');
            $table->text('recommended_action')->nullable();

            $table->enum('status', ['identified', 'referred', 'follow_up', 'completed', 'closed'])
                ->default('identified');

            $table->date('identified_on');
            $table->date('due_on')->nullable();
            $table->date('completed_on')->nullable();
            $table->text('outcome')->nullable();

            $table->foreignId('opened_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['student_user_id', 'status'], 'followups_student_status_idx');
            $table->index(['school_id', 'status'], 'followups_school_status_idx');
            $table->index('due_on');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('health_followups');
    }
};
