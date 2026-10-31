<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Events\DeliveryPickupStopChanged;
use App\Events\DeliveryStatusChanged;
use App\Models\Delivery;
use App\Models\OrderItem;
use App\Models\CodPurchase;
use App\Services\NearestRiderService;
use App\Services\PurchasingCashService;
use App\Services\RiderCashFundService;
use App\Services\RiderDailyReconciliationService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use InvalidArgumentException;

class RiderPurchasingController extends Controller
{
    public function __construct(
        private PurchasingCashService $purchasingCash,
        private RiderCashFundService $cashFund
    ) {}

    public function dailyCashReceipt(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.now('Asia/Manila')->toDateString()],
        ]);

        try {
            $receipt = $this->cashFund->dailyReceipt(
                auth()->user(),
                $validated['date'] ?? now('Asia/Manila')->toDateString()
            );
        } catch (AuthorizationException $e) {
            return $this->forbiddenResponse($e->getMessage());
        }

        return $this->successResponse($receipt);
    }

    public function submitDailyCashReconciliation(Request $request, RiderDailyReconciliationService $reconciliations): JsonResponse
    {
        $validated = $request->validate([
            'date' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.now('Asia/Manila')->toDateString()],
            'cash_remitted' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'office_cash_returned' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'remittance_reference' => ['required', 'string', 'max:100'],
            'note' => ['nullable', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);

        $reconciliation = $reconciliations->submit(
            auth()->user(),
            $validated['date'],
            (float) $validated['cash_remitted'],
            (float) $validated['office_cash_returned'],
            $validated['remittance_reference'],
            $validated['note'] ?? null,
            $validated['idempotency_key']
        );

        return $this->successResponse($reconciliation, 'Daily cash submission recorded.');
    }

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
            'rider_cash_fund_id' => $delivery->rider_cash_fund_id,
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
            $result = $this->purchasingCash->markPurchase($delivery, $purchase->id, (int) auth()->id(), $validated['status']);
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        if ($result !== null) {
            $freshDelivery = $delivery->fresh()->load('order.business');
            $freshStop = \App\Models\DeliveryPickupStop::where('delivery_id', $delivery->id)
                ->where('business_id', $result['stop']['business_id'])
                ->firstOrFail();

            if ($result['stop_changed']) {
                DeliveryPickupStopChanged::dispatch($freshDelivery, $freshStop, 'pickup_confirmed');
            }
            if ($result['delivery_status_change'] !== null) {
                DeliveryStatusChanged::dispatch(
                    $freshDelivery,
                    $result['delivery_status_change']['old_status'],
                    $result['delivery_status_change']['new_status'],
                );
            }
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
            $this->purchasingCash->confirmCashReceipt($delivery, auth()->user());
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse([
            'delivery_id' => $delivery->id,
            'purchasing_cash_received_at' => $delivery->fresh()->purchasing_cash_received_at,
        ], 'Purchasing cash receipt confirmed.');
    }

    /**
     * POST /rider/deliveries/{delivery}/purchases/{purchase}/expense
     * Submit actual purchase funding and private receipt evidence for review.
     */
    public function submitPurchaseExpense(Request $request, Delivery $delivery, CodPurchase $purchase): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) auth()->id()) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        if ((int) $purchase->delivery_id !== (int) $delivery->id) {
            return $this->notFoundResponse('Purchase stop not found for this delivery.');
        }

        $validated = $request->validate([
            'actual_purchase_amount' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:9999999999.99'],
            'tourism_office_cash_used' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'rider_personal_contribution' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'receipt' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:10240'],
        ]);

        try {
            $expense = $this->purchasingCash->submitPurchaseExpense(
                $delivery,
                $purchase,
                auth()->user(),
                (float) $validated['actual_purchase_amount'],
                (float) $validated['tourism_office_cash_used'],
                (float) $validated['rider_personal_contribution'],
                $validated['receipt']
            );
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse([
            'id' => $expense->id,
            'revision' => $expense->revision,
            'actual_purchase_amount' => (float) $expense->actual_purchase_amount,
            'tourism_office_cash_used' => (float) $expense->tourism_office_cash_used,
            'rider_personal_contribution' => (float) $expense->rider_personal_contribution,
            'status' => $expense->status,
            'submitted_at' => $expense->submitted_at,
        ], 'Purchase expense submitted for Tourism Office verification.');
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
            'latest_expense' => $purchase->expenses()
                ->orderByDesc('revision')
                ->first([
                    'id',
                    'revision',
                    'actual_purchase_amount',
                    'tourism_office_cash_used',
                    'rider_personal_contribution',
                    'status',
                    'submitted_at',
                    'verified_at',
                    'rejection_reason',
                ]),
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