<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Scopes a District/State Officer account to the district(s)/state(s)
     * they are authorized to see complaints and analytics for.
     */
    public function up(): void
    {
        Schema::create('officer_jurisdictions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->enum('level', ['district', 'state', 'national']);
            $table->foreignId('district_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('state_id')->nullable()->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'level', 'district_id', 'state_id'], 'officer_jurisdiction_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('officer_jurisdictions');
    }
};
