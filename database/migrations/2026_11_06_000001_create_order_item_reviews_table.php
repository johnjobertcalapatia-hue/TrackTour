<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-dish reviews from My Orders → To Review ("Write review"): star rating,
 * feedback and photos of the food received.
 *
 * Separate from `reviews` (one business review per order, UNIQUE order_id),
 * which is kept as-is; each item review also refreshes that order review so
 * restaurant ratings and the rider's delivery_rating keep working.
 * UNIQUE(order_item_id) = at most one review per ordered dish (DB backstop).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('order_item_reviews')) {
            return;
        }

        Schema::create('order_item_reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_item_id')->unique()->constrained('order_items')->cascadeOnDelete();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('offering_id')->nullable()->constrained('offerings')->nullOnDelete();
            $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedTinyInteger('rating');
            $table->text('review')->nullable();
            $table->json('images')->nullable();
            $table->timestamps();

            $table->index(['offering_id', 'order_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_item_reviews');
    }
};
