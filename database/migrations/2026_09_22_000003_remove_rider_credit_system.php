<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['rider_top_ups', 'rider_credit_transactions', 'rider_credits'] as $table) {
            if (Schema::hasTable($table)) {
                Schema::drop($table);
            }
        }

        if (Schema::hasTable('deliveries') && Schema::hasColumn('deliveries', 'cod_credit_reserved')) {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->dropColumn('cod_credit_reserved');
            });
        }

        if (Schema::hasTable('rider_details')) {
            $columns = array_values(array_filter([
                Schema::hasColumn('rider_details', 'working_credit') ? 'working_credit' : null,
                Schema::hasColumn('rider_details', 'reserved_working_credit') ? 'reserved_working_credit' : null,
            ]));

            if ($columns !== []) {
                Schema::table('rider_details', function (Blueprint $table) use ($columns) {
                    $table->dropColumn($columns);
                });
            }
        }
    }

    public function down(): void
    {
        throw new RuntimeException('The obsolete rider-credit system is intentionally not reversible.');
    }
};
