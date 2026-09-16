<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec section 16 — 1 to 3 goals per term, each carrying what will be done at
 * school AND at home. `support_at_school` and `support_at_home` are NOT
 * nullable: the spec's rule is that every growth area comes with a next step,
 * so a goal with no plan attached is not a valid row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('growth_goals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('growth_plan_id')->constrained()->cascadeOnDelete();

            $table->enum('domain', [
                'cognitive_scholastic',
                'socio_emotional',
                'creative_co_scholastic',
                'physical_development',
                'life_skills',
            ]);

            $table->text('goal_statement');
            $table->text('support_at_school');
            $table->text('support_at_home');

            // Older students set their own goals directly; for younger
            // children this stays null and involvement is mediated by the
            // parent and teacher.
            $table->text('student_voice')->nullable();

            $table->enum('status', ['set', 'in_progress', 'achieved', 'continuing'])->default('set');
            $table->text('review_note')->nullable();
            $table->timestamp('reviewed_at')->nullable();

            $table->timestamps();

            $table->index('growth_plan_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('growth_goals');
    }
};
