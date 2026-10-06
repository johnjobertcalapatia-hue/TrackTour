<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            // Actual GPS point captured when the RIDER confirms the LAST pickup
            // stop. This is the authoritative "food was picked up here" coordinate,
            // distinct from the planned pickup_latitude/longitude used by dispatch,
            // fees, offers and the rider geofence (which must not be overwritten).
            $table->decimal('pickup_actual_latitude', 10, 7)->nullable()->after('pickup_longitude');
            $table->decimal('pickup_actual_longitude', 10, 7)->nullable()->after('pickup_actual_latitude');
            $table->timestamp('pickup_actual_at')->nullable()->after('pickup_actual_longitude');

            // Tourist delivery-confirmation gate: a food delivery is only marked
            // 'delivered' once the tourist confirms receipt at the drop-off.
            $table->timestamp('delivery_confirmed_at')->nullable()->after('delivered_at');
            $table->unsignedBigInteger('delivery_confirmed_by')->nullable()->after('delivery_confirmed_at');
        });

        Schema::table('orders', function (Blueprint $table) {
            // Persist the tourist's delivery rating on the order so rider ratings
            // can be aggregated (currently only stored on the optional reviews row).
            $table->unsignedTinyInteger('delivery_rating')->nullable()->after('rating');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('delivery_rating');
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn([
                'pickup_actual_latitude',
                'pickup_actual_longitude',
                'pickup_actual_at',
                'delivery_confirmed_at',
                'delivery_confirmed_by',
            ]);
        });
    }
};