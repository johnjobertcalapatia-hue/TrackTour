<?php

namespace App\Exceptions;

use RuntimeException;

/** An SOS action that cannot be done (changes nothing). */
class SosException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
