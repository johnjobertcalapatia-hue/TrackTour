<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_earnings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->decimal('delivery_fee', 12, 2);
            $table->decimal('rider_tip', 12, 2)->default(0);
            $table->decimal('total_earning', 12, 2); // delivery_fee + rider_tip
            $table->string('status')->default('pending'); // pending, earned, cancelled
            $table->timestamp('earned_at')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'status']);
            $table->index(['rider_id', 'earned_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_earnings');
    }
};
