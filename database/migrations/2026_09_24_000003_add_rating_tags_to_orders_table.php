<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Optional ride-rating tags on transport orders (ride-hailing Phase 5).
     * Stored as a JSON array: friendly, safe_driving, clean_vehicle,
     * good_communication, arrived_on_time.
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('rating_tags', 500)->nullable()->after('review');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('rating_tags');
        });
    }
};