<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Every time IdentityResolutionService reverses an anonymous_ref back to
     * a real user, it writes one row here — officer, time, record, reason,
     * action (spec section I).
     */
    public function up(): void
    {
        Schema::create('identity_access_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('officer_user_id')->constrained('users')->restrictOnDelete();
            $table->string('anonymous_ref', 40);
            $table->string('action', 80);
            $table->text('reason')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index('anonymous_ref');
            $table->index('officer_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('identity_access_logs');
    }
};
