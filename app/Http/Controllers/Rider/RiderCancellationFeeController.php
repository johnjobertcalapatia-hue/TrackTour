<?php

namespace App\Http\Controllers\Rider;

use App\Exceptions\RidePenaltyException;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Services\RideCancellationPenaltyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Stage C (2026-11-18): at the drop-off the driver collects the passenger's
 * owed ₱50 cancellation fee (from an earlier ride, owed to another driver)
 * in cash and confirms it here, separately from the fare.
 */
class RiderCancellationFeeController extends Controller
{
    /** POST /rider/deliveries/{delivery}/cancellation-fee/collect {penalty_id} */
    public function collect(Request $request, Delivery $delivery, RideCancellationPenaltyService $penalties): JsonResponse
    {
        $data = $request->validate(['penalty_id' => ['required', 'integer']]);
        try {
            $penalty = $penalties->collectCash($delivery, $request->user(), (int) $data['penalty_id']);
        } catch (RidePenaltyException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse([
            'penalty_id' => $penalty->id,
            'status' => $penalty->status,
            'amount' => (float) $penalty->penalty_amount,
            'collected_at' => $penalty->collected_at?->toIso8601String(),
        ], 'Cancellation fee recorded. Hand it in with your cash remittance.');
    }
}
