<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Chat per order: one conversation per (order, restaurant). In a group checkout
 * the tourist has a separate thread with each restaurant in the order.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_rooms', function (Blueprint $table) {
            $table->foreignId('order_id')->nullable()->after('business_id')->constrained('orders')->nullOnDelete();
            $table->unique(['order_id', 'business_id']);
        });
    }

    public function down(): void
    {
        Schema::table('chat_rooms', function (Blueprint $table) {
            $table->dropUnique(['order_id', 'business_id']);
            $table->dropConstrainedForeignId('order_id');
        });
    }
};
