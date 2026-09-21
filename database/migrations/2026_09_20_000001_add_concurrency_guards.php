<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P9 — dispatch & concurrency locks. Schema-level backstops for the invariants
 * that must hold even if an application lock path is missed:
 *
 *  1. ONE delivery per order       -> UNIQUE(deliveries.order_id)
 *  2. ONE dispatch offer per rider -> UNIQUE(booking_dispatch_logs.delivery_id, rider_id)
 *  3. ONE earning per rider+order  -> UNIQUE(rider_earnings.rider_id, order_id, status)
 *  4. ONE live payout per rider    -> UNIQUE(rider_payouts.active_payout_key)
 *      (nullable app-managed marker = rider_id ONLY while a payout is
 *       pending/approved; NULL for terminal rows so payout history is unlimited)
 *
 * Older duplicates (e.g. two delivery rows for one order pre-P9) are collapsed
 * keeping the earliest row before the index is added.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->collapseDuplicates('deliveries', 'order_id');
        Schema::table('deliveries', function (Blueprint $table) {
            $table->unique('order_id', 'deliveries_order_id_unique');
        });

        $this->collapseDuplicates('booking_dispatch_logs', ['delivery_id', 'rider_id']);
        Schema::table('booking_dispatch_logs', function (Blueprint $table) {
            $table->unique(['delivery_id', 'rider_id'], 'booking_dispatch_logs_delivery_rider_unique');
        });

        $this->collapseDuplicates('rider_earnings', ['rider_id', 'order_id', 'status']);
        Schema::table('rider_earnings', function (Blueprint $table) {
            $table->unique(['rider_id', 'order_id', 'status'], 'rider_earnings_rider_order_status_unique');
        });

        Schema::table('rider_payouts', function (Blueprint $table) {
            $table->unsignedBigInteger('active_payout_key')->nullable()->after('status');
            $table->unique('active_payout_key', 'rider_payouts_one_live_per_rider_unique');
        });

        // Existing live payouts inherit the marker so the backstop is complete.
        DB::table('rider_payouts')
            ->whereIn('status', ['pending', 'approved'])
            ->update(['active_payout_key' => DB::raw('rider_id')]);
    }

    public function down(): void
    {
        Schema::table('rider_payouts', function (Blueprint $table) {
            $table->dropUnique('rider_payouts_one_live_per_rider_unique');
            $table->dropColumn('active_payout_key');
        });

        Schema::table('rider_earnings', function (Blueprint $table) {
            $table->dropUnique('rider_earnings_rider_order_status_unique');
        });

        Schema::table('booking_dispatch_logs', function (Blueprint $table) {
            $table->dropUnique('booking_dispatch_logs_delivery_rider_unique');
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropUnique('deliveries_order_id_unique');
        });
    }

    /**
     * Keep the earliest row per the given key and delete the rest, so a UNIQUE
     * index can be added even when historical duplicates exist.
     */
    private function collapseDuplicates(string $table, array|string $groupBy): void
    {
        $columns = is_array($groupBy) ? $groupBy : [$groupBy];

        $keepIds = DB::table($table)
            ->select(DB::raw('MIN(id) as id'))
            ->groupBy($columns)
            ->pluck('id');

        if ($keepIds->isNotEmpty()) {
            DB::table($table)->whereNotIn('id', $keepIds)->delete();
        }
    }
};