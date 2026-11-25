<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dynamic resort system, Stage 6 (docs/resort-reservation-architecture.md §11):
 * availability.
 *
 * - resort_blocked_dates: owner closures, for the whole resort
 *   (resort_offering_id NULL) or one offering, as an inclusive date range.
 * - resort_offering_allocations: how much of an offering is reserved on a date
 *   (and, for time-slot offerings, a start time). One row per
 *   (offering, date, slot) — UNIQUE — so concurrent reservations lock the same
 *   row (lockForUpdate) and the capacity check is made under that lock. `slot`
 *   is '' for whole-day/night use so the UNIQUE key never contains NULL.
 *   `reserved_quantity` is unsigned: it can never go below zero.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('resort_blocked_dates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
            $table->foreignId('resort_offering_id')->nullable()->constrained('resort_offerings')->cascadeOnDelete();
            $table->date('start_date');
            $table->date('end_date');
            $table->string('reason', 255)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['business_id', 'start_date', 'end_date']);
        });

        Schema::create('resort_offering_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('resort_offering_id')->constrained('resort_offerings')->cascadeOnDelete();
            $table->date('date');
            $table->string('slot', 5)->default('');
            $table->unsignedInteger('reserved_quantity')->default(0);
            $table->timestamps();

            $table->unique(['resort_offering_id', 'date', 'slot'], 'resort_alloc_offering_date_slot_unique');
            $table->index('date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('resort_offering_allocations');
        Schema::dropIfExists('resort_blocked_dates');
    }
};
