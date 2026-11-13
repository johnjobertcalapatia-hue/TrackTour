<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Secure transaction architecture, Stage 5 — shared rider financial ledger.
 *
 * rider_earning_entries is APPEND-ONLY (database triggers refuse UPDATE and
 * DELETE). Every peso of a rider's earning is an entry; corrections are new
 * compensating entries, never edits. Signed amounts per bucket:
 *
 *   earned    earning_posted (+commission), tip_posted (+tip), adjustment (±)
 *   reserved  cashout_reserved (+), reservation_released (−)
 *   paid      payout_completed (+)
 *
 * available(earning) = earned − (reserved − released − completed) − completed.
 * idempotency_key is UNIQUE: the same posting / reservation can never be
 * written twice. rider_earnings rows remain (write-once snapshot) and the
 * pivot rider_payout_rider_earning remains the "one live cashout per
 * earning" lock; this table is the permanent history behind both.
 * Also: refunds.idempotency_key (Stage 5 step 0a, "requested" refunds).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_earning_entries', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('rider_id')->index();     // no FKs: history survives the source rows
            $table->unsignedBigInteger('rider_earning_id')->nullable()->index();
            $table->unsignedBigInteger('order_id')->nullable()->index();
            $table->unsignedBigInteger('delivery_id')->nullable();
            $table->unsignedBigInteger('rider_payout_id')->nullable()->index();
            $table->string('entry_type', 32);
            $table->string('bucket', 16);                         // earned | reserved | paid
            $table->decimal('amount', 12, 2);                     // signed
            $table->string('service', 8)->nullable();             // food | ride
            $table->string('channel', 8)->nullable();             // online | cod
            $table->unsignedBigInteger('reverses_entry_id')->nullable();
            $table->string('reason', 500)->nullable();
            $table->json('details')->nullable();
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->string('actor_role', 64);
            $table->unsignedBigInteger('approved_by')->nullable(); // second staff member (two-person adjustments)
            $table->string('idempotency_key', 191)->unique();
            $table->timestamp('created_at')->nullable();
            $table->index(['rider_id', 'bucket']);
        });

        Schema::table('refunds', function (Blueprint $table) {
            $table->string('idempotency_key', 64)->nullable()->unique()->after('provider_refund_id');
        });

        $driver = DB::getDriverName();
        foreach (['UPDATE', 'DELETE'] as $op) {
            $name = 'rider_earning_entries_no_'.strtolower($op);
            if ($driver === 'sqlite') {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON rider_earning_entries BEGIN SELECT RAISE(ABORT, 'rider_earning_entries is append-only'); END;");
            } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
                DB::unprepared("CREATE TRIGGER {$name} BEFORE {$op} ON rider_earning_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rider_earning_entries is append-only'");
            }
        }
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS rider_earning_entries_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS rider_earning_entries_no_delete');
        Schema::table('refunds', fn (Blueprint $table) => $table->dropColumn('idempotency_key'));
        Schema::dropIfExists('rider_earning_entries');
    }
};
