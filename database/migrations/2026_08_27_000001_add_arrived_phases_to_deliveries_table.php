<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->timestamp('arrived_pickup_at')->nullable()->after('picked_up_at');
            $table->timestamp('arrived_destination_at')->nullable()->after('arrived_pickup_at');
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn(['arrived_pickup_at', 'arrived_destination_at']);
        });
    }
};
