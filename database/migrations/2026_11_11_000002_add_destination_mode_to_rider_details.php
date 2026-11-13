<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rider "My Destination" mode: a preferred end point (e.g. heading home).
 * While it is set and not expired, dispatch only offers the rider jobs whose
 * pickup and drop-off lie along the route to it (RiderDestinationService).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->string('destination_label', 160)->nullable()->after('active_order_limit');
            $table->decimal('destination_latitude', 10, 7)->nullable()->after('destination_label');
            $table->decimal('destination_longitude', 10, 7)->nullable()->after('destination_latitude');
            $table->timestamp('destination_set_at')->nullable()->after('destination_longitude');
            $table->timestamp('destination_expires_at')->nullable()->after('destination_set_at');
        });
    }

    public function down(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->dropColumn([
                'destination_label',
                'destination_latitude',
                'destination_longitude',
                'destination_set_at',
                'destination_expires_at',
            ]);
        });
    }
};
