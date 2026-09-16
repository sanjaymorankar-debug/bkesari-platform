<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Anti-manipulation detection results (spec section AE) — always a
     * flag for human review, never an automatic penalty.
     */
    public function up(): void
    {
        Schema::create('fraud_flags', function (Blueprint $table) {
            $table->id();
            $table->enum('flag_type', ['feedback_spike', 'coordinated_review', 'duplicate_pattern', 'other']);
            $table->enum('subject_type', ['school', 'teacher']);
            $table->unsignedBigInteger('subject_id');
            $table->json('details')->nullable();
            $table->enum('status', ['open', 'reviewing', 'dismissed', 'confirmed'])->default('open');
            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->index(['subject_type', 'subject_id']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fraud_flags');
    }
};
