<?php

namespace App\Exceptions;

use RuntimeException;

/** A destination change that cannot be previewed or confirmed (stores nothing). */
class RideDestinationChangeException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
