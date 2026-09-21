<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('delivery_distance_km', 8, 2)->nullable()->after('delivery_fee');
            $table->unsignedInteger('delivery_duration_minutes')->nullable()->after('delivery_distance_km');
            $table->decimal('pickup_latitude', 10, 7)->nullable()->after('delivery_duration_minutes');
            $table->decimal('pickup_longitude', 10, 7)->nullable()->after('pickup_latitude');
            $table->decimal('delivery_latitude', 10, 7)->nullable()->after('pickup_longitude');
            $table->decimal('delivery_longitude', 10, 7)->nullable()->after('delivery_latitude');
            $table->timestamp('delivery_fee_calculated_at')->nullable()->after('delivery_longitude');
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->decimal('delivery_fee', 12, 2)->nullable()->after('rider_id');
            $table->decimal('distance_km', 8, 2)->nullable()->after('delivery_fee');
            $table->unsignedInteger('estimated_duration_minutes')->nullable()->after('distance_km');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn([
                'delivery_distance_km',
                'delivery_duration_minutes',
                'pickup_latitude',
                'pickup_longitude',
                'delivery_latitude',
                'delivery_longitude',
                'delivery_fee_calculated_at',
            ]);
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn(['delivery_fee', 'distance_km', 'estimated_duration_minutes']);
        });
    }
};
