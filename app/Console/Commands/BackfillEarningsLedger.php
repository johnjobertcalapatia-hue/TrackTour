<?php

namespace App\Console\Commands;

use App\Models\RiderEarning;
use App\Models\RiderEarningEntry;
use App\Models\RiderPayout;
use App\Services\RiderEarningLedger;
use Illuminate\Console\Command;

/**
 * Stage 5: post earnings recorded before the ledger existed, and the
 * reservations / payouts of existing cashouts. Idempotent (every entry has a
 * unique idempotency key): running it again changes nothing. Back up the
 * database first.
 */
class BackfillEarningsLedger extends Command
{
    protected $signature = 'earnings:ledger-backfill {--dry-run}';

    protected $description = 'Post existing rider earnings and cashouts to the append-only earnings ledger';

    public function handle(RiderEarningLedger $ledger): int
    {
        $unposted = RiderEarning::query()
            ->whereNotIn('id', RiderEarningEntry::query()->where('entry_type', RiderEarningEntry::EARNING_POSTED)->whereNotNull('rider_earning_id')->select('rider_earning_id'))
            ->orderBy('id')
            ->get();
        $payouts = RiderPayout::query()->whereIn('status', [
            RiderPayout::STATUS_PENDING, RiderPayout::STATUS_UNDER_REVIEW, RiderPayout::STATUS_APPROVED, RiderPayout::STATUS_PAID,
        ])->with('earnings')->orderBy('id')->get();

        if ($this->option('dry-run')) {
            $this->info("{$unposted->count()} earnings and {$payouts->count()} cashouts would be posted.");

            return self::SUCCESS;
        }

        foreach ($unposted as $earning) {
            $ledger->postEarning($earning, true);
        }
        foreach ($payouts as $payout) {
            $ledger->reserve($payout, $payout->earnings);
            if ($payout->status === RiderPayout::STATUS_PAID) {
                $ledger->complete($payout, $payout->earnings);
            }
        }

        $this->info("Posted {$unposted->count()} earnings; recorded {$payouts->count()} cashouts.");

        return self::SUCCESS;
    }
}
