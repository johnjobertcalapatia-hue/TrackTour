<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_credit_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->string('transaction_type'); // COD_RESERVE, COD_RELEASE, CREDIT_TOPUP, CREDIT_ADJUSTMENT, REFUND
            $table->decimal('amount', 12, 2);
            $table->decimal('balance_before', 12, 2);
            $table->decimal('balance_after', 12, 2);
            $table->string('reference')->nullable();
            $table->text('description')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'transaction_type']);
            $table->index(['rider_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_credit_transactions');
    }
};
