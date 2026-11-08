<?php

use App\Services\ResortClassificationService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dynamic resort system, Stage 1 (docs/resort-reservation-architecture.md):
 * multiple resort types and structured facilities per resort business.
 * Resort profiles reuse `businesses` (no separate profile table).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('resort_types')) {
            Schema::create('resort_types', function (Blueprint $table) {
                $table->id();
                $table->string('slug', 50)->unique();
                $table->string('name', 100);
                $table->string('description')->nullable();
                $table->unsignedSmallInteger('sort_order')->default(0);
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('business_resort_types')) {
            Schema::create('business_resort_types', function (Blueprint $table) {
                $table->id();
                $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
                $table->foreignId('resort_type_id')->constrained('resort_types')->cascadeOnDelete();
                $table->timestamps();
                $table->unique(['business_id', 'resort_type_id']);
            });
        }

        if (! Schema::hasTable('resort_facilities')) {
            Schema::create('resort_facilities', function (Blueprint $table) {
                $table->id();
                $table->string('slug', 50)->unique();
                $table->string('name', 100);
                $table->unsignedSmallInteger('sort_order')->default(0);
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('business_resort_facilities')) {
            Schema::create('business_resort_facilities', function (Blueprint $table) {
                $table->id();
                $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
                $table->foreignId('resort_facility_id')->constrained('resort_facilities')->cascadeOnDelete();
                $table->timestamps();
                // Explicit name: the generated one is exactly MySQL's 64-char limit.
                $table->unique(['business_id', 'resort_facility_id'], 'biz_resort_facilities_unique');
            });
        }

        // Owner-added facilities that aren't in the catalogue.
        if (! Schema::hasTable('business_resort_custom_facilities')) {
            Schema::create('business_resort_custom_facilities', function (Blueprint $table) {
                $table->id();
                $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
                $table->string('name', 100);
                $table->timestamps();
                $table->unique(['business_id', 'name']);
            });
        }

        $service = app(ResortClassificationService::class);
        $service->seedCatalogue();
        $service->backfillAllResorts();
    }

    public function down(): void
    {
        Schema::dropIfExists('business_resort_custom_facilities');
        Schema::dropIfExists('business_resort_facilities');
        Schema::dropIfExists('resort_facilities');
        Schema::dropIfExists('business_resort_types');
        Schema::dropIfExists('resort_types');
    }
};
