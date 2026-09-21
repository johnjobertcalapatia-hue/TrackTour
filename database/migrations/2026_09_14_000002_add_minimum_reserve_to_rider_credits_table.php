<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_credits', function (Blueprint $table) {
            $table->decimal('minimum_reserve', 12, 2)->default(200.00)->after('reserved_credits');
        });
    }

    public function down(): void
    {
        Schema::table('rider_credits', function (Blueprint $table) {
            $table->dropColumn('minimum_reserve');
        });
    }
};
