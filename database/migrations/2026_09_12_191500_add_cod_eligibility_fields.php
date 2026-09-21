<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_details', function (Blueprint $table) {
            $table->decimal('working_credit', 12, 2)->default(0)->after('current_service');
            $table->decimal('reserved_working_credit', 12, 2)->default(0)->after('working_credit');
            $table->unsignedInteger('active_order_limit')->default(2)->after('reserved_working_credit');
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->decimal('cod_credit_reserved', 12, 2)->default(0)->after('rider_commission');
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn('cod_credit_reserved');
        });

        Schema::table('rider_details', function (Blueprint $table) {
            $table->dropColumn([
                'working_credit',
                'reserved_working_credit',
                'active_order_limit',
            ]);
        });
    }
};
