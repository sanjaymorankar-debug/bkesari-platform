<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 9 — "never overwrite".
 *
 * Cross-year history lives in `fees` itself (one row per year). This table
 * covers the other case: a school editing a figure *within* a year. Both the
 * before and after are kept, so a fee that quietly moves after admissions
 * close leaves a trail a parent or officer can point at.
 *
 * Rows here are written by the application on every fee update and are never
 * edited or deleted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fee_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->foreignId('changed_by_user_id')->constrained('users')->cascadeOnDelete();

            $table->decimal('previous_amount', 12, 2);
            $table->decimal('new_amount', 12, 2);

            // Full before-state, so a later schema change doesn't strand the
            // meaning of an old revision.
            $table->json('previous_snapshot');

            $table->text('reason')->nullable();
            $table->timestamp('changed_at');
            $table->timestamps();

            $table->index(['school_id', 'changed_at'], 'fee_revisions_school_date_idx');
            $table->index('fee_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fee_revisions');
    }
};
