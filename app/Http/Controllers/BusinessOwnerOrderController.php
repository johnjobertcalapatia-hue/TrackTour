<?php

namespace App\Http\Controllers;

use App\Http\Requests\BusinessOwner\UpdateOrderStatusRequest;
use App\Events\OrderStatusChanged;
use App\Http\Resources\OrderResource;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\OrderRefundService;
use App\Services\OrderService;
use App\Services\PaymongoService;
use App\Services\PreparationPredictionService;
use App\Services\SmartDispatchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
            ->with('business', 'items', 'delivery.rider.profile', 'groupOrder')
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

        $order->load('items', 'business', 'delivery.rider.profile', 'groupOrder');

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

        $order->update([
            'status' => $validated['status'],
            'cancellation_reason' => $validated['cancellation_reason'] ?? $validated['reason'] ?? null,
            'cancelled_by' => in_array($validated['status'], ['cancelled', 'rejected']) ? $request->user()->id : null,
            'cancelled_at' => in_array($validated['status'], ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => match ($validated['status']) {
                'completed' => $order->completed_at ?? now(),
                'cancelled' => null,
                default => $order->completed_at,
            },
        ]);

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
            OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
            "Order {$validated['status']} successfully."
        );
    }

    public function acceptOrder(Request $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($order->status !== 'waiting_restaurant') {
            return $this->errorResponse('This order is not waiting for acceptance.', 422);
        }

        // Accepting auto-starts preparation; a rider must already be assigned.
        if ($this->requiresAcceptedRider($order)) {
            return $this->errorResponse('This delivery order cannot be accepted until a rider has accepted the delivery.', 422);
        }

        // Accepting auto-starts preparation: the order goes straight to "preparing"
        // so the next available action is marking the food "ready".
        $predictedReadyAt = $order->predicted_preparation_seconds
            ? now()->addSeconds($order->predicted_preparation_seconds)
            : now()->addMinutes(15); // Fallback

        $order->items()
            ->where('status', 'pending')
            ->update([
                'status' => 'preparing',
                'accepted_at' => now(),
                'preparation_started_at' => now(),
            ]);

        $order->update([
            'status' => 'preparing',
            'accepted_at' => now(),
            'preparation_started_at' => now(),
            'predicted_ready_at' => $predictedReadyAt,
        ]);

        OrderStatusChanged::dispatch(
            $order->fresh(),
            'waiting_restaurant',
            'preparing',
            $request->user(),
        );

        $payment = Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('status', 'authorized')
            ->first();

        if ($payment) {
            $payment->update([
                'status' => 'paid',
                'paid_at' => now(),
            ]);
            $order->update(['payment_status' => 'paid']);
        }

        // Predict preparation time and schedule smart dispatch
        if ($order->order_type === 'delivery') {
            try {
                $predictionService = app(PreparationPredictionService::class);
                $predictionService->predictAndLog($order->fresh());

                $dispatchService = app(SmartDispatchService::class);
                $dispatchService->scheduleDispatch($order->fresh());
            } catch (\Exception $e) {
                Log::warning('Prediction/dispatch failed after acceptance', [
                    'order_id' => $order->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
            'Order accepted successfully.'
        );
    }

    public function rejectOrder(Request $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($order->status !== 'waiting_restaurant') {
            return $this->errorResponse('This order is not waiting for acceptance.', 422);
        }

        $validated = $request->validate([
            'reason' => 'nullable|string|max:500',
        ]);

        // Any ongoing delivery is cancelled via the canonical cancel path (a group
        // child cancels the shared trip only when no sibling still needs it).
        app(NearestRiderService::class)->cancelDeliveryForOrder($order);

        $order->update([
            'status' => 'rejected',
            'cancelled_by' => $request->user()->id,
            'cancellation_reason' => $validated['reason'] ?? null,
            'cancelled_at' => now(),
        ]);

        OrderStatusChanged::dispatch(
            $order->fresh(),
            'waiting_restaurant',
            'rejected',
            $request->user(),
        );

        // Group children are paid via one group-level payment; cancel the child's
        // delivery and record a local partial refund without touching the sibling orders.
        if ($order->group_order_id) {
            app(OrderRefundService::class)->refundPaidGroupChild(
                $order,
                $validated['reason'] ?? 'Order rejected by restaurant'
            );

            return $this->successResponse(
                OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
                'Order rejected. Payment has been refunded.'
            );
        }

        app(OrderRefundService::class)->refundPaidOrder(
            $order,
            $validated['reason'] ?? 'Order rejected by restaurant'
        );

        $fresh = $order->fresh()->load('business', 'items', 'delivery.rider.profile');
        $message = match ($fresh->refund_status) {
            'refunded' => 'Order rejected. Payment has been refunded.',
            'pending' => 'Order rejected. Your refund is being processed.',
            'failed' => 'Order rejected. The refund failed and will be retried automatically.',
            default => 'Order rejected.',
        };

        return $this->successResponse(
            OrderResource::make($fresh),
            $message
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
            OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
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
     * Restaurant signals they are starting to prepare food.
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

        $previousStatus = (string) $order->status;

        $order->items()
            ->whereIn('status', ['pending', 'accepted'])
            ->update([
                'status' => 'preparing',
                'preparation_started_at' => now(),
            ]);

        $order->update([
            'status' => 'preparing',
            'preparation_started_at' => now(),
        ]);

        OrderStatusChanged::dispatch(
            $order->fresh(),
            $previousStatus,
            'preparing',
            $request->user(),
        );

        // Calculate predicted ready time
        $predictedReadyAt = $order->predicted_preparation_seconds
            ? now()->addSeconds($order->predicted_preparation_seconds)
            : now()->addMinutes(15); // Fallback

        $order->update(['predicted_ready_at' => $predictedReadyAt]);

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items')),
            'Preparation started. Estimated ready: '.$predictedReadyAt->format('g:i A'),
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
            OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
            'Food is ready for pickup.',
        );
    }

    /**
     * POST /business-owner/orders/{order}/accept-all
     * Accept all pending items in the order and start preparation.
     */
    public function acceptAll(Request $request, Order $order): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($order->status !== 'waiting_restaurant') {
            return $this->errorResponse('This order is not waiting for acceptance.', 422);
        }

        if ($this->requiresAcceptedRider($order)) {
            return $this->errorResponse('This delivery order cannot be accepted until a rider has accepted the delivery.', 422);
        }

        DB::beginTransaction();

        try {
            // Accept all pending items
            $pendingItems = $order->items()->where('status', 'pending')->get();
            foreach ($pendingItems as $item) {
                $item->update([
                    'status' => 'accepted',
                    'accepted_at' => now(),
                ]);
            }

            // Accept payment if authorized
            $payment = Payment::where('payable_type', Order::class)
                ->where('payable_id', $order->id)
                ->where('status', 'authorized')
                ->first();

            if ($payment) {
                $payment->update(['status' => 'paid', 'paid_at' => now()]);
            }

            // Update order status to preparing
            $orderData = [
                'status' => 'preparing',
                'accepted_at' => now(),
                'preparation_started_at' => now(),
            ];

            // Only a captured online payment flips payment_status to 'paid' —
            // never a COD order (its cash is settled at delivery) and never an
            // order with no actual paid payment.
            if ($payment) {
                $orderData['payment_status'] = 'paid';
            }

            $order->update($orderData);

            // Start prediction and dispatch
            if ($order->order_type === 'delivery') {
                try {
                    $predictionService = app(PreparationPredictionService::class);
                    $predictionService->predictAndLog($order->fresh());

                    $dispatchService = app(SmartDispatchService::class);
                    $dispatchService->scheduleDispatch($order->fresh());
                } catch (\Exception $e) {
                    Log::warning('Prediction/dispatch failed after acceptAll', [
                        'order_id' => $order->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            DB::commit();

            OrderStatusChanged::dispatch(
                $order->fresh(),
                'waiting_restaurant',
                'preparing',
                $request->user(),
            );

            return $this->successResponse(
                OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
                'All items accepted. Preparation started.',
            );
        } catch (\Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * POST /business-owner/orders/{order}/items/{item}/accept
     * Accept a single item in the order.
     */
    public function acceptItem(Request $request, Order $order, OrderItem $item): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($item->order_id !== $order->id) {
            return $this->errorResponse('Item does not belong to this order.', 422);
        }

        if (! $item->load('business')->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this restaurant item.');
        }

        if (! $item->canAccept()) {
            return $this->errorResponse('This item cannot be accepted.', 422);
        }

        $item->update([
            'status' => 'accepted',
            'accepted_at' => now(),
        ]);

        // If this is the first item accepted, update order status
        if ($order->status === 'waiting_restaurant') {
            $payment = Payment::where('payable_type', Order::class)
                ->where('payable_id', $order->id)
                ->where('status', 'authorized')
                ->first();

            $orderData = [
                'status' => 'accepted',
                'accepted_at' => now(),
            ];

            // Only a captured online payment flips payment_status to 'paid' —
            // never a COD order (its cash is settled at delivery) and never an
            // order with no actual paid payment (matches acceptOrder).
            if ($payment) {
                $payment->update(['status' => 'paid', 'paid_at' => now()]);
                $orderData['payment_status'] = 'paid';
            }

            $order->update($orderData);

            OrderStatusChanged::dispatch(
                $order->fresh(),
                'waiting_restaurant',
                'accepted',
                $request->user(),
            );
        }

        // Check if all items are now accepted
        $this->refreshOrderStatus($order);

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
            'Item accepted.',
        );
    }

    /**
     * POST /business-owner/orders/{order}/items/{item}/reject
     * Reject a single item with reason and refund.
     */
    public function rejectItem(Request $request, Order $order, OrderItem $item): JsonResponse
    {
        if (! $order->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($item->order_id !== $order->id) {
            return $this->errorResponse('Item does not belong to this order.', 422);
        }

        if (! $item->load('business')->isManagedBy($request->user())) {
            return $this->forbiddenResponse('You do not own this restaurant item.');
        }

        if (! $item->canReject()) {
            return $this->errorResponse('This item cannot be rejected.', 422);
        }

        $validated = $request->validate([
            'reason' => 'required|string|max:500',
            'note' => 'nullable|string|max:500',
        ]);

        $refundAmount = (float) $item->subtotal;

        $item->update([
            'status' => 'rejected',
            'rejection_reason' => $validated['reason'],
            'rejected_by' => $request->user()->id,
        ]);

        // Process refund
        if ($refundAmount > 0) {
            $this->processItemRefund($order, $item, $refundAmount, $validated['reason'], $request->user()->id);
        }

        // Refresh order status
        $this->refreshOrderStatus($order);

        return $this->successResponse(
            OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
            'Item rejected. Refund of ₱'.number_format($refundAmount, 2).' will be processed.',
        );
    }

    /**
     * Process refund for a rejected item.
     */
    private function processItemRefund(Order $order, OrderItem $item, float $amount, string $reason, int $cancelledBy): void
    {
        // For group orders, use local refund only
        if ($order->group_order_id) {
            app(OrderRefundService::class)->refundCancelledItem(
                $item,
                $item->activeQuantity(),
                $reason,
                $cancelledBy,
                $order->user_id,
            );
            return;
        }

        // For standalone orders, process through PayMongo (provider-authoritative).
        // The P11.3 processor records the refunds ledger row (with the provider
        // refund id), tracks refund_status, and never marks anything refunded
        // unless the provider confirms the refund succeeded.
        $payment = Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('status', 'paid')
            ->first();

        if ($payment && $payment->provider_payment_id) {
            app(\App\Services\PaymentRefundProcessor::class)->initiateRefund(
                payment: $payment,
                amount: $amount,
                reason: $reason,
                forOrder: $order,
                orderItemId: $item->id,
                userId: $order->user_id,
                originalAmount: (float) $item->subtotal,
            );
        }
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
            OrderResource::make($order->fresh()->load('business', 'items', 'delivery.rider.profile')),
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
