<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ride hailing — one-time destination change (2026-11-17).
 *
 * One row per CONFIRMED change (UNIQUE order_id: a trip has at most one).
 * Previews are never stored, so an abandoned or refused preview does not use
 * the allowance. The ride's delivery row is updated in place to the new
 * destination (no second booking or trip); the original destination, the
 * booked fare and the booked commission stay here and in the ride's
 * transaction ledger ("ride_quoted" is never modified).
 *
 * Fare columns: estimated_fare is the revised estimate the tourist confirmed;
 * max_fare = round(estimated_fare × 1.15, 2); at arrival the fare is computed
 * from the VERIFIED GPS distance only (computed_fare), capped at max_fare
 * (final_fare), and the capped-off amount is cap_adjustment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ride_destination_changes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->unique()->constrained('orders')->cascadeOnDelete();
            $table->foreignId('delivery_id')->constrained('deliveries')->cascadeOnDelete();
            $table->foreignId('requested_by')->constrained('users');
            // Same key twice (double tap / retried request) returns the same change.
            $table->string('idempotency_key', 64)->unique();
            // confirmed → finalized (final fare computed at arrival).
            $table->string('status', 20)->default('confirmed');

            $table->text('original_address')->nullable();
            $table->decimal('original_latitude', 10, 7);
            $table->decimal('original_longitude', 10, 7);
            $table->text('new_address')->nullable();
            $table->string('new_name')->nullable();
            $table->decimal('new_latitude', 10, 7);
            $table->decimal('new_longitude', 10, 7);

            // Booking (historical) and the fare configuration used: the ride's booked rates.
            $table->decimal('original_fare', 10, 2);
            $table->decimal('original_commission', 10, 2);
            $table->string('vehicle_type', 20);
            $table->decimal('base_fare', 10, 2);
            $table->decimal('per_km', 10, 2);
            $table->char('fare_settings_fingerprint', 64)->nullable();

            // Revised estimate shown and confirmed.
            $table->decimal('traveled_km_at_change', 10, 3);
            $table->decimal('remaining_km_estimate', 10, 3);
            $table->string('remaining_route_source', 20);
            $table->decimal('estimated_fare', 10, 2);
            $table->decimal('max_fare', 10, 2);
            // useCurrent(): MariaDB would otherwise add ON UPDATE CURRENT_TIMESTAMP
            // to the first NOT NULL timestamp and rewrite it on every update.
            $table->timestamp('confirmed_at')->useCurrent();

            // Rider notification (best effort) and acknowledgement, kept apart.
            $table->string('rider_notification_status', 20)->default('pending');
            $table->timestamp('rider_notified_at')->nullable();
            $table->timestamp('rider_acknowledged_at')->nullable();

            // Final fare (at arrival).
            $table->decimal('verified_km', 10, 3)->nullable();
            $table->decimal('unverified_km', 10, 3)->nullable();
            $table->json('track_summary')->nullable();
            $table->decimal('computed_fare', 10, 2)->nullable();
            $table->decimal('final_fare', 10, 2)->nullable();
            $table->decimal('cap_adjustment', 10, 2)->nullable();
            $table->decimal('final_commission', 10, 2)->nullable();
            // ok | needs_review (GPS evidence insufficient: only verified distance was charged).
            $table->string('fare_review_status', 20)->nullable();
            $table->json('review_reasons')->nullable();
            $table->timestamp('finalized_at')->nullable();

            $table->timestamps();
            $table->index(['delivery_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ride_destination_changes');
    }
};
