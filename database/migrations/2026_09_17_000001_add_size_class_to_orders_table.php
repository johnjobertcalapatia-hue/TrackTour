<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * P5.2 order-size tag. This is intentionally a lightweight, quantity-based
     * classification ('normal' | 'large'), NOT a weight/dimension capacity
     * engine. Large orders are flagged for operational visibility but are still
     * dispatched normally (flag-only).
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('size_class', 16)->default('normal');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('size_class');
        });
    }
};
