<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('delivery_speed')->default('standard')->after('order_type');
            $table->decimal('rider_tip', 12, 2)->default(0)->after('delivery_fee');
        });

        Schema::table('group_checkouts', function (Blueprint $table) {
            $table->string('delivery_speed')->default('standard')->after('order_type');
            $table->decimal('rider_tip', 12, 2)->default(0)->after('delivery_total');
        });
    }

    public function down(): void
    {
        Schema::table('group_checkouts', function (Blueprint $table) {
            $table->dropColumn(['delivery_speed', 'rider_tip']);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['delivery_speed', 'rider_tip']);
        });
    }
};
