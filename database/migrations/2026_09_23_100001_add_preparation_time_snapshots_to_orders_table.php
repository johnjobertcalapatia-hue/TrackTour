<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            // Snapshot of the effective preparation minutes used for this
            // order's countdown timer (max item prep time minus any priority
            // reduction), captured when preparation starts. Later menu edits
            // must never change an existing order's timer.
            $table->unsignedSmallInteger('preparation_time')
                ->nullable()
                ->after('prediction_source')
                ->comment('effective preparation minutes snapshotted at prep start');
        });

        Schema::table('order_items', function (Blueprint $table) {
            // Snapshot of the offering's preparation_time at order creation.
            $table->unsignedSmallInteger('preparation_time')
                ->nullable()
                ->after('subtotal')
                ->comment('minutes snapshotted from the offering at order time');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('preparation_time');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('preparation_time');
        });
    }
};
