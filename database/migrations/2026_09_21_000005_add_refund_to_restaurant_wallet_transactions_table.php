<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('restaurant_wallet_transactions', function (Blueprint $table) {
            $table->foreignId('refund_id')->nullable()->after('order_settlement_id')->constrained('refunds')->nullOnDelete();
            $table->unique('refund_id');
        });
    }

    public function down(): void
    {
        Schema::table('restaurant_wallet_transactions', function (Blueprint $table) {
            $table->dropUnique(['refund_id']);
            $table->dropConstrainedForeignId('refund_id');
        });
    }
};
