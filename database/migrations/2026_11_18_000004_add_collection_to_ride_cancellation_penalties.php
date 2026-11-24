<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ride hailing — Stage C: collecting an OWED ₱50 cancellation penalty
 * (owner decisions 2026-11-18). Never added to any order's amounts:
 * - cash: the passenger's next driver collects it at the drop-off and
 *   confirms it separately (collection_order_id / collection_delivery_id =
 *   that ride; collected_by = that driver);
 * - online: its own PayMongo payment (collection_payment_id).
 * status becomes 'collected'. Under-review and disputed penalties are never
 * collected. Paying the compensated rider is Stage D.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ride_cancellation_penalties', function (Blueprint $table) {
            $table->timestamp('collected_at')->nullable()->after('resolution_note');
            $table->string('collection_method', 20)->nullable()->after('collected_at'); // cash | online
            $table->foreignId('collected_by')->nullable()->after('collection_method')->constrained('users')->nullOnDelete();
            $table->foreignId('collection_order_id')->nullable()->after('collected_by')->constrained('orders')->nullOnDelete();
            $table->foreignId('collection_delivery_id')->nullable()->after('collection_order_id')->constrained('deliveries')->nullOnDelete();
            $table->foreignId('collection_payment_id')->nullable()->after('collection_delivery_id')->constrained('payments')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('ride_cancellation_penalties', function (Blueprint $table) {
            $table->dropConstrainedForeignId('collection_payment_id');
            $table->dropConstrainedForeignId('collection_delivery_id');
            $table->dropConstrainedForeignId('collection_order_id');
            $table->dropConstrainedForeignId('collected_by');
            $table->dropColumn(['collected_at', 'collection_method']);
        });
    }
};
