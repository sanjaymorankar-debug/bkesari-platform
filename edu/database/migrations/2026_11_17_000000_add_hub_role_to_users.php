<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The Education role the bkesari hub granted this account (D-039,
     * App\Http\Middleware\HubIdentitySignIn): parent, student, teacher,
     * school_admin or system_admin, the one the bkesari admin approved. When
     * the hub's role changes, this role is taken away and the new one given;
     * roles given inside Education are never touched. Null: the hub granted
     * none (the account signs in only on its own, or already held the role
     * the hub names).
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('hub_role', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('hub_role');
        });
    }
};
