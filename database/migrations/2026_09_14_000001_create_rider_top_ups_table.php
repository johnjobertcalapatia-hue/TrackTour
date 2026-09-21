<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_top_ups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->string('payment_method')->default('gcash');
            $table->string('payment_reference')->nullable();
            $table->string('provider')->default('paymongo');
            $table->string('provider_transaction_id')->nullable();
            $table->string('status')->default('pending'); // pending, completed, failed, cancelled
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'status']);
            $table->index('payment_reference');
            $table->index('provider_transaction_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_top_ups');
    }
};
