<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An Indian mobile number for signing in by one-time code (App\Services\
     * MobileSignIn). Stored normalised as +91 and ten digits
     * (App\Support\IndianMobile), so one number can belong to one account.
     * Optional: email and password remain the way every account signs in.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('mobile', 16)->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['mobile']);
            $table->dropColumn('mobile');
        });
    }
};
