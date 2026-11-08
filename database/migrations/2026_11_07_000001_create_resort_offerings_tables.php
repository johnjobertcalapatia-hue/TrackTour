<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dynamic resort system, Stage 4 (docs/resort-reservation-architecture.md):
 * generic bookable offerings (cottages, rooms, campsites, pool access,
 * activities, equipment, function areas, packages, food services, other).
 *
 * Separate from food `offerings` on purpose: those drive the cart, kitchen,
 * preparation prediction and rider dispatch. Booking behaviour lives in
 * structured columns; `attributes` JSON is display-only extras.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('resort_offerings')) {
            Schema::create('resort_offerings', function (Blueprint $table) {
                $table->id();
                $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
                $table->string('category', 30);
                $table->string('name', 150);
                $table->text('description')->nullable();

                // Booking configuration (validated in App\Models\ResortOffering / the controller).
                $table->string('booking_mode', 20);       // day_use | overnight | time_slot | duration
                $table->string('pricing_basis', 20);      // per_person | per_unit | per_hour | per_night | per_booking
                $table->decimal('price', 10, 2)->unsigned();
                $table->string('inventory_mode', 20);     // units | capacity | slots
                $table->unsignedInteger('inventory_quantity');
                $table->unsignedSmallInteger('min_guests')->nullable();
                $table->unsignedSmallInteger('max_guests')->nullable();
                $table->unsignedSmallInteger('min_quantity')->default(1);
                $table->unsignedSmallInteger('max_quantity')->nullable();
                $table->unsignedSmallInteger('duration_minutes')->nullable();
                $table->boolean('is_required')->default(false);
                $table->boolean('bookable_independently')->default(true);
                $table->foreignId('requires_offering_id')->nullable()->constrained('resort_offerings')->nullOnDelete();

                $table->boolean('is_published')->default(false);
                $table->unsignedSmallInteger('sort_order')->default(0);
                $table->json('attributes')->nullable();
                $table->timestamps();
                $table->softDeletes();

                $table->index(['business_id', 'is_published', 'sort_order']);
            });
        }

        if (! Schema::hasTable('resort_offering_images')) {
            Schema::create('resort_offering_images', function (Blueprint $table) {
                $table->id();
                $table->foreignId('resort_offering_id')->constrained('resort_offerings')->cascadeOnDelete();
                $table->string('path');
                $table->unsignedSmallInteger('sort_order')->default(0);
                $table->timestamps();
                $table->index(['resort_offering_id', 'sort_order']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('resort_offering_images');
        Schema::dropIfExists('resort_offerings');
    }
};
