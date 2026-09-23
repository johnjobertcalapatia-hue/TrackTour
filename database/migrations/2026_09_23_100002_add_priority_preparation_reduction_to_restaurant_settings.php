<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('restaurant_settings', function (Blueprint $table) {
            // Optional restaurant opt-in: priority tips may shorten the
            // preparation countdown. Disabled by default — the tip's primary
            // effect is delivery/rider priority (spec §11/§12).
            $table->boolean('priority_preparation_reduction_enabled')->default(false)->after('auto_preparation_prediction_enabled');
            $table->unsignedTinyInteger('priority_reduction_minutes_25')->default(0)->after('priority_preparation_reduction_enabled')
                ->comment('minutes removed for a ₱25 priority tip');
            $table->unsignedTinyInteger('priority_reduction_minutes_50')->default(5)->after('priority_reduction_minutes_25')
                ->comment('minutes removed for a ₱50 priority tip');
            $table->unsignedTinyInteger('priority_reduction_minutes_100')->default(10)->after('priority_reduction_minutes_50')
                ->comment('minutes removed for a ₱100 fast priority tip');
        });
    }

    public function down(): void
    {
        Schema::table('restaurant_settings', function (Blueprint $table) {
            $table->dropColumn([
                'priority_preparation_reduction_enabled',
                'priority_reduction_minutes_25',
                'priority_reduction_minutes_50',
                'priority_reduction_minutes_100',
            ]);
        });
    }
};
