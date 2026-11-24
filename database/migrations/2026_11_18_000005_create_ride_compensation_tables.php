<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ride hailing — Stage D1 (design: docs/secure-transaction-audit.md §P).
 *
 * The ₱50 cancellation penalty compensates the rider who ACCEPTED the
 * cancelled booking (ride_cancellation_penalties.compensated_rider_id).
 * A compensation is created exactly once (penalty_id UNIQUE): when the full
 * penalty is RECEIVED — online: PayMongo-verified; cash: Tourism Office staff
 * confirm physical receipt through a numbered receipt with per-penalty
 * allocations — or earlier by an explicit, approved ADVANCE.
 *
 * rider_compensation_entries is APPEND-ONLY (database triggers refuse UPDATE
 * and DELETE), like rider_earning_entries. Buckets: earned (+/−), reserved,
 * paid (D2 payouts), office (advance recovered / write-off records that do
 * not change the rider's balance). idempotency_key is UNIQUE.
 *
 * rider_earnings, rider_earning_entries, payouts and the COD cash fund are
 * not touched.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ride_cancellation_penalties', function (Blueprint $table) {
            $table->decimal('received_amount', 10, 2)->default(0)->after('collection_payment_id');
            $table->timestamp('received_at')->nullable()->after('received_amount');      // full amount received
            $table->foreignId('received_by')->nullable()->after('received_at')->constrained('users')->nullOnDelete();
            $table->timestamp('refunded_at')->nullable()->after('received_by');
            $table->string('refund_reference', 120)->nullable()->after('refunded_at');
        });

        Schema::create('penalty_cash_receipts', function (Blueprint $table) {
            $table->id();
            $table->string('receipt_number', 60)->unique();
            $table->foreignId('collecting_rider_id')->constrained('users');
            $table->decimal('received_amount', 10, 2);
            $table->foreignId('received_by')->constrained('users');
            $table->timestamp('received_at')->useCurrent();
            $table->string('note', 500)->nullable();
            $table->timestamps();
        });

        Schema::create('penalty_cash_receipt_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('receipt_id')->constrained('penalty_cash_receipts')->cascadeOnDelete();
            $table->foreignId('penalty_id')->constrained('ride_cancellation_penalties');
            $table->decimal('amount', 10, 2);
            $table->timestamps();
            $table->unique(['receipt_id', 'penalty_id']);
        });

        Schema::create('rider_cancellation_compensations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('penalty_id')->unique()->constrained('ride_cancellation_penalties');
            $table->foreignId('rider_id')->constrained('users');                 // the ORIGINAL accepting rider
            $table->foreignId('cancelled_order_id')->constrained('orders');
            $table->decimal('amount', 10, 2);
            $table->string('funding', 20);                                        // collection | advance
            $table->string('status', 20);                                         // payable | held | reserved | paid | voided | written_off
            $table->timestamp('earned_at')->useCurrent();
            $table->string('advance_reason', 500)->nullable();
            $table->string('advance_reference', 120)->nullable();
            $table->foreignId('advanced_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('advance_approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('recovered_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->timestamp('written_off_at')->nullable();
            $table->string('resolution_reason', 500)->nullable();
            $table->timestamps();
            $table->index(['rider_id', 'status']);
        });

        Schema::create('rider_compensation_entries', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('compensation_id')->index();             // no FKs: history survives the source rows
            $table->unsignedBigInteger('rider_id')->index();
            $table->unsignedBigInteger('penalty_id')->nullable();
            $table->unsignedBigInteger('payout_id')->nullable();
            $table->string('entry_type', 32);
            $table->string('bucket', 16);                                         // earned | reserved | paid | office
            $table->decimal('amount', 12, 2);                                     // signed
            $table->string('reason', 500)->nullable();
            $table->json('details')->nullable();
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->string('idempotency_key', 191)->unique();
            $table->timestamp('created_at')->nullable();
            $table->index(['rider_id', 'bucket']);
        });

        $driver = DB::getDriverName();
        foreach (['UPDATE', 'DELETE'] as $op) {
            $name = 'rider_compensation_entries_no_'.strtolower($op);
            if ($driver === 'sqlite') {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON rider_compensation_entries BEGIN SELECT RAISE(ABORT, 'rider_compensation_entries is append-only'); END;");
            } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON rider_compensation_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rider_compensation_entries is append-only'");
            }
        }
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS rider_compensation_entries_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS rider_compensation_entries_no_delete');
        Schema::dropIfExists('rider_compensation_entries');
        Schema::dropIfExists('rider_cancellation_compensations');
        Schema::dropIfExists('penalty_cash_receipt_allocations');
        Schema::dropIfExists('penalty_cash_receipts');
        Schema::table('ride_cancellation_penalties', function (Blueprint $table) {
            $table->dropConstrainedForeignId('received_by');
            $table->dropColumn(['received_amount', 'received_at', 'refunded_at', 'refund_reference']);
        });
    }
};
