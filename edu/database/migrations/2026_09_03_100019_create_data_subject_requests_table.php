<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec sections 21, 34 and 40 — DPDP data-subject access, correction and
 * erasure requests, handled by the Data Protection Officer.
 *
 * The row is kept after the request is dealt with, including when it is
 * refused. A platform that cannot show what was asked of it and what it did
 * cannot demonstrate it honoured the right at all, and a refused erasure needs
 * its reason on record more than a granted one does.
 *
 * `categories` records what the request covers, and `outcome_by_category`
 * records what actually happened to each — because a single request will
 * routinely be granted in part and refused in part, and collapsing that into
 * one status would hide which.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('data_subject_requests', function (Blueprint $table) {
            $table->id();

            $table->string('reference', 20)->unique();

            // Who asked, and whose data it concerns. These differ whenever a
            // guardian requests on behalf of their child, which is the normal
            // case on a platform whose subjects are minors.
            $table->foreignId('requester_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('subject_user_id')->constrained('users')->cascadeOnDelete();

            $table->enum('request_type', ['access', 'correction', 'erasure']);

            $table->json('categories');
            $table->text('detail')->nullable();

            $table->enum('status', [
                'submitted', 'under_review', 'completed', 'partially_completed', 'refused',
            ])->default('submitted');

            $table->json('outcome_by_category')->nullable();
            $table->text('response_note')->nullable();

            $table->foreignId('handled_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('handled_at')->nullable();

            // DPDP expects requests to be dealt with in reasonable time; this
            // makes "how long has this been sitting" answerable.
            $table->timestamp('due_by')->nullable();

            $table->timestamps();

            $table->index('status');
            $table->index(['subject_user_id', 'created_at'], 'dsr_subject_created_idx');
            $table->index('due_by');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_subject_requests');
    }
};
