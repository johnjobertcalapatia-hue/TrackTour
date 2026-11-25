<?php

namespace App\Console\Commands;

use App\Services\ResortReservationService;
use Illuminate\Console\Command;

/**
 * Resort reservations Stage 8: release unpaid GCash holds after 30 minutes and
 * retry refunds PayMongo refused (at most 5 attempts each).
 */
class ProcessResortReservationPayments extends Command
{
    protected $signature = 'resorts:process-payments';

    protected $description = 'Expire unpaid GCash resort reservations and retry refused refunds';

    public function handle(ResortReservationService $reservations): int
    {
        $expired = $reservations->expireUnpaid();
        $retried = $reservations->retryRefunds();
        $this->info("Expired {$expired} unpaid reservation(s); retried {$retried} refund(s).");

        return self::SUCCESS;
    }
}
