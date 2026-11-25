<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Something asked for cannot be reserved (resort reservations Stage 6):
 * sold out, blocked by the owner, a closed day, an unknown time slot or a
 * date outside the booking window. `problems` lists each one for the UI.
 */
class ResortUnavailableException extends RuntimeException
{
    /** @param list<array{offering_id: int|null, offering: string|null, date: string|null, slot: string|null, reason: string, message: string, available?: int}> $problems */
    public function __construct(public readonly array $problems)
    {
        parent::__construct($problems[0]['message'] ?? 'Not available.');
    }
}
