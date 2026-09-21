<?php

namespace App\Http\Controllers\Rider;

use App\Exceptions\PayoutConflictException;
use App\Http\Controllers\Controller;
use App\Models\RiderPayout;
use App\Services\RiderPayoutService;
use App\Traits\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RiderPayoutController extends Controller
{
    use ApiResponse;

    public function __construct(private readonly RiderPayoutService $payoutService) {}

    /**
     * Earnings currently available to the rider (earned + unlocked).
     */
    public function available(Request $request): JsonResponse
    {
        $available = $this->payoutService->getAvailableEarnings($request->user()->id);

        return $this->successResponse([
            'earnings' => $available['earnings'],
            'total' => $available['total'],
            'payable' => $available['payable'],
        ], 'Available payout earnings.');
    }

    /**
     * Rider's own payout history.
     */
    public function index(Request $request): JsonResponse
    {
        $payouts = RiderPayout::query()
            ->where('rider_id', $request->user()->id)
            ->with('earnings')
            ->orderByDesc('requested_at')
            ->paginate(15);

        return $this->paginatedResponse($payouts, 'Payout history.');
    }

    /**
     * Rider-initiated payout request for all currently-available earnings.
     */
    public function request(Request $request): JsonResponse
    {
        try {
            $payout = $this->payoutService->requestPayout($request->user());

            return $this->successResponse($payout, 'Payout request submitted.', 201);
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    /**
     * Rider views a single payout (owner-only).
     */
    public function show(Request $request, RiderPayout $payout): JsonResponse
    {
        if ((int) $payout->rider_id !== (int) $request->user()->id) {
            return $this->errorResponse('You do not have access to this payout.', 403);
        }

        return $this->successResponse($payout->load('earnings'), 'Payout detail.');
    }

    /**
     * Rider cancels a pending payout → earnings released.
     */
    public function cancel(Request $request, RiderPayout $payout): JsonResponse
    {
        if ((int) $payout->rider_id !== (int) $request->user()->id) {
            return $this->errorResponse('You do not have access to this payout.', 403);
        }

        try {
            $payout = $this->payoutService->cancel($payout);

            return $this->successResponse($payout, 'Payout cancelled; earnings released.');
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }
}
