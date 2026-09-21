<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('group_checkouts', function (Blueprint $table) {
            $table->decimal('system_fee_total', 12, 2)->default(0)->after('delivery_total');
        });
    }

    public function down(): void
    {
        Schema::table('group_checkouts', function (Blueprint $table) {
            $table->dropColumn('system_fee_total');
        });
    }
};