<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            // Rider preference only: while enabled, the rider's device accepts
            // the first dispatch ping it receives through the canonical atomic
            // accept endpoint. Nothing in dispatch reads this during a wave.
            $table->boolean('auto_accept')->default(false)->after('current_service');
        });
    }

    public function down(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->dropColumn('auto_accept');
        });
    }
};
