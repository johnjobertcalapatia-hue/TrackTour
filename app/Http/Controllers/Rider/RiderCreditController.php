<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Models\RiderTopUp;
use App\Models\User;
use App\Services\RiderCreditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RiderCreditController extends Controller
{
    public function __construct(
        private RiderCreditService $creditService
    ) {}

    /**
     * Get rider's credit balance with all details.
     */
    public function balance(Request $request): JsonResponse
    {
        $riderId = $request->user()->id;
        $balance = $this->creditService->getBalance($riderId);

        return response()->json([
            'success' => true,
            'data' => $balance,
        ]);
    }

    /**
     * Get rider's credit transaction history.
     */
    public function transactions(Request $request): JsonResponse
    {
        $riderId = $request->user()->id;
        $transactions = $this->creditService->getTransactions($riderId);

        return response()->json([
            'success' => true,
            'data' => $transactions,
        ]);
    }

    /**
     * Initiate a credit top-up via PayMongo GCash.
     */
    public function topUp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'amount' => 'required|numeric|min:100|max:50000',
        ]);

        $rider = $request->user();
        $amount = (float) $validated['amount'];

        try {
            $result = $this->creditService->initiateTopUp($rider, $amount);

            return response()->json([
                'success' => true,
                'data' => $result,
            ]);
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);
        } catch (\RuntimeException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Payment gateway error. Please try again.',
            ], 500);
        }
    }

    /**
     * Confirm top-up after PayMongo payment success.
     * Public endpoint — the rider is resolved from the top-up reference so the
     * PayMongo return redirect works even when the payment anchored on a
     * different origin (e.g. ngrok vs localhost dev).
     */
    public function confirmTopUp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'reference' => 'required|string',
            'payment_id' => 'required|string',
        ]);

        $success = $this->creditService->confirmTopUp(
            $validated['reference'],
            $validated['payment_id']
        );

        if (!$success) {
            return response()->json([
                'success' => false,
                'message' => 'Transaction not found or already processed.',
            ], 404);
        }

        $riderId = RiderTopUp::where('payment_reference', $validated['reference'])->value('rider_id');
        $balance = $riderId ? $this->creditService->getBalance($riderId) : null;

        return response()->json([
            'success' => true,
            'message' => 'Credits added successfully.',
            'data' => $balance,
        ]);
    }

    /**
     * Cancel a pending top-up after the rider abandons the PayMongo checkout.
     * Public endpoint for the same reason as confirmTopUp.
     */
    public function cancelTopUp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'reference' => 'required|string',
        ]);

        $success = $this->creditService->cancelTopUp($validated['reference']);

        return response()->json([
            'success' => $success,
            'message' => $success ? 'Top-up cancelled.' : 'Transaction not found or already processed.',
        ], $success ? 200 : 404);
    }

    /**
     * Check if rider has sufficient credits for COD.
     */
    public function checkSufficiency(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'amount' => 'required|numeric|min:0',
        ]);

        $riderId = $request->user()->id;
        $hasSufficient = $this->creditService->hasSufficientCredits(
            $riderId,
            (float) $validated['amount']
        );

        $balance = $this->creditService->getBalance($riderId);

        return response()->json([
            'success' => true,
            'data' => [
                'has_sufficient' => $hasSufficient,
                'required' => (float) $validated['amount'],
                'usable_credits' => $balance['usable_credits'],
                'is_cod_eligible' => $balance['is_cod_eligible'],
            ],
        ]);
    }

    /**
     * Check COD eligibility.
     */
    public function checkCodEligibility(Request $request): JsonResponse
    {
        $riderId = $request->user()->id;
        $isEligible = $this->creditService->isCodEligible($riderId);
        $balance = $this->creditService->getBalance($riderId);

        return response()->json([
            'success' => true,
            'data' => [
                'is_cod_eligible' => $isEligible,
                'usable_credits' => $balance['usable_credits'],
                'minimum_reserve' => $balance['minimum_reserve'],
                'message' => $isEligible
                    ? 'You are eligible for COD deliveries.'
                    : 'Your credits have reached the ₱200 protected reserve. Top up to accept COD deliveries again.',
            ],
        ]);
    }
}
