<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Formal appeal beyond the resolution confirmation's escalate-on-"no"
     * path — reviewed one level up from wherever the complaint was already
     * handled (state officer, not the same district that resolved it).
     * Anonymized like complaints: anonymous_ref, no user_id.
     */
    public function up(): void
    {
        Schema::create('appeals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('complaint_id')->constrained()->cascadeOnDelete();
            $table->foreignId('district_id')->constrained()->restrictOnDelete();
            $table->foreignId('state_id')->constrained()->restrictOnDelete();
            $table->string('anonymous_ref', 40);
            $table->text('reason');
            $table->enum('status', ['submitted', 'under_review', 'upheld', 'denied'])->default('submitted');
            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('decision_note')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->unique('complaint_id');
            $table->index('status');
            $table->index(['state_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appeals');
    }
};
