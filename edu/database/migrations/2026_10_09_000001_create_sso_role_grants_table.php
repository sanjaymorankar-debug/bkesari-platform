<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which roles the central-login bridge granted, so it only ever removes its
 * own: a role given inside Education is never touched by it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sso_role_grants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role_name', 125);
            $table->timestamps();
            $table->unique(['user_id', 'role_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sso_role_grants');
    }
};
