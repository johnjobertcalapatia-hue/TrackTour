<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Controller;
use App\Events\OrderStatusChanged;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BusinessOwnerKitchenController extends Controller
{
    public function orders(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $businessId = $request->get('business_id');

        $query = Order::whereIn('business_id', $businessIds)
            ->whereIn('status', ['accepted', 'preparing', 'ready'])
            ->with(['items' => fn($q) => $q->select('id', 'order_id', 'product_name', 'quantity', 'notes', 'offering_id', 'status', 'preparation_started_at', 'ready_at')]);

        if ($businessId) {
            $query->where('business_id', $businessId);
        }

        $orders = $query->latest()->get();

        $grouped = [
            'preparing' => [],
            'ready' => [],
            'completed' => [],
        ];

        foreach ($orders as $order) {
            $elapsed = $order->updated_at ? now()->diffInMinutes($order->updated_at) : 0;
            $orderData = [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'customer_name' => $order->customer_name,
                'status' => $order->status,
                'order_type' => $order->order_type,
                'notes' => $order->notes,
                'elapsed_minutes' => $elapsed,
                'items' => $order->items->map(fn($i) => [
                    'id' => $i->id,
                    'product_name' => $i->product_name,
                    'quantity' => $i->quantity,
                    'notes' => $i->notes,
                    'status' => $i->status ?? 'pending',
                    'preparation_started_at' => $i->preparation_started_at,
                    'ready_at' => $i->ready_at,
                ]),
                'created_at' => $order->created_at,
                'updated_at' => $order->updated_at,
            ];

            if ($order->status === 'accepted') {
                $grouped['preparing'][] = $orderData;
            } elseif ($order->status === 'preparing') {
                $grouped['preparing'][] = $orderData;
            } elseif ($order->status === 'ready') {
                $grouped['ready'][] = $orderData;
            }
        }

        return $this->successResponse([
            'orders' => $grouped,
            'counts' => [
                'preparing' => count($grouped['preparing']),
                'ready' => count($grouped['ready']),
                'completed' => count($grouped['completed']),
            ],
        ]);
    }

    public function updateStatus(Request $request, Order $order): JsonResponse
    {
        if ($order->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'status' => ['required', 'in:preparing,ready'],
        ]);

        if ($order->order_type === 'delivery' && ! $order->hasAcceptedRider()) {
            return $this->errorResponse('This delivery order cannot be prepared until a rider has accepted the delivery.', 422);
        }

        $previousStatus = (string) $order->status;

        if ($validated['status'] === 'ready') {
            $order->items()
                ->whereNotIn('status', ['cancelled', 'rejected'])
                ->update([
                    'status' => 'ready',
                    'ready_at' => now(),
                ]);
        }

        $order->update(['status' => $validated['status']]);

        OrderStatusChanged::dispatch(
            $order->fresh(),
            $previousStatus,
            $validated['status'],
            $request->user(),
        );

        return $this->successResponse([
            'id' => $order->id,
            'status' => $order->status,
            'order_number' => $order->order_number,
        ], "Order moved to {$validated['status']}.");
    }

    public function updateItemStatus(Request $request, Order $order, \App\Models\OrderItem $item): JsonResponse
    {
        if ($order->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if ($item->order_id !== $order->id) {
            return $this->errorResponse('Item does not belong to this order.', 422);
        }

        $validated = $request->validate([
            'status' => ['required', 'in:preparing,ready'],
        ]);

        if ($order->order_type === 'delivery' && ! $order->hasAcceptedRider()) {
            return $this->errorResponse('This delivery order cannot be prepared until a rider has accepted the delivery.', 422);
        }

        $data = ['status' => $validated['status']];
        if ($validated['status'] === 'preparing' && ! $item->preparation_started_at) {
            $data['preparation_started_at'] = now();
        } elseif ($validated['status'] === 'ready') {
            $data['ready_at'] = now();
        }

        $item->update($data);
        $order->refreshStatusFromItems();

        return $this->successResponse([
            'order_id' => $order->id,
            'order_status' => $order->fresh()->status,
            'item' => [
                'id' => $item->id,
                'status' => $item->status,
                'product_name' => $item->product_name,
            ],
        ], "Item moved to {$validated['status']}.");
    }
}
