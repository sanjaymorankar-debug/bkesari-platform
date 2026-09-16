<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Pre-computed rollups for State/National/Researcher dashboards —
     * replaces live-query aggregation with a scheduled snapshot (spec
     * section AK: "do not calculate expensive national statistics on
     * every page load"). One row per (scope, scope_id, calculated_at).
     */
    public function up(): void
    {
        Schema::create('analytics_snapshots', function (Blueprint $table) {
            $table->id();
            $table->enum('scope', ['state', 'national']);
            $table->unsignedBigInteger('scope_id')->nullable(); // state_id when scope=state, null for national
            $table->json('metrics');
            $table->timestamp('calculated_at');
            $table->timestamps();

            $table->index(['scope', 'scope_id', 'calculated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('analytics_snapshots');
    }
};
