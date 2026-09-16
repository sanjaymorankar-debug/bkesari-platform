<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('school_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('about')->nullable();
            $table->json('facilities')->nullable();
            $table->json('sports')->nullable();
            $table->json('fees')->nullable();
            $table->text('policies')->nullable();
            $table->boolean('has_transport')->default(false);
            $table->boolean('has_hostel')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('school_profiles');
    }
};
