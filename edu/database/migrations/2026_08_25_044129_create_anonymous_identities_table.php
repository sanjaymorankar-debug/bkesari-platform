<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Core of the identity-separation design: a stable pseudonym per
     * user-per-school-context. Complaint/feedback tables store only
     * anonymous_ref, never user_id, so the join back to a real identity
     * exists in exactly one place and is auditable (see identity_access_logs).
     */
    public function up(): void
    {
        Schema::create('anonymous_identities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->enum('context', ['parent', 'student']);
            $table->string('anonymous_ref', 40)->unique();
            $table->timestamps();

            $table->unique(['user_id', 'school_id', 'context'], 'anon_identity_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('anonymous_identities');
    }
};
