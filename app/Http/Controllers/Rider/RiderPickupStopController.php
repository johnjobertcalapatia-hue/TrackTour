<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\OrderItem;
use App\Services\NearestRiderService;
use App\Services\PickupSequenceService;
use App\Services\PurchasingCashService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use InvalidArgumentException;

/**
 * Per-restaurant pickup sequence for a delivery (COD and prepaid alike).
 *
 * GET  /rider/deliveries/{delivery}/pickup-stops
 *        Unified view of the pickup route: every fulfilling restaurant in
 *        drive order, each carrying its sequence, coordinates, readiness
 *        (is_ready / ready_label), gate state (can_confirm / reason /
 *        distance_meters), the order items to pick up there, and — for COD —
 *        the purchasing-cash fields so the cash panel keeps working unchanged.
 *
 * POST /rider/deliveries/{delivery}/pickup-stops/{business}/confirm
 *        The single canonical "Confirm Item Pickup" action. The server
 *        enforces the gate (current stop + within pickup radius + restaurant
 *        READY) and, for COD, collects the matching cod_purchases row in the
 *        same transaction.
 */
class RiderPickupStopController extends Controller
{
    public function __construct(
        private PickupSequenceService $sequence,
        private PurchasingCashService $purchasingCash,
        private NearestRiderService $dispatchService,
    ) {}

    public function index(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()?->id) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        $delivery->load('codPurchases.business');
        $stops = $this->sequence->stops($delivery);

        $itemsByBusiness = OrderItem::query()
            ->where('order_id', $delivery->order_id)
            ->whereIn('business_id', $stops->pluck('business_id'))
            ->get()
            ->groupBy('business_id');

        $payloadStops = $stops->map(function (DeliveryPickupStop $stop) use ($delivery, $itemsByBusiness) {
            $payload = $this->sequence->stopPayload($delivery, $stop);
            $payload['items'] = $this->orderItemsPayload($itemsByBusiness->get((int) $stop->business_id, collect()));
            $payload['cod_purchase'] = $this->codPurchasePayload(
                $delivery->codPurchases->firstWhere('business_id', (int) $stop->business_id)
            );

            return $payload;
        })->values();

        $originEntry = $stops->last();

        return $this->successResponse([
            'delivery_id' => $delivery->id,
            'is_cod' => $this->dispatchService->isCodDelivery($delivery),
            'purchasing_cash' => $delivery->purchasing_cash !== null ? (float) $delivery->purchasing_cash : null,
            'purchasing_cash_issued_at' => $delivery->purchasing_cash_issued_at,
            'purchasing_cash_received_at' => $delivery->purchasing_cash_received_at,
            'fully_collected' => $this->sequence->allConfirmed($delivery),
            'pickup_origin' => $originEntry ? [
                'business_id' => (int) $originEntry->business_id,
                'business_name' => $originEntry->business?->business_name ?? $originEntry->business?->name,
                'latitude' => $originEntry->pickup_latitude !== null ? (float) $originEntry->pickup_latitude : null,
                'longitude' => $originEntry->pickup_longitude !== null ? (float) $originEntry->pickup_longitude : null,
                'address' => $originEntry->pickup_address,
            ] : null,
            'dropoff' => [
                'latitude' => $delivery->delivery_latitude !== null ? (float) $delivery->delivery_latitude : null,
                'longitude' => $delivery->delivery_longitude !== null ? (float) $delivery->delivery_longitude : null,
                'address' => $delivery->delivery_address,
            ],
            'stops' => $payloadStops,
        ]);
    }

    public function confirm(Request $request, Delivery $delivery, int $business): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()?->id) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        try {
            $result = $this->sequence->confirmStop($delivery, $business, (int) $request->user()?->id);
        } catch (InvalidArgumentException $exception) {
            return $this->errorResponse($exception->getMessage(), 422);
        }

        return $this->successResponse($result, 'Order items received. Pickup confirmed.');
    }

    /**
     * @return array<string, mixed>|null
     */
    private function codPurchasePayload(?object $purchase): ?array
    {
        if (! $purchase) {
            return null;
        }

        return [
            'id' => $purchase->id,
            'purchase_number' => $purchase->purchase_number,
            'purchase_amount' => (float) $purchase->purchase_amount,
            'status' => $purchase->status,
            'purchased_at' => $purchase->purchased_at,
            'collected_at' => $purchase->collected_at,
        ];
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