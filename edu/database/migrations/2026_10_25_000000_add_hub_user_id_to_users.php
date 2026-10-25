<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Links an account to the bkesari ID (the hub's Neon Auth user id), which
     * arrives in the hub's signed X-Bkesari-Token. See App\Support\HubToken.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('hub_user_id', 80)->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['hub_user_id']);
            $table->dropColumn('hub_user_id');
        });
    }
};
