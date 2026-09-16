<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Privacy-restricted: only the teacher themself (and admins) may ever
     * see this — never public, never the school (spec section AI).
     */
    public function up(): void
    {
        Schema::create('teacher_effectiveness_scores', function (Blueprint $table) {
            $table->id();
            $table->foreignId('teacher_user_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('score', 5, 2);
            $table->enum('confidence', ['high', 'medium', 'low', 'insufficient_data']);
            $table->unsignedInteger('response_count');
            $table->json('component_breakdown');
            $table->timestamp('calculated_at');
            $table->timestamps();

            $table->index(['teacher_user_id', 'calculated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('teacher_effectiveness_scores');
    }
};
