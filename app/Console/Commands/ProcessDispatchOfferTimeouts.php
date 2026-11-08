<?php

namespace App\Console\Commands;

use App\Services\NearestRiderService;
use App\Services\SequentialDispatchService;
use Illuminate\Console\Command;

/**
 * Server-owned offer timers (docs/dispatch-escalation-plan.md, Stage 2).
 *
 * Expires every pending offer whose deadline passed (targeted offers: their
 * own expires_at, 60 s) and advances the delivery to the next targeted rider
 * or the manual board. Runs every 5 seconds from the scheduler; the same
 * NearestRiderService::processTimeouts() also runs on rider polls as a
 * safety net. Each expiry is row-locked, so overlapping runs are harmless.
 */
class ProcessDispatchOfferTimeouts extends Command
{
    protected $signature = 'dispatch:process-offer-timeouts';

    protected $description = 'Expire overdue rider offers and advance sequential dispatch';

    public function handle(NearestRiderService $dispatch, SequentialDispatchService $sequential): int
    {
        $dispatch->processTimeouts();
        // Dispatch-cycle deadline for sequential (targeted/manual) deliveries.
        $sequential->expireOverdue();

        return self::SUCCESS;
    }
}
