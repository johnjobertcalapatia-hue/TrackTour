<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Payment-agnostic per-restaurant pickup stops for a delivery.
     *
     * Every food delivery (COD or prepaid/GCash, single restaurant or group
     * checkout) owns one stop per restaurant that fulfils items. The stop is
     * what the rider must confirm at each pickup ("Confirm Item Pickup") —
     * gated system-side by stop sequence, rider distance within the configured
     * pickup radius, and that restaurant's order items being READY. Confirming
     * the final stop is the precondition for the delivery leaving the pickup
     * area (status -> picked_up).
     *
     * This is deliberately separate from cod_purchases, which remains the COD
     * purchasing-cash money ledger (pending -> purchased -> collected) that
     * reconciles to order.rider_financed_amount. For COD the two ledgers move
     * together: confirming a pickup stop also collects its cod_purchase, and a
     * cod_purchase collected through the cash flow counts as the stop
     * confirmed. Prepaid trips have no cod_purchases rows; the pickup stop is
     * their only confirmation record.
     */
    public function up(): void
    {
        Schema::create('delivery_pickup_stops', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('delivery_id');
            $table->unsignedBigInteger('order_id');
            $table->unsignedBigInteger('business_id');
            $table->unsignedInteger('sequence');
            $table->unsignedInteger('preparation_time')->nullable();
            $table->decimal('pickup_latitude', 10, 7)->nullable();
            $table->decimal('pickup_longitude', 10, 7)->nullable();
            $table->string('pickup_address')->nullable();
            $table->string('status')->default('pending');
            $table->timestamp('pickup_confirmed_at')->nullable();
            $table->timestamps();

            $table->unique(['delivery_id', 'business_id']);
            $table->index(['delivery_id', 'sequence']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_pickup_stops');
    }
};