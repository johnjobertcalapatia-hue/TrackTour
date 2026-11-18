<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A rider onboarding action that cannot happen in the current state (slot
 * full, step out of order, wrong municipality…). `status` is the HTTP code.
 */
class OnboardingException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
