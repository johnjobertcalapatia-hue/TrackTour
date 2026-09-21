<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->decimal('cash_due', 12, 2)->nullable()->after('cod_credit_reserved');
            $table->decimal('cash_received', 12, 2)->nullable()->after('cash_due');
            $table->decimal('change_given', 12, 2)->nullable()->after('cash_received');
            $table->timestamp('cash_settled_at')->nullable()->after('change_given');
        });

        Schema::table('rider_credit_transactions', function (Blueprint $table) {
            $table->decimal('reserved_before', 12, 2)->nullable()->after('balance_after');
            $table->decimal('reserved_after', 12, 2)->nullable()->after('reserved_before');
        });
    }

    public function down(): void
    {
        Schema::table('rider_credit_transactions', function (Blueprint $table) {
            $table->dropColumn(['reserved_before', 'reserved_after']);
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn(['cash_due', 'cash_received', 'change_given', 'cash_settled_at']);
        });
    }
};