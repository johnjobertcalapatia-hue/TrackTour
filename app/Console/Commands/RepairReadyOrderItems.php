<?php

namespace App\Console\Commands;

use App\Models\Order;
use Illuminate\Console\Command;

/**
 * Repairs orders saved 'ready' while their own restaurant's items stayed
 * 'preparing' / 'accepted' / 'pending' (before the Order model carried READY
 * to its items, 2026-11-12 — e.g. TT-04544). The rider's pickup gate reads the
 * items, so such an order can never be picked up.
 *
 * Reports by default; writes only with --apply. Uses the same
 * Order::markOwnItemsReady() the model now runs on every READY transition
 * (item hooks, COD guard and transaction ledger included). Another
 * restaurant's items in a multi-restaurant order are never touched.
 */
class RepairReadyOrderItems extends Command
{
    protected $signature = 'orders:repair-ready-items
        {--apply : Write the repair (default: report only)}
        {--order= : Only this order number (e.g. TT-04544)}';

    protected $description = 'Find (and with --apply, repair) READY orders whose own items are not ready';

    public function handle(): int
    {
        $orders = Order::query()
            ->where('status', 'ready')
            ->when($this->option('order'), fn ($q, $number) => $q->where('order_number', $number))
            ->whereHas('items', fn ($q) => $q->whereNotIn('status', ['cancelled', 'rejected', 'ready']))
            ->with('items')
            ->orderBy('id')
            ->get()
            ->map(function (Order $order) {
                $stale = $order->items
                    ->reject(fn ($i) => in_array($i->status, ['cancelled', 'rejected', 'ready'], true))
                    ->filter(fn ($i) => (int) ($i->business_id ?: $order->business_id) === (int) $order->business_id);

                return [$order, $stale];
            })
            ->filter(fn (array $pair) => $pair[1]->isNotEmpty())
            ->values();

        if ($orders->isEmpty()) {
            $this->info('No READY order has items that are not ready. Nothing to repair.');

            return self::SUCCESS;
        }

        $this->table(['Order', 'Order status', 'Items not ready'], $orders->map(fn (array $pair) => [
            $pair[0]->order_number,
            $pair[0]->status,
            $pair[1]->map(fn ($i) => "#{$i->id} {$i->product_name} ({$i->status})")->implode(', '),
        ])->all());

        if (! $this->option('apply')) {
            $this->warn('Report only. Re-run with --apply to mark these items ready.');

            return self::SUCCESS;
        }

        $repaired = 0;
        foreach ($orders as [$order]) {
            try {
                $order->markOwnItemsReady();
                $repaired++;
                $this->info("{$order->order_number}: items marked ready.");
            } catch (\Throwable $e) {
                // e.g. the COD paid-before-ready guard: leave it for review.
                $this->error("{$order->order_number}: not repaired — {$e->getMessage()}");
            }
        }
        $this->info("Repaired {$repaired} of {$orders->count()} order(s).");

        return self::SUCCESS;
    }
}
