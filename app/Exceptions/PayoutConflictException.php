<?php

namespace App\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * Thrown by RiderPayoutService on any state-machine violation: a rider
 * double-drawing an earning, an admin mutating a payout in the wrong state,
 * etc. Renders as a 409 Conflict in the API.
 */
class PayoutConflictException extends Exception
{
    public function __construct(
        string $message = 'The payout state does not permit that operation.',
        int $code = JsonResponse::HTTP_CONFLICT,
        ?Throwable $previous = null
    ) {
        parent::__construct($message, $code, $previous);
    }

    /**
     * Render as a 409 so controllers can keep using the ApiResponse trait
     * (which forwards to the handler) without swallowing the conflict.
     */
    public function render(Request $request): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $this->getMessage(),
        ], JsonResponse::HTTP_CONFLICT);
    }
}
