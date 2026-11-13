<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Stage 4: the fare the tourist confirmed no longer matches the server fare
 * (Tourism Office rates or the route changed between quote and booking). The
 * booking is refused so the tourist can review the new fare (HTTP 409).
 */
class RideFareChangedException extends RuntimeException
{
    public function __construct(public readonly float $quotedFare, public readonly float $currentFare)
    {
        parent::__construct(sprintf('The fare changed to ₱%s. Please review it and book again.', number_format($currentFare, 2)));
    }
}
