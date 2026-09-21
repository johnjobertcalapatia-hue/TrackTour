<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('offering_variation_options', function (Blueprint $table) {
            $table->id();
            $table->foreignId('variation_group_id')->constrained('offering_variation_groups')->cascadeOnDelete();
            $table->string('name');
            $table->decimal('price_adjustment', 12, 2)->default(0);
            $table->integer('sort_order')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('offering_variation_options');
    }
};
