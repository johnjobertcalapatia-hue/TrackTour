<?php

use App\Services\RideCancellationPenaltyService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Owner decision 2026-11-23: an owed cancellation fee is added automatically
 * to the tourist's next ride or food order payment — no Tourism Office review.
 *
 *  - payment_penalty_items: which owed fee(s) an online ride / food payment
 *    also paid, and how much. The order's paid amount and its refund limit
 *    exclude these, so cancelling a food order never refunds a fee that was
 *    owed and paid; each fee is marked collected once.
 *  - Penalties still "under review" or "disputed" become owed (ledger +
 *    activity log per penalty; a held rider compensation is released).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_penalty_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payment_id')->constrained('payments')->cascadeOnDelete();
            $table->foreignId('penalty_id')->constrained('ride_cancellation_penalties')->restrictOnDelete();
            $table->decimal('amount', 10, 2);
            // Set when the payment was confirmed and the fee marked collected.
            $table->timestamp('applied_at')->nullable();
            $table->timestamps();
            $table->unique(['payment_id', 'penalty_id']);
        });

        app(RideCancellationPenaltyService::class)->oweReviewed();
    }

    public function down(): void
    {
        // Converted penalties stay owed: the ledger already records the change.
        Schema::dropIfExists('payment_penalty_items');
    }
};
