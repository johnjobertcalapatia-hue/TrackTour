<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_pickup_stops', function (Blueprint $table) {
            $table->timestamp('arrived_at')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('delivery_pickup_stops', function (Blueprint $table) {
            $table->dropColumn('arrived_at');
        });
    }
};
