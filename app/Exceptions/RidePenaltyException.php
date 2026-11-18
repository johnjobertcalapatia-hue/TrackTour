<?php

namespace App\Exceptions;

use RuntimeException;

/** A cancellation-penalty action that cannot be done (changes nothing). */
class RidePenaltyException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
