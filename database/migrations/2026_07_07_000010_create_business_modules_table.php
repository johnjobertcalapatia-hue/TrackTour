<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_modules', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('icon')->nullable();
            $table->string('route_prefix')->nullable();
            $table->integer('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('business_type_module', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_category_id')->constrained()->cascadeOnDelete();
            $table->foreignId('business_module_id')->constrained('business_modules')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['business_category_id', 'business_module_id'], 'btype_bmod_unique');
        });

        Schema::create('business_module_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('business_module_id')->constrained('business_modules')->cascadeOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['business_id', 'business_module_id'], 'bus_mod_assign_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_module_assignments');
        Schema::dropIfExists('business_type_module');
        Schema::dropIfExists('business_modules');
    }
};
