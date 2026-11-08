<?php

namespace App\Exceptions;

use DomainException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Thrown when a COD order's food would become READY before the restaurant has
 * confirmed it received the rider's payment (rider trip flow, Stage B).
 * Rendered as a 422 everywhere, so every path — owner, kitchen, staff, item
 * or order level, present or future — refuses the same way.
 */
class CodPaymentPendingException extends DomainException
{
    /** @param array<int, int> $businessIds restaurants still waiting for payment */
    public function __construct(public readonly array $businessIds = [])
    {
        parent::__construct('Waiting for the rider\'s payment. Confirm "Payment received" before marking this food ready.');
    }

    public function render(Request $request): Response
    {
        if (! $request->expectsJson()) {
            return back()->withErrors(['status' => $this->getMessage()]);
        }

        return response()->json([
            'success' => false,
            'message' => $this->getMessage(),
            'errors' => ['status' => [$this->getMessage()]],
            'unpaid_business_ids' => $this->businessIds,
        ], 422);
    }
}
