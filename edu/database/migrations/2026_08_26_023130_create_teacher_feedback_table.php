<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('teacher_feedback', function (Blueprint $table) {
            $table->id();
            $table->foreignId('teacher_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('anonymous_ref', 40);
            $table->enum('rater_role', ['parent', 'student']);
            $table->json('dimension_scores');
            $table->text('overall_comment')->nullable();
            $table->timestamp('submitted_at')->useCurrent();
            $table->timestamps();

            $table->index(['teacher_user_id', 'submitted_at']);
            $table->index('anonymous_ref');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('teacher_feedback');
    }
};
