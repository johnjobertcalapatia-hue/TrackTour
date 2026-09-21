<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\PayoutConflictException;
use App\Http\Controllers\Controller;
use App\Models\RiderPayout;
use App\Services\RiderPayoutService;
use App\Traits\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminPayoutController extends Controller
{
    use ApiResponse;

    public function __construct(private readonly RiderPayoutService $payoutService) {}

    /**
     * All rider payout requests, newest first.
     */
    public function index(Request $request): JsonResponse
    {
        $payouts = RiderPayout::query()
            ->with(['rider', 'earnings'])
            ->orderByDesc('requested_at')
            ->paginate(15);

        return $this->paginatedResponse($payouts, 'Payout requests.');
    }

    /**
     * Payout detail for admin review.
     */
    public function show(Request $request, RiderPayout $payout): JsonResponse
    {
        return $this->successResponse($payout->load(['rider', 'earnings']), 'Payout detail.');
    }

    /**
     * Admin approves a pending payout → earnings stay locked.
     */
    public function approve(Request $request, RiderPayout $payout): JsonResponse
    {
        $validated = $request->validate(['note' => 'nullable|string|max:500']);

        try {
            $payout = $this->payoutService->approve($payout, $request->user(), $validated['note'] ?? null);

            return $this->successResponse($payout, 'Payout approved.');
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    /**
     * Admin rejects a payout → earnings released back to available.
     */
    public function reject(Request $request, RiderPayout $payout): JsonResponse
    {
        $validated = $request->validate(['note' => 'nullable|string|max:500']);

        try {
            $payout = $this->payoutService->reject($payout, $request->user(), $validated['note'] ?? null);

            return $this->successResponse($payout, 'Payout rejected; earnings released.');
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    /**
     * Admin marks an approved payout as paid → earnings locked forever.
     */
    public function markPaid(Request $request, RiderPayout $payout): JsonResponse
    {
        $validated = $request->validate(['note' => 'nullable|string|max:500']);

        try {
            $payout = $this->payoutService->markPaid($payout, $request->user(), $validated['note'] ?? null);

            return $this->successResponse($payout, 'Payout marked as paid.');
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }
}