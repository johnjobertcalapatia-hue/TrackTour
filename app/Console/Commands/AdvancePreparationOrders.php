<?php

namespace App\Console\Commands;

use App\Services\PreparationStartService;
use Illuminate\Console\Command;

/**
 * Minute scheduler for the automatic preparation lifecycle.
 *
 *   1. Waiting orders that are already preparation-eligible get promoted to
 *      'preparing' (rider accepted, or pickup orders that need no rider).
 *      This is the self-healing backstop for the rider-acceptance hook.
 *   2. Countdown timers that reached 00:00 are flipped 'preparing' → 'ready'.
 *
 * This replaces the removed AutoRejectWaitingOrder command: an order that
 * never finds a rider now waits indefinitely ("never auto-cancel") instead of
 * being auto-rejected after 10 minutes.
 */
class AdvancePreparationOrders extends Command
{
    protected $signature = 'orders:advance-preparation';

    protected $description = 'Start preparation for rider-accepted/pickup orders and auto-complete due preparation timers (PREPARING → READY at 00:00)';

    public function handle(PreparationStartService $preparation): int
    {
        $started = $preparation->startEligibleWaitingOrders();
        $completed = $preparation->completeDuePreparations();

        $this->info("Started preparation: {$started}. Auto-completed timers: {$completed}.");

        return self::SUCCESS;
    }
}
