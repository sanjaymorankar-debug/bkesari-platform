<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('schools', function (Blueprint $table) {
            $table->id();
            $table->string('school_code')->unique();
            $table->string('name');
            $table->enum('board', ['CBSE', 'ICSE', 'STATE', 'IB', 'OTHER'])->default('STATE');
            $table->enum('management_type', ['government', 'aided', 'private', 'international'])->default('private');
            $table->foreignId('state_id')->constrained()->restrictOnDelete();
            $table->foreignId('district_id')->constrained()->restrictOnDelete();
            $table->string('address');
            $table->string('city');
            $table->string('pincode', 10);
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->string('website')->nullable();
            $table->enum('recognition_status', ['verified', 'pending', 'under_review'])->default('pending');
            $table->string('classes_from', 20)->nullable();
            $table->string('classes_to', 20)->nullable();
            $table->unsignedInteger('student_count')->default(0);
            $table->unsignedInteger('teacher_count')->default(0);
            $table->unsignedSmallInteger('established_year')->nullable();
            $table->timestamps();

            $table->index(['state_id', 'district_id']);
            $table->index('name');
            $table->index('pincode');
            $table->index('board');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('schools');
    }
};
