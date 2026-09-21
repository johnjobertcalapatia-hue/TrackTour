<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_locations', function (Blueprint $table) {
            $table->index(['rider_id', 'recorded_at'], 'idx_rider_locations_rider_recorded');
        });

        Schema::table('trip_logs', function (Blueprint $table) {
            $table->index(['rider_id', 'started_at'], 'idx_trip_logs_rider_started');
        });
    }

    public function down(): void
    {
        Schema::table('rider_locations', function (Blueprint $table) {
            $table->dropIndex('idx_rider_locations_rider_recorded');
        });

        Schema::table('trip_logs', function (Blueprint $table) {
            $table->dropIndex('idx_trip_logs_rider_started');
        });
    }
};
