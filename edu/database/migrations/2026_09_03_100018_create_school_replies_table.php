<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 29 — the school's right of reply.
 *
 * "Every module carrying an allegation or a claimed-vs-experienced gap must
 * present both sides." Complaints already had a response workflow; the gaps
 * surfaced by section 11 and the rating patterns in section 12 did not. A
 * school could correct its listing but could not answer in words, which meant
 * a reported discrepancy stood on the public profile unanswered.
 *
 * Replies are **append-only**. A school posts a reply; if the situation
 * changes it posts another, and both stay visible with their dates. Editing in
 * place would let a reply be quietly rewritten after the fact, which is the
 * same failure the fee-revision trail exists to prevent — and it cuts both
 * ways here, since the record protects the school as much as the reader.
 *
 * A reply never removes, hides or scores down the thing it answers. It sits
 * beside it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('school_replies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();

            // What is being answered.
            $table->enum('context_type', [
                'facility_discrepancy', 'course_feedback', 'general_feedback',
            ]);

            // The facility key or course id the reply is about; null for a
            // reply to the school's overall feedback.
            $table->string('context_key', 60)->nullable();

            $table->string('academic_year', 9);
            $table->text('body');

            $table->foreignId('author_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['school_id', 'academic_year'], 'school_replies_school_year_idx');
            $table->index(['school_id', 'context_type', 'context_key'], 'school_replies_context_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('school_replies');
    }
};
