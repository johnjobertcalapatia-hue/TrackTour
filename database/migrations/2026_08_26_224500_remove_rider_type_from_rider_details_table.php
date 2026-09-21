<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->dropColumn('rider_type');
        });
    }

    public function down(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->string('rider_type')->default('food_delivery')->after('current_service');
        });
    }
};
