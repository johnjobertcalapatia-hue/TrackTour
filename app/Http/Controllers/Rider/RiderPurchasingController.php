<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\OrderItem;
use App\Services\NearestRiderService;
use App\Services\PurchasingCashService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use InvalidArgumentException;

class RiderPurchasingController extends Controller
{
    public function __construct(
        private PurchasingCashService $purchasingCash
    ) {}

    /**
     * GET /rider/deliveries/{delivery}/purchases
     * Per-restaurant purchasing stops for an assigned delivery, ordered by
     * ascending preparation time (the route the rider drives), each carrying
     * the order items to pick up there, plus the final-pickup origin for the
     * drop-off route and the drop-off point.
     */
    public function purchases(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) auth()->id()) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        $delivery->load('codPurchases.business');
        $stops = $this->purchasingCash->pickupStops($delivery);

        // Group item lines across all orders attached to the delivery. Group
        // deliveries have a group_checkout_id and a null delivery.order_id.
        $itemsByBusiness = [];
        foreach ($delivery->childOrders() as $order) {
            foreach ($order->items()->get() as $item) {
                $businessId = (int) ($item->business_id ?: $order->business_id);
                if ($businessId > 0) {
                    $itemsByBusiness[$businessId][] = $item;
                }
            }
        }

        return $this->successResponse([
            'delivery_id' => $delivery->id,
            'is_cod' => app(NearestRiderService::class)->isCodDelivery($delivery),
            'purchasing_cash' => $delivery->purchasing_cash !== null ? (float) $delivery->purchasing_cash : null,
            'purchasing_cash_issued_at' => $delivery->purchasing_cash_issued_at,
            'purchasing_cash_received_at' => $delivery->purchasing_cash_received_at,
            'fully_collected' => $this->purchasingCash->isFullyCollected($delivery),
            'pickup_origin' => $this->purchasingCash->pickupOrigin($delivery),
            'dropoff' => [
                'latitude' => $delivery->delivery_latitude !== null ? (float) $delivery->delivery_latitude : null,
                'longitude' => $delivery->delivery_longitude !== null ? (float) $delivery->delivery_longitude : null,
                'address' => $delivery->delivery_address,
            ],
            'purchases' => $stops->map(function (array $entry) use ($itemsByBusiness) {
                $payload = $this->purchasePayloadFromEntry($entry);
                $payload['items'] = $this->orderItemsPayload(
                    collect($itemsByBusiness[$payload['business_id']] ?? [])
                );

                return $payload;
            })->values(),
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

    private function purchasePayloadFromEntry(array $entry): array
    {
        $payload = $this->purchasePayload($entry['stop']);

        return array_merge($payload, [
            'sequence' => $entry['sequence'],
            'preparation_time' => $entry['preparation_time'],
            'pickup_lat' => $entry['pickup_latitude'],
            'pickup_lng' => $entry['pickup_longitude'],
            'pickup_address' => $entry['pickup_address'],
        ]);
    }

    /**
     * The order line items the rider must pick up at this stop (active
     * quantities only — rejected/cancelled lines are withheld).
     *
     * @return array<int, array<string, mixed>>
     */
    private function orderItemsPayload(Collection $items): array
    {
        return $items
            ->reject(fn (OrderItem $item) => in_array($item->status, ['cancelled', 'rejected'], true))
            ->values()
            ->map(fn (OrderItem $item) => [
                'id' => $item->id,
                'product_name' => $item->product_name,
                'quantity' => $item->activeQuantity(),
                'unit_price' => (float) $item->unit_price,
                'subtotal' => (float) $item->subtotal,
                'notes' => $item->notes,
                'status' => $item->status,
            ])
            ->all();
    }
}