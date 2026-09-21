<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->index(['business_id', 'status'], 'orders_business_status_idx');
            $table->index(['business_id', 'created_at'], 'orders_business_created_idx');
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->index(['business_id', 'status'], 'bookings_business_status_idx');
            $table->index(['business_id', 'created_at'], 'bookings_business_created_idx');
        });

        Schema::table('promotions', function (Blueprint $table) {
            $table->index(['business_id', 'is_active'], 'promotions_business_active_idx');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('orders_business_status_idx');
            $table->dropIndex('orders_business_created_idx');
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex('bookings_business_status_idx');
            $table->dropIndex('bookings_business_created_idx');
        });

        Schema::table('promotions', function (Blueprint $table) {
            $table->dropIndex('promotions_business_active_idx');
        });
    }
};
