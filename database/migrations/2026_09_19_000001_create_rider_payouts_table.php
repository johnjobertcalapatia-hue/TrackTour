<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_payouts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->string('payout_number', 32)->unique();
            $table->decimal('amount', 12, 2);
            $table->string('status')->default('pending'); // pending, approved, rejected, paid, cancelled
            $table->timestamp('requested_at')->useCurrent();
            $table->unsignedBigInteger('reviewed_by')->nullable(); // admin user
            $table->timestamp('reviewed_at')->nullable();
            $table->string('review_note')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'status']);
            $table->index(['status', 'requested_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_payouts');
    }
};
