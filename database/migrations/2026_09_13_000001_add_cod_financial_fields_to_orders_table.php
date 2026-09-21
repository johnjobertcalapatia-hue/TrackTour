<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('system_fee', 12, 2)->default(0)->after('discount');
            $table->decimal('rider_financed_amount', 12, 2)->default(0)->after('system_fee');
            $table->decimal('rider_delivery_earnings', 12, 2)->default(0)->after('rider_financed_amount');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['system_fee', 'rider_financed_amount', 'rider_delivery_earnings']);
        });
    }
};
