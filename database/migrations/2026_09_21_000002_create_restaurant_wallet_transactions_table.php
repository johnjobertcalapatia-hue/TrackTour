<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('restaurant_wallet_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('transaction_number', 40)->unique();
            $table->foreignId('wallet_id')->constrained('restaurant_wallets')->cascadeOnDelete();
            $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
            $table->string('type', 32);
            $table->string('reference_type', 100)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            // Signed value: credits are positive and debits are negative.
            $table->decimal('amount', 12, 2);
            $table->decimal('available_balance_before', 12, 2);
            $table->decimal('available_balance_after', 12, 2);
            $table->decimal('pending_balance_before', 12, 2);
            $table->decimal('pending_balance_after', 12, 2);
            $table->text('description')->nullable();
            $table->timestamps();

            $table->index(['wallet_id', 'created_at']);
            $table->index(['business_id', 'type']);
            $table->index(['reference_type', 'reference_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('restaurant_wallet_transactions');
    }
};
