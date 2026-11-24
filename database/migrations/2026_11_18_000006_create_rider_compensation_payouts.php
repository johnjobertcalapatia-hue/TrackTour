<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ride hailing — Stage D2 (docs/secure-transaction-audit.md §P.5): the
 * original rider's cancellation compensation is paid inside the rider's
 * payout. One compensation payout per request, linked to the existing
 * earnings cashout (rider_payout_id) when the rider also cashes out earnings,
 * or on its own (compensation-only). The existing rider_payouts table and
 * its rules are not changed.
 *
 * active_key: the rider id while the payout is live (one live compensation
 * payout per rider). rider_compensation_payout_items.live_key: the
 * compensation id while its payout is live (a compensation can never sit in
 * two live payouts).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_compensation_payouts', function (Blueprint $table) {
            $table->id();
            $table->string('payout_number', 40)->unique();
            $table->foreignId('rider_id')->constrained('users');
            $table->foreignId('rider_payout_id')->nullable()->unique()->constrained('rider_payouts')->nullOnDelete();
            $table->decimal('amount', 12, 2);
            $table->string('status', 20);                         // pending | under_review | approved | paid | rejected | cancelled | failed
            $table->unsignedBigInteger('active_key')->nullable()->unique();
            $table->string('destination_gcash_number', 20)->nullable();
            $table->string('destination_account_name', 120)->nullable();
            $table->timestamp('requested_at')->useCurrent();
            $table->foreignId('review_started_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('review_started_at')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->string('review_note', 500)->nullable();
            $table->string('rejection_reason', 500)->nullable();
            $table->foreignId('paid_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('paid_at')->nullable();
            $table->string('payment_reference', 64)->nullable();
            $table->decimal('paid_amount', 12, 2)->nullable();
            $table->decimal('transferred_total', 12, 2)->nullable();  // the one GCash transfer (earnings + compensation)
            $table->string('paid_recipient_number', 20)->nullable();
            $table->string('paid_recipient_name', 120)->nullable();
            $table->string('payment_proof_path')->nullable();
            $table->foreignId('failed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('failed_at')->nullable();
            $table->string('failure_reason', 500)->nullable();
            $table->timestamps();
            $table->index(['rider_id', 'status']);
        });

        Schema::create('rider_compensation_payout_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payout_id')->constrained('rider_compensation_payouts')->cascadeOnDelete();
            $table->foreignId('compensation_id')->constrained('rider_cancellation_compensations');
            $table->decimal('amount', 12, 2);
            $table->unsignedBigInteger('live_key')->nullable()->unique();
            $table->timestamps();
            $table->unique(['payout_id', 'compensation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_compensation_payout_items');
        Schema::dropIfExists('rider_compensation_payouts');
    }
};
