<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cod_settlements', function (Blueprint $table) {
            $table->id();
            $table->string('settlement_number', 32)->nullable()->unique();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('delivery_id')->constrained('deliveries')->cascadeOnDelete();
            $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            // Gross settlement base = the rider-financed amount the rider pre-funded
            // out of their credit wallet (reserved at dispatch-accept time).
            $table->decimal('settlement_base', 12, 2);
            // Restaurant net receivable after the platform split.
            $table->decimal('restaurant_share', 12, 2);
            // Tourism Office / platform revenue share of the settlement.
            $table->decimal('platform_fee', 12, 2);
            $table->string('status')->default('settled');
            $table->timestamp('settled_at')->useCurrent();
            $table->timestamps();

            // One settlement per COD order; the DB backstop for duplicate splits.
            $table->unique('order_id');
            $table->index(['business_id', 'status']);
            $table->index(['rider_id', 'status']);
            $table->index('delivery_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cod_settlements');
    }
};