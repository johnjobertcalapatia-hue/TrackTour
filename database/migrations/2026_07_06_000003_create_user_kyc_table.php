<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_kyc', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('government_id_type')->nullable();
            $table->string('government_id_number')->nullable();
            $table->string('valid_id_front')->nullable();
            $table->string('valid_id_back')->nullable();
            $table->string('selfie_holding_id')->nullable();
            $table->string('tin')->nullable();
            $table->string('verification_status')->default('pending');
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_kyc');
    }
};
