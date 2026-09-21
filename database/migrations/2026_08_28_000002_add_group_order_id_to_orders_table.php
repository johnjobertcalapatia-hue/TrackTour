<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('group_order_id')->nullable()->after('business_id');
            $table->foreign('group_order_id')
                ->references('id')
                ->on('group_checkouts')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign(['group_order_id']);
            $table->dropColumn('group_order_id');
        });
    }
};
