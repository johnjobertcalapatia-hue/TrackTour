<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Purchasing-cash COD flow (professor model):
     *
     *   Tourist → COD order → ONE delivery → rider accepts
     *     → Tourism Office issues purchasing cash (deliveries.purchasing_cash*)
     *     → rider buys/collects at each restaurant (cod_purchases rows)
     *     → all collected gate → delivery → tourist pays cash → settlement
     *
     * cod_purchases is the auditable per-restaurant buy/collect ledger. One row
     * per (delivery, business). The per-business purchase_amount uses the exact
     * CodSettlementService allocation formula (business subtotal + system-fee
     * share) so the sum always equals order.rider_financed_amount, the
     * authoritative settlement base (AGENTS.md §5.3).
     */
    public function up(): void
    {
        Schema::create('cod_purchases', function (Blueprint $table) {
            $table->id();
            $table->string('purchase_number', 32)->nullable()->unique();
            $table->foreignId('delivery_id')->constrained('deliveries')->cascadeOnDelete();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
            $table->decimal('purchase_amount', 12, 2);
            $table->string('status', 16)->default('pending');
            $table->timestamp('purchased_at')->nullable();
            $table->timestamp('collected_at')->nullable();
            $table->timestamps();

            $table->unique(['delivery_id', 'business_id']);
            $table->index(['delivery_id', 'status']);
            $table->index(['business_id', 'status']);
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->decimal('purchasing_cash', 12, 2)->nullable()->after('cash_settled_at');
            $table->timestamp('purchasing_cash_issued_at')->nullable()->after('purchasing_cash');
            $table->timestamp('purchasing_cash_received_at')->nullable()->after('purchasing_cash_issued_at');
            $table->foreignId('purchasing_cash_issued_by')->nullable()->after('purchasing_cash_received_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('purchasing_cash_issued_by');
            $table->dropColumn(['purchasing_cash', 'purchasing_cash_issued_at', 'purchasing_cash_received_at']);
        });

        Schema::dropIfExists('cod_purchases');
    }
};