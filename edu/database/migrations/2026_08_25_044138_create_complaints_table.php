<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * No user_id column by design — the submitter is identified only by
     * anonymous_ref (see anonymous_identities). The school and any officer
     * reviewing this complaint can never join straight to a real identity.
     */
    public function up(): void
    {
        Schema::create('complaints', function (Blueprint $table) {
            $table->id();
            $table->string('complaint_number', 40)->unique();
            $table->foreignId('school_id')->constrained()->restrictOnDelete();
            $table->foreignId('complaint_category_id')->constrained()->restrictOnDelete();
            $table->foreignId('district_id')->constrained()->restrictOnDelete();
            $table->foreignId('state_id')->constrained()->restrictOnDelete();
            $table->string('anonymous_ref', 40);
            $table->enum('submitted_role', ['parent', 'student']);
            $table->string('subject');
            $table->text('description');
            $table->enum('severity', ['low', 'medium', 'high', 'critical'])->default('medium');
            $table->enum('status', [
                'submitted', 'under_review', 'school_responded', 'escalated',
                'investigating', 'action_taken', 'resolved', 'closed',
            ])->default('submitted');
            $table->boolean('is_child_safety_flag')->default(false);
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index('status');
            $table->index('anonymous_ref');
            $table->index(['school_id', 'status']);
            $table->index(['district_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('complaints');
    }
};
