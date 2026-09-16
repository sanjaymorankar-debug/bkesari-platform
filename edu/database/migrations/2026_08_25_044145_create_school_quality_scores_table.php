<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Historical snapshots (one row per calculation run), so trend
     * (improving/stable/declining) can be derived without recomputing —
     * spec sections X/Z/AK.
     */
    public function up(): void
    {
        Schema::create('school_quality_scores', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->decimal('score', 5, 2);
            $table->enum('confidence', ['high', 'medium', 'low', 'insufficient_data']);
            $table->unsignedInteger('response_count');
            $table->json('component_breakdown');
            $table->timestamp('calculated_at');
            $table->timestamps();

            $table->index(['school_id', 'calculated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('school_quality_scores');
    }
};
