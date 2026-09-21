<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('refunds', function (Blueprint $table) {
            $table->foreignId('order_item_id')->nullable()->constrained('order_items')->nullOnDelete();
            $table->decimal('original_amount', 12, 2)->default(0)->after('amount');
            $table->decimal('refund_deduction', 12, 2)->default(0)->after('original_amount');
        });
    }

    public function down(): void
    {
        Schema::table('refunds', function (Blueprint $table) {
            $table->dropForeign(['order_item_id']);
            $table->dropColumn(['order_item_id', 'original_amount', 'refund_deduction']);
        });
    }
};
