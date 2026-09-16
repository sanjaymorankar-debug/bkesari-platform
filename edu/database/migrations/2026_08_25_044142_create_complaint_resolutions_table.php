<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('complaint_resolutions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('complaint_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('resolution_summary')->nullable();
            $table->enum('confirmed_by_submitter', ['pending', 'yes', 'partially', 'no'])->default('pending');
            $table->timestamp('confirmed_at')->nullable();
            $table->boolean('escalated')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('complaint_resolutions');
    }
};
