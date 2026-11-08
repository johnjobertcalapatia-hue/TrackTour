<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rider trip flow, Stage B (decision 2026-11-08): for COD, a restaurant's food
 * may only become READY after the RESTAURANT confirms it received the rider's
 * payment. That confirmation is the restaurant's own act, stored separately
 * from the rider's purchase ledger (status purchased/collected), so a rider
 * can never unlock "ready" alone. Enforced by CodPickupPaymentGuard.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('cod_purchases', 'payment_confirmed_at')) {
            Schema::table('cod_purchases', function (Blueprint $table) {
                $table->timestamp('payment_confirmed_at')->nullable()->after('purchased_at');
                $table->foreignId('payment_confirmed_by')->nullable()->after('payment_confirmed_at')
                    ->constrained('users')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('cod_purchases', 'payment_confirmed_at')) {
            Schema::table('cod_purchases', function (Blueprint $table) {
                $table->dropConstrainedForeignId('payment_confirmed_by');
                $table->dropColumn('payment_confirmed_at');
            });
        }
    }
};
