<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Console\Command;

/**
 * Open a ledger (a "ledger_opened" baseline event) for delivery and ride
 * orders that existed before the ledger. Such histories are marked legacy and
 * the verifier reports them as incomplete (FLAG), never as whole.
 */
class BackfillTransactionLedger extends Command
{
    protected $signature = 'integrity:backfill {--dry-run}';

    protected $description = 'Open transaction ledgers for existing delivery and ride orders (marked legacy)';

    public function handle(TransactionLedger $ledger): int
    {
        $query = Order::withTrashed()->whereIn('order_type', ['delivery', 'transport'])
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('transaction_blueprints')->whereColumn('transaction_blueprints.order_id', 'orders.id'));
        $count = (clone $query)->count();
        if ($this->option('dry-run')) {
            $this->info("{$count} orders would get a legacy ledger.");

            return self::SUCCESS;
        }
        $query->orderBy('id')->chunkById(200, function ($orders) use ($ledger) {
            foreach ($orders as $order) {
                $ledger->blueprintFor($order);
            }
        });
        $this->info("Opened {$count} legacy ledgers.");

        return self::SUCCESS;
    }
}
