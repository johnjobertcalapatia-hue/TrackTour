<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            // Restaurant-defined preparation minutes for this menu item.
            // The order preparation timer uses a snapshot of this value
            // (see orders.preparation_time / order_items.preparation_time).
            $table->unsignedSmallInteger('preparation_time')
                ->nullable()
                ->after('price')
                ->comment('minutes the restaurant needs to prepare this item');
        });
    }

    public function down(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->dropColumn('preparation_time');
        });
    }
};
