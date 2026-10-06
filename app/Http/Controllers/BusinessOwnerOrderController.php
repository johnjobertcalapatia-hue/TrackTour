<?php

namespace App\Http\Controllers;

use App\Http\Requests\BusinessOwner\UpdateOrderStatusRequest;
use App\Events\OrderStatusChanged;
use App\Http\Resources\OrderResource;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use App\Services\OrderService;
use App\Services\PreparationPredictionService;
use App\Services\PreparationStartService;
use App\Services\SmartDispatchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class BusinessOwnerOrderController extends Controller
{
    public function __construct(
        private OrderService $orderService
    ) {}

    public function index(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $filters = $request->only(['status', 'business_id', 'search', 'order_type', 'perPage']);
        $perPage = $filters['perPage'] ?? 20;

        $orders = Order::where(function ($query) use ($businessIds) {
                $query->whereIn('business_id', $businessIds)
                    ->orWhereHas('items', fn ($items) => $items->whereIn('business_id', $businessIds));
            })
            ->with('business', 'items.offering', 'delivery.rider.profile', 'groupOrder')
            ->when($filters['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($filters['business_id'] ?? null, fn ($q, $id) => $q->where('business_id', $id))
            ->latest()
            ->paginate($perPage);

        return $this->paginatedResponse(
            $orders->through(fn ($o) => OrderResource::make($o))
        );
    }

    public function show(Request $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $order->load('items.offering', 'business', 'delivery.rider.profile', 'groupOrder');

        return $this->successResponse(OrderResource::make($order));
    }

    public function updateStatus(UpdateOrderStatusRequest $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if (in_array($order->status, ['pending_payment', 'waiting_restaurant'])) {
            return $this->errorResponse('Cannot update status for unpaid or pending orders.', 422);
        }

        $validated = $request->validated();

        $previousStatus = (string) $order->status;

        if ($this->requiresAcceptedRider($order) && in_array($validated['status'], ['preparing', 'ready'], true)) {
            return $this->errorResponse('This delivery order cannot be prepared until a rider has accepted the delivery.', 422);
        }

        $orderData = [
            'status' => $validated['status'],
            'cancellation_reason' => $validated['cancellation_reason'] ?? $validated['reason'] ?? null,
            'cancelled_by' => in_array($validated['status'], ['cancelled', 'rejected']) ? $request->user()->id : null,
            'cancelled_at' => in_array($validated['status'], ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => $validated['status'] === 'cancelled' ? null : $order->completed_at,
        ];

        // The countdown must be armed whenever an order enters 'preparing' —
        // including the manual "Start Preparing" transition — or the Order
        // detail "Time Remaining" would render "—" (no predicted_ready_at).
        // The genuine rider-acceptance path arms it via PreparationStartService.
        if ($validated['status'] === 'preparing' && ! $order->predicted_ready_at) {
            $minutes = app(PreparationStartService::class)->effectivePreparationMinutes($order);
            $orderData = array_merge($orderData, [
                'preparation_started_at' => $order->preparation_started_at ?? now(),
                'predicted_ready_at' => now()->addMinutes($minutes),
                'predicted_preparation_seconds' => $minutes * 60,
                'preparation_time' => $minutes,
            ]);
        }

        $order->update($orderData);

        OrderStatusChanged::dispatch(
            $order->fresh(),
            $previousStatus,
            $validated['status'],
            $request->user(),
        );

        if ($validated['status'] === 'ready' && $order->delivery && $order->delivery->dispatch_status === 'scheduled') {
            try {
                app(SmartDispatchService::class)->dispatchNow($order, $order->delivery);
            } catch (\Exception $e) {
                Log::warning('Dispatch-on-ready failed via updateStatus', [
                    'order_id' => $order->id,
                    'delivery_id' => $order->delivery->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items.offering', 'delivery.rider.profile')),
            "Order {$validated['status']} successfully."
        );
    }

    public function assignRider(Request $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'rider_id' => ['required', 'integer', 'exists:users,id'],
        ]);

        $previousStatus = (string) $order->status;

        $rider = User::findOrFail($validated['rider_id']);

        // Standalone orders own their delivery; group sub-orders ride on the
        // group's single physical delivery (4.4).
        if ($order->group_order_id !== null) {
            $delivery = $order->activeDelivery()
                ?? app(\App\Services\SmartDispatchService::class)->createOrGetGroupDelivery($order->groupOrder);

            if (! $delivery) {
                return $this->errorResponse('Unable to create a delivery for this group order.', 409);
            }
        } else {
            $delivery = $order->delivery()->firstOrNew();
        }

        $delivery->rider_id = $rider->id;
        $delivery->status = 'assigned';
        $delivery->assigned_at = now();
        $delivery->delivery_address = $order->delivery_address;
        $delivery->save();

        $order->update(['status' => 'accepted']);

        OrderStatusChanged::dispatch(
            $order->fresh(),
            $previousStatus,
            'accepted',
            $request->user(),
        );

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items.offering', 'delivery.rider.profile')),
            'Rider assigned successfully.'
        );
    }

    public function deliveryTracking(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $deliveries = \App\Models\Delivery::whereIn('order_id', function ($q) use ($businessIds) {
            $q->select('id')->from('orders')->whereIn('business_id', $businessIds);
        })->with('order.business', 'rider.profile')
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse($deliveries, 'Delivery tracking retrieved.');
    }

    /**
     * POST /business-owner/orders/{order}/start-preparation
     * Manual recovery path: normally PreparationStartService starts this
     * automatically the moment a rider accepts (or immediately for pickup).
     */
    public function startPreparation(Request $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($this->requiresAcceptedRider($order)) {
            return $this->errorResponse('This delivery order cannot be prepared until a rider has accepted the delivery.', 422);
        }

        if ($order->status === 'ready') {
            return $this->errorResponse('Order has already been marked ready.', 422);
        }

        // Canonical transition (waiting → preparing + countdown). No-op when
        // the order already left waiting_restaurant (e.g. manually assigned).
        if (app(\App\Services\PreparationStartService::class)->startForOrder($order)) {
            $fresh = $order->fresh();

            return $this->successResponse(
                OrderResource::make($fresh->load('business', 'items.offering')),
                'Preparation started. Estimated ready: '.($fresh->predicted_ready_at?->format('g:i A') ?? '—'),
            );
        }

        if ($order->status !== 'preparing') {
            return $this->errorResponse('Order cannot start preparation in its current status.', 422);
        }

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items.offering')),
            'Preparation already started. Estimated ready: '.($order->predicted_ready_at?->format('g:i A') ?? '—'),
        );
    }

    /**
     * POST /business-owner/orders/{order}/mark-ready
     * Restaurant signals food is ready for pickup.
     */
    public function markReady(Request $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($this->requiresAcceptedRider($order)) {
            return $this->errorResponse('This delivery order cannot be marked ready until a rider has accepted the delivery.', 422);
        }

        if (! in_array($order->status, ['accepted', 'preparing'])) {
            return $this->errorResponse('Order is not in a preparable state.', 422);
        }

        $previousStatus = (string) $order->status;

        // Mark all active items as ready
        $order->items()
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->update([
                'status' => 'ready',
                'ready_at' => now(),
            ]);

        $order->update([
            'status' => 'ready',
            'food_ready_at' => now(),
        ]);

        OrderStatusChanged::dispatch(
            $order->fresh(),
            $previousStatus,
            'ready',
            $request->user(),
        );

        // If smart dispatch scheduled a future dispatch that was never picked up,
        // fire it now that the food is actually ready.
        if ($order->delivery && $order->delivery->dispatch_status === 'scheduled') {
            try {
                app(SmartDispatchService::class)->dispatchNow($order, $order->delivery);
            } catch (\Exception $e) {
                Log::warning('Dispatch-on-ready failed', [
                    'order_id' => $order->id,
                    'delivery_id' => $order->delivery->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Record actual preparation duration and update prediction logs
        try {
            $predictionService = app(PreparationPredictionService::class);
            $predictionService->recordActualPreparation($order->fresh());
        } catch (\Exception $e) {
            Log::warning('Failed to record preparation data', [
                'order_id' => $order->id,
                'error' => $e->getMessage(),
            ]);
        }

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items.offering', 'delivery.rider.profile')),
            'Food is ready for pickup.',
        );
    }

    /**
     * PATCH /business-owner/orders/{order}/items/{item}/status
     * Update preparation status for an individual food item.
     * Item statuses: pending, accepted, preparing, ready, cancelled, rejected.
     * Enforces the rule:
     * A restaurant sub-order cannot become READY_FOR_PICKUP until ALL active items are ready.
     */
    public function updateItemStatus(Request $request, Order $order, OrderItem $item): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($item->order_id !== $order->id) {
            return $this->errorResponse('Item does not belong to this order.', 422);
        }

        $validated = $request->validate([
            'status' => 'required|string|in:pending,accepted,preparing,ready,cancelled,rejected',
            'reason' => 'nullable|string|max:500',
        ]);

        if ($this->requiresAcceptedRider($order) && in_array($validated['status'], ['preparing', 'ready'], true)) {
            return $this->errorResponse('This delivery order cannot be prepared until a rider has accepted the delivery.', 422);
        }

        $status = $validated['status'];
        $data = ['status' => $status];

        if ($status === 'accepted' && ! $item->accepted_at) {
            $data['accepted_at'] = now();
        } elseif ($status === 'preparing') {
            if (! $item->accepted_at) {
                $data['accepted_at'] = now();
            }
            if (! $item->preparation_started_at) {
                $data['preparation_started_at'] = now();
            }
        } elseif ($status === 'ready') {
            if (! $item->accepted_at) {
                $data['accepted_at'] = now();
            }
            if (! $item->preparation_started_at) {
                $data['preparation_started_at'] = now();
            }
            $data['ready_at'] = now();
        } elseif (in_array($status, ['cancelled', 'rejected'], true)) {
            $data['cancelled_at'] = now();
            $data['cancelled_by'] = $request->user()->id;
            $data['cancelled_quantity'] = $item->quantity;
            $data['cancellation_reason'] = $validated['reason'] ?? 'Cancelled by restaurant';
            if ($status === 'rejected') {
                $data['rejection_reason'] = $validated['reason'] ?? 'Rejected by restaurant';
                $data['rejected_by'] = $request->user()->id;
            }
        }

        $item->update($data);

        // Sub-order status recalculation from all items
        $this->refreshOrderStatus($order);

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items.offering', 'delivery.rider.profile')),
            "Item {$item->product_name} status updated to {$status}."
        );
    }

    /**
     * Refresh order status based on item states.
     */
    private function refreshOrderStatus(Order $order): void
    {
        $order->refreshStatusFromItems();
    }

    /**
     * P11.2 rider-gate: delivery orders may only be accepted / prepared /
     * marked ready once a rider has accepted the delivery trip.
     */
    private function requiresAcceptedRider(Order $order): bool
    {
        return $order->order_type === 'delivery' && ! $order->hasAcceptedRider();
    }
}
