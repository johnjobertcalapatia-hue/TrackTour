<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_settlements', function (Blueprint $table) {
            $table->id();
            $table->string('settlement_number', 40)->unique();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('business_id')->constrained('businesses')->cascadeOnDelete();
            $table->foreignId('cod_settlement_id')->nullable()->constrained('cod_settlements')->nullOnDelete();
            $table->string('source', 32);
            $table->string('payment_method', 32);
            $table->decimal('settlement_base', 12, 2);
            $table->decimal('restaurant_amount', 12, 2);
            $table->decimal('platform_amount', 12, 2)->default(0);
            $table->string('status', 32)->default('settled');
            $table->timestamp('settled_at')->useCurrent();
            $table->timestamps();

            // One completed restaurant order has one earning settlement.
            $table->unique('order_id');
            // A COD allocation can feed one, and only one, common settlement.
            $table->unique('cod_settlement_id');
            $table->index(['business_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_settlements');
    }
};
