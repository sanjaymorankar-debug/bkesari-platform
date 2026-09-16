<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Anonymized like complaints (anonymous_ref, no user_id) — retaliation
     * reports are prioritized for authorised review, not auto-adjudicated
     * (spec section U: "Do not automatically determine guilt").
     */
    public function up(): void
    {
        Schema::create('retaliation_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('complaint_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('school_id')->constrained()->restrictOnDelete();
            $table->foreignId('district_id')->constrained()->restrictOnDelete();
            $table->foreignId('state_id')->constrained()->restrictOnDelete();
            $table->string('anonymous_ref', 40);
            $table->enum('submitted_role', ['parent', 'student']);
            $table->enum('category', [
                'intimidation', 'harassment', 'discrimination', 'punishment',
                'academic_retaliation', 'threats', 'withdrawal_of_facilities', 'other',
            ]);
            $table->text('description');
            $table->enum('status', [
                'submitted', 'under_review', 'investigating', 'action_taken', 'resolved', 'closed',
            ])->default('submitted');
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index('status');
            $table->index('anonymous_ref');
            $table->index(['district_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('retaliation_reports');
    }
};
