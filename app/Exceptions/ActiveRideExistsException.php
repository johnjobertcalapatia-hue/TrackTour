<?php

namespace App\Exceptions;

use App\Models\Order;
use RuntimeException;

/**
 * A tourist has one ride-hailing ride at a time: a new booking is refused
 * while an earlier ride is still searching, on the way or in progress, until
 * it is completed or cancelled (HTTP 409, with the ride to go back to).
 */
class ActiveRideExistsException extends RuntimeException
{
    public function __construct(public readonly Order $ride)
    {
        parent::__construct('You already have a ride in progress. Finish or cancel it before booking another ride.');
    }
}
