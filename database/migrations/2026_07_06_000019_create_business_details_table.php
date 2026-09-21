<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_details', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('field_name');
            $table->text('field_value')->nullable();
            $table->timestamps();

            $table->index(['business_id', 'field_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_details');
    }
};
