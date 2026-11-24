<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staff Management, restaurant roles (docs/staff-management-plan.md §5): the
 * restaurant's "Handed to rider" confirmation — who confirmed, when, for which
 * restaurant and rider. One per delivery and restaurant (a group checkout has
 * one per participating restaurant). The rider's own pickup confirmation
 * (delivery_pickup_stops) is separate and unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('restaurant_handovers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('delivery_id')->constrained()->cascadeOnDelete();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('rider_id')->constrained('users');
            $table->foreignId('confirmed_by')->constrained('users');
            $table->timestamp('confirmed_at');
            $table->timestamps();

            $table->unique(['delivery_id', 'business_id']);
            $table->index(['business_id', 'confirmed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('restaurant_handovers');
    }
};
