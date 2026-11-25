<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Resort reservations Stage 8 (docs/resort-reservation-architecture.md §11):
 * GCash payment and refunds. Additive.
 *
 * - payment_due_at: an unpaid GCash reservation holds its units until then
 *   (30 minutes), after which it expires and the units are released.
 * - refund_due: how much the policy says goes back to the tourist, decided when
 *   the reservation is cancelled / rejected. The refunds themselves live in the
 *   `refunds` ledger (PaymentRefundProcessor); refund_due lets a refund PayMongo
 *   refused be retried for exactly what is still owed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->timestamp('payment_due_at')->nullable()->after('payment_option');
            $table->decimal('refund_due', 12, 2)->nullable()->after('paid_amount');
            $table->index(['booking_type', 'payment_status', 'payment_due_at'], 'bookings_resort_payment_due_index');
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex('bookings_resort_payment_due_index');
            $table->dropColumn(['payment_due_at', 'refund_due']);
        });
    }
};
