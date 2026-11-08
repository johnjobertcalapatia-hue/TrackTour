<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->boolean('accepts_orders')->default(true)->after('accepts_reservation');
            $table->boolean('accepts_walk_ins')->default(true)->after('accepts_orders');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn(['accepts_orders', 'accepts_walk_ins']);
        });
    }
};
