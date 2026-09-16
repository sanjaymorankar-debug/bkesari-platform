<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 3 — international benchmarking, built as a *structural* and
 * aggregate comparison layer rather than a score table India has not produced.
 *
 * The most important thing about this table is what it cannot hold: **there is
 * no score, rank, value or numeric column of any kind.** That is the schema
 * enforcing rule 44's "never fabricate an international benchmark score India
 * has not produced". A reference here describes what a high-performing system
 * *does* — Finland's low tracking, Estonia's digital-first curriculum — never
 * what it scored, so there is nowhere to put a made-up Indian PISA rank even
 * if someone wanted to. A schema test asserts this stays true.
 *
 * Every row is sourced and dated, because an undated claim about another
 * country's education system is not a benchmark, it is a rumour.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('benchmark_references', function (Blueprint $table) {
            $table->id();

            // The dimension being compared, matching the SQI dimensions where
            // possible so the platform's own data lines up beside it.
            $table->string('dimension', 60);

            // Whose practice this is: a country, or a framework body.
            $table->string('system_name', 100);
            $table->enum('system_type', ['country', 'framework'])->default('country');

            // What that system actually does. Prose, deliberately.
            $table->text('practice');

            // Why it is relevant to compare against — kept separate from the
            // practice itself so the platform's interpretation is never
            // mistaken for the source's own words.
            $table->text('relevance')->nullable();

            $table->string('source_name', 200);
            $table->string('source_url', 500)->nullable();
            $table->unsignedSmallInteger('source_year');

            // Set when a source has not yet been re-checked by a human. The
            // public page says so rather than implying every citation has been
            // verified.
            $table->boolean('source_verified')->default(false);

            $table->timestamps();

            $table->index('dimension');
            $table->index('system_name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('benchmark_references');
    }
};
