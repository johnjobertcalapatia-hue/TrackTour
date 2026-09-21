<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_payout_rider_earning', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_payout_id')->constrained('rider_payouts')->cascadeOnDelete();
            // UNIQUE(rider_earning_id) IS the idempotency key: an earning already
            // linked to a pending/approved/paid payout can never be re-linked,
            // so the same ₱ can never be paid out twice.
            $table->foreignId('rider_earning_id')->unique()->constrained('rider_earnings')->cascadeOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_payout_rider_earning');
    }
};
