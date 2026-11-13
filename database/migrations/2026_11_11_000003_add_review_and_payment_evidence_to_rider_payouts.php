<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Secure rider cashout (decision 2026-11-11): every cashout is reviewed and
 * approved by the Tourism Office, paid manually through GCash, and recorded
 * with the transfer evidence. Adds the destination, the review / approval /
 * payment / failure records and a snapshot of the earnings in the request.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_payouts', function (Blueprint $table) {
            $table->string('destination_gcash_number', 20)->nullable()->after('amount');
            $table->string('destination_account_name', 120)->nullable()->after('destination_gcash_number');
            // The earnings in the request when it was made (kept after a rejection
            // releases them), so every peso stays traceable.
            $table->json('items_snapshot')->nullable()->after('destination_account_name');

            $table->unsignedBigInteger('review_started_by')->nullable()->after('requested_at');
            $table->timestamp('review_started_at')->nullable()->after('review_started_by');
            $table->unsignedBigInteger('approved_by')->nullable()->after('review_note');
            $table->timestamp('approved_at')->nullable()->after('approved_by');
            $table->string('rejection_reason', 500)->nullable()->after('approved_at');

            $table->unsignedBigInteger('paid_by')->nullable()->after('paid_at');
            $table->string('payment_reference', 64)->nullable()->unique()->after('paid_by');
            $table->decimal('paid_amount', 12, 2)->nullable()->after('payment_reference');
            $table->string('paid_recipient_number', 20)->nullable()->after('paid_amount');
            $table->string('paid_recipient_name', 120)->nullable()->after('paid_recipient_number');
            $table->string('payment_proof_path')->nullable()->after('paid_recipient_name');

            $table->unsignedBigInteger('failed_by')->nullable()->after('payment_proof_path');
            $table->timestamp('failed_at')->nullable()->after('failed_by');
            $table->string('failure_reason', 500)->nullable()->after('failed_at');
        });
    }

    public function down(): void
    {
        Schema::table('rider_payouts', function (Blueprint $table) {
            $table->dropUnique(['payment_reference']);
            $table->dropColumn([
                'destination_gcash_number', 'destination_account_name', 'items_snapshot',
                'review_started_by', 'review_started_at', 'approved_by', 'approved_at', 'rejection_reason',
                'paid_by', 'payment_reference', 'paid_amount', 'paid_recipient_number', 'paid_recipient_name', 'payment_proof_path',
                'failed_by', 'failed_at', 'failure_reason',
            ]);
        });
    }
};
