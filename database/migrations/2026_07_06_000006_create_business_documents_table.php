<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('business_permit')->nullable();
            $table->string('mayor_permit')->nullable();
            $table->string('dti_certificate')->nullable();
            $table->string('sec_registration')->nullable();
            $table->string('bir_certificate')->nullable();
            $table->string('tourism_accreditation')->nullable();
            $table->date('expiration_date')->nullable();
            $table->string('verification_status')->default('pending');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_documents');
    }
};
