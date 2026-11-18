<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ride hailing — time-based additional fees (owner decisions 2026-11-18).
 *
 * ride_time_events      append-only timeline of the timed ride steps
 *                       (pickup arrival confirmed, trip started, …): who,
 *                       the SERVER time, the location and its accuracy, and
 *                       why. event_key is UNIQUE so a repeated tap or a retry
 *                       records the step once (e.g. "pickup_arrival:{delivery}").
 *
 * ride_additional_charges  one itemised charge per row (pickup waiting now;
 *                       tourist-requested stops later): type, start/end
 *                       events, duration, the rule (free seconds, unit, rate),
 *                       amount and status. charge_key is UNIQUE so the same
 *                       charge is never created twice.
 *
 * The booked fare (orders.subtotal / the ride_quoted ledger event) is never
 * changed by these rows: orders.total = subtotal + approved charges.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ride_time_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('delivery_id')->constrained('deliveries')->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('actor_role', 20);
            $table->string('event_type', 40);
            $table->string('event_key', 120)->unique();
            // useCurrent(): MariaDB would otherwise add ON UPDATE to the first NOT NULL timestamp.
            $table->timestamp('occurred_at')->useCurrent();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('accuracy_m', 8, 2)->nullable();
            $table->string('location_source', 20)->nullable();
            $table->string('reason', 255)->nullable();
            $table->unsignedBigInteger('ride_stop_id')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['delivery_id', 'event_type']);
        });

        Schema::create('ride_additional_charges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('delivery_id')->constrained('deliveries')->cascadeOnDelete();
            $table->string('charge_type', 30);
            $table->string('charge_key', 120)->unique();
            $table->foreignId('start_event_id')->nullable()->constrained('ride_time_events')->nullOnDelete();
            $table->foreignId('end_event_id')->nullable()->constrained('ride_time_events')->nullOnDelete();
            $table->unsignedInteger('duration_seconds');
            $table->unsignedInteger('free_seconds')->default(0);
            $table->unsignedInteger('unit_seconds');
            $table->decimal('rate', 8, 2);
            $table->string('method', 120);
            $table->decimal('amount', 10, 2);
            // approved (charged) | pending_review (never charged automatically) | void
            $table->string('status', 20)->default('approved');
            $table->timestamps();
            $table->index(['order_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ride_additional_charges');
        Schema::dropIfExists('ride_time_events');
    }
};
