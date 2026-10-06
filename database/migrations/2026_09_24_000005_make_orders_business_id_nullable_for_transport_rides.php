<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Transport (ride-hailing) orders have no owning restaurant. A ride must
     * never surface in a restaurant/business-owner order list, dashboard, sales
     * ledger or restaurant settlement. The old ride builder hard-coded
     * business_id = 1 as a placeholder; rides now carry business_id = NULL.
     */
    public function up(): void
    {
        // The orders.business_id FK may or may not exist (the dev schema once
        // had it removed after factory-seeding); guard each DDL step.
        $hadForeign = Schema::hasIndex('orders', 'orders_business_id_foreign');

        if ($hadForeign) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropForeign(['business_id']);
            });
        }

        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('business_id')->nullable()->change();
        });

        DB::table('orders')
            ->where('order_type', 'transport')
            ->whereNotNull('business_id')
            ->update(['business_id' => null]);

        if ($hadForeign) {
            Schema::table('orders', function (Blueprint $table) {
                $table->foreign('business_id')->references('id')->on('businesses')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        $hadForeign = Schema::hasIndex('orders', 'orders_business_id_foreign');

        if ($hadForeign) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropForeign(['business_id']);
            });
        }

        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('business_id')->nullable(false)->change();
        });

        if ($hadForeign) {
            Schema::table('orders', function (Blueprint $table) {
                $table->foreign('business_id')->references('id')->on('businesses')->cascadeOnDelete();
            });
        }
    }
};