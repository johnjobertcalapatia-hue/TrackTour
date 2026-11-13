<?php

namespace App\Console\Commands;

use App\Models\ActivityLog;
use App\Models\Order;
use App\Services\AcceptedOrderPolicy;
use Illuminate\Console\Command;

/**
 * Late accepted orders (product-owner rule, 2026-11-11).
 *
 * Every order this command looks at already has an accepted rider (it was
 * assigned or accepted more than --minutes ago and is still undelivered).
 * Once a rider has accepted, the order must be fulfilled: it is NEVER
 * auto-cancelled or refunded here. The late order stays active and is
 * flagged ONCE for Tourism Office investigation (activity log + transaction
 * history escalation, reported by the integrity check).
 *
 * Previously this command cancelled and refunded these orders. Orders that
 * never got a rider keep the D5 rule (dispatch deadline: cancel + refund).
 */
class AutoCancelUndeliveredOrder extends Command
{
    protected $signature = 'orders:auto-cancel-undelivered
        {--minutes=60 : Minutes an accepted, paid order may remain undelivered before it is flagged}';

    protected $description = 'Flag accepted orders not delivered within the timeout for Tourism Office investigation (never cancels or refunds them)';

    private const ACTIVE = [
        'waiting',
        'assigned',
        'en_route_pickup',
        'arrived_pickup',
        'picked_up',
        'in_transit',
        'en_route_destination',
        'arrived_destination',
    ];

    public function handle(AcceptedOrderPolicy $policy): int
    {
        $minutes = (int) $this->option('minutes');
        $cutoff = now()->subMinutes($minutes);

        // Active delivery orders still on an active trip that were assigned (or
        // accepted) more than $minutes ago. Group children ride on the group's
        // single delivery; rides (order_type 'transport') are included.
        $orders = Order::whereIn('order_type', ['delivery', 'transport'])
            ->where('payment_status', 'paid')
            ->where(function ($q) {
                $q->whereHas('delivery', fn ($d) => $d->whereIn('status', self::ACTIVE))
                    ->orWhereHas('groupOrder.delivery', fn ($d) => $d->whereIn('status', self::ACTIVE));
            })
            ->where(function ($q) use ($cutoff) {
                $q->whereHas('delivery', fn ($d) => $d->whereNotNull('assigned_at')->where('assigned_at', '<=', $cutoff))
                    ->orWhereHas('groupOrder.delivery', fn ($d) => $d->whereNotNull('assigned_at')->where('assigned_at', '<=', $cutoff))
                    ->orWhere(fn ($o) => $o->whereNotNull('accepted_at')->where('accepted_at', '<=', $cutoff));
            })
            ->get();

        if ($orders->isEmpty()) {
            $this->info("No undelivered orders past {$minutes} minutes.");

            return self::SUCCESS;
        }

        $flagged = 0;
        $failed = 0;

        foreach ($orders as $order) {
            try {
                $alreadyFlagged = ActivityLog::where('action', 'escalation.late_after_acceptance')
                    ->where('model_type', Order::class)
                    ->where('model_id', $order->id)
                    ->exists();
                if ($alreadyFlagged) {
                    continue;
                }

                $delivery = $order->activeDelivery();
                $policy->escalate(
                    $order,
                    'late_after_acceptance',
                    "Order #{$order->order_number} was accepted by a rider but not delivered within {$minutes} minutes. It stays active for investigation.",
                    ['minutes' => $minutes, 'delivery_status' => (string) ($delivery?->status?->value ?? $delivery?->status)],
                );
                $this->info("Flagged late accepted order #{$order->order_number} for investigation (not cancelled).");
                $flagged++;
            } catch (\Exception $e) {
                $this->error("Failed to flag order #{$order->order_number}: {$e->getMessage()}");
                $failed++;
            }
        }

        $this->info("Done. Flagged: {$flagged}, failed: {$failed}.");

        return self::SUCCESS;
    }
}
