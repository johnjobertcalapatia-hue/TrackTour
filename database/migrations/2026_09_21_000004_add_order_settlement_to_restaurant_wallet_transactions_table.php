<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('restaurant_wallet_transactions', function (Blueprint $table) {
            $table->foreignId('order_settlement_id')
                ->nullable()
                ->after('business_id')
                ->constrained('order_settlements')
                ->nullOnDelete();

            // The P12.2 earning effect may be posted once per settlement.
            $table->unique('order_settlement_id');
        });
    }

    public function down(): void
    {
        Schema::table('restaurant_wallet_transactions', function (Blueprint $table) {
            $table->dropUnique(['order_settlement_id']);
            $table->dropConstrainedForeignId('order_settlement_id');
        });
    }
};
