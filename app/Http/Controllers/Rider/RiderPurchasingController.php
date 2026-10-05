<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Services\NearestRiderService;
use App\Services\PurchasingCashService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

class RiderPurchasingController extends Controller
{
    public function __construct(
        private PurchasingCashService $purchasingCash
    ) {}

    /**
     * GET /rider/deliveries/{delivery}/purchases
     * Per-restaurant purchasing stops for an assigned delivery.
     */
    public function purchases(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) auth()->id()) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        $delivery->load('codPurchases.business');

        return $this->successResponse([
            'delivery_id' => $delivery->id,
            'is_cod' => app(NearestRiderService::class)->isCodDelivery($delivery),
            'purchasing_cash' => $delivery->purchasing_cash !== null ? (float) $delivery->purchasing_cash : null,
            'purchasing_cash_issued_at' => $delivery->purchasing_cash_issued_at,
            'purchasing_cash_received_at' => $delivery->purchasing_cash_received_at,
            'fully_collected' => $this->purchasingCash->isFullyCollected($delivery),
            'purchases' => $delivery->codPurchases->map(fn ($purchase) => [
                'id' => $purchase->id,
                'purchase_number' => $purchase->purchase_number,
                'business_id' => $purchase->business_id,
                'business_name' => $purchase->business?->business_name ?? $purchase->business?->name,
                'purchase_amount' => (float) $purchase->purchase_amount,
                'status' => $purchase->status,
                'purchased_at' => $purchase->purchased_at,
                'collected_at' => $purchase->collected_at,
            ])->values(),
        ]);
    }

    /**
     * POST /rider/deliveries/{delivery}/purchases/{purchase}/mark
     * body: { "status": "purchased" | "collected" }
     */
    public function mark(Request $request, Delivery $delivery, \App\Models\CodPurchase $purchase): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) auth()->id()) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        $validated = $request->validate([
            'status' => ['required', 'string', 'in:purchased,collected'],
        ]);

        try {
            $this->purchasingCash->markPurchase($delivery, $purchase->id, (int) auth()->id(), $validated['status']);
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse(
            $this->purchasePayload($purchase->fresh()),
            'Purchase stop marked as ' . $validated['status'] . '.'
        );
    }

    /**
     * POST /rider/deliveries/{delivery}/purchasing-cash/receive
     * Rider acknowledges receipt of the Tourism Office's purchasing cash.
     */
    public function confirmCashReceipt(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) auth()->id()) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        try {
            $this->purchasingCash->confirmCashReceipt($delivery, (int) auth()->id());
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse([
            'delivery_id' => $delivery->id,
            'purchasing_cash_received_at' => $delivery->fresh()->purchasing_cash_received_at,
        ], 'Purchasing cash receipt confirmed.');
    }

    private function purchasePayload(\App\Models\CodPurchase $purchase): array
    {
        $purchase->loadMissing('business');

        return [
            'id' => $purchase->id,
            'purchase_number' => $purchase->purchase_number,
            'business_id' => $purchase->business_id,
            'business_name' => $purchase->business?->business_name ?? $purchase->business?->name,
            'purchase_amount' => (float) $purchase->purchase_amount,
            'status' => $purchase->status,
            'purchased_at' => $purchase->purchased_at,
            'collected_at' => $purchase->collected_at,
        ];
    }
}