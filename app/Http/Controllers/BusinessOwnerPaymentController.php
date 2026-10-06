<?php

namespace App\Http\Controllers;

use App\Models\Business;
use App\Models\Order;
use App\Models\OrderSettlement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Payment tracking for a business owner. Read-only ledger of payments
 * received for the business's orders (cash vs online), including the
 * restaurant's own settlement amount when the order was settled.
 */
class BusinessOwnerPaymentController extends Controller
{
    public function show(Request $request, Business $business, Order $order): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $owned = $order->business_id === $business->id
            || $order->items()->where('business_id', $business->id)->exists();

        if (! $owned) {
            return $this->notFoundResponse('Payment record not found.');
        }

        $order->load('groupOrder', 'delivery.rider.profile');
        $settlement = OrderSettlement::where('order_id', $order->id)
            ->where('business_id', $business->id)
            ->first();

        $online = in_array($order->payment_method, ['gcash', 'card'], true);

        $transactionItems = $order->items
            ->filter(fn ($item) => $item->business_id === $business->id)
            ->values()
            ->map(fn ($item) => [
                'product_name' => $item->product_name,
                'quantity' => $item->quantity,
                'unit_price' => round((float) $item->unit_price, 2),
                'subtotal' => round((float) $item->subtotal, 2),
                'status' => $item->status,
            ]);

        $delivery = $order->delivery;

        return $this->successResponse([
            'id' => $order->id,
            'order_number' => $order->order_number,
            'group_reference' => $order->groupOrder?->reference_number,
            'customer_name' => $order->customer_name,
            'customer_email' => $order->customer_email,
            'customer_phone' => $order->customer_phone,
            'placed_at' => $order->created_at?->toISOString(),
            'order_type' => $order->order_type,
            'delivery_speed' => $order->delivery_speed,
            'order_status' => $order->status,
            'payment_method' => $order->payment_method,
            'payment_label' => $online ? 'Online' : 'Cash',
            'payment_status' => $order->payment_status,
            'items' => $transactionItems,
            'totals' => [
                'subtotal' => round((float) $order->subtotal, 2),
                'delivery_fee' => round((float) $order->delivery_fee, 2),
                'rider_tip' => round((float) $order->rider_tip, 2),
                'system_fee' => round((float) $order->system_fee, 2),
                'discount' => round((float) $order->discount, 2),
                'total' => round((float) $order->total, 2),
                'paid_amount' => $order->paid_amount !== null
                    ? round((float) $order->paid_amount, 2)
                    : round((float) $order->total, 2),
                'refunded_amount' => $order->refunded_amount !== null
                    ? round((float) $order->refunded_amount, 2)
                    : 0,
                'refund_status' => $order->refund_status,
            ],
            'delivery' => $delivery ? [
                'status' => $delivery->status?->value,
                'dispatch_status' => $delivery->dispatch_status,
                'address' => $order->delivery_address ?? $delivery->delivery_address,
                'rider_name' => $delivery->rider?->profile?->full_name,
                'delivered_at' => $delivery->delivered_at?->toISOString(),
            ] : null,
            'settlement' => $settlement ? [
                'settlement_number' => $settlement->settlement_number,
                'source' => $settlement->source,
                'payment_method' => $settlement->payment_method,
                'settlement_base' => round((float) $settlement->settlement_base, 2),
                'restaurant_amount' => round((float) $settlement->restaurant_amount, 2),
                'platform_amount' => round((float) $settlement->platform_amount, 2),
                'status' => $settlement->status,
                'settled_at' => $settlement->settled_at?->toISOString(),
            ] : null,
        ]);
    }
    public function index(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $perPage = max(1, min((int) ($request->query('perPage', 15)), 100));
        $method = $request->query('payment_method'); // cash | online | null
        $orderStatus = $request->query('order_status');
        $search = trim((string) $request->query('search', ''));

        $scoped = function ($query) use ($business) {
            $query->where(function ($q) use ($business) {
                $q->where('business_id', $business->id)
                    ->orWhereHas('items', fn ($items) => $items->where('business_id', $business->id));
            });
        };

        $orders = Order::where($scoped)
            ->when($method === 'cash', fn ($q) => $q->where('payment_method', 'cash'))
            ->when($method === 'online', fn ($q) => $q->whereIn('payment_method', ['gcash', 'card']))
            ->when($orderStatus !== null && $orderStatus !== '', fn ($q) => $q->where('status', $orderStatus))
            ->when($search !== '', fn ($q) => $q->where('order_number', 'like', "%{$search}%"))
            ->with('groupOrder')
            ->latest()
            ->paginate($perPage);

        $settlements = OrderSettlement::whereIn('order_id', collect($orders->items())->pluck('id'))
            ->where('business_id', $business->id)
            ->get()
            ->keyBy('order_id');

        $records = collect($orders->items())->map(function (Order $order) use ($settlements) {
            $settlement = $settlements->get($order->id);
            $online = in_array($order->payment_method, ['gcash', 'card'], true);

            return [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'group_reference' => $order->groupOrder?->reference_number,
                'customer_name' => $order->customer_name,
                'placed_at' => $order->created_at?->toISOString(),
                'payment_method' => $order->payment_method,
                'payment_label' => $online ? 'Online' : 'Cash',
                'payment_status' => $order->payment_status,
                'order_status' => $order->status,
                'total' => round((float) $order->total, 2),
                'paid_amount' => round((float) ($order->paid_amount ?? $order->total), 2),
                'settlement_number' => $settlement?->settlement_number,
                'settlement_amount' => $settlement?->restaurant_amount !== null
                    ? round((float) $settlement->restaurant_amount, 2)
                    : null,
                'settlement_status' => $settlement?->status,
                'settled_at' => $settlement?->settled_at?->toISOString(),
            ];
        })->values();

        $base = Order::where($scoped);
        $cashQuery = (clone $base)->where('payment_method', 'cash');
        $onlineQuery = (clone $base)->whereIn('payment_method', ['gcash', 'card']);

        $summary = [
            'orders_count' => (clone $base)->count(),
            'total_received' => round((float) (clone $base)->sum('total'), 2),
            'cash_count' => (clone $cashQuery)->count(),
            'cash_total' => round((float) (clone $cashQuery)->sum('total'), 2),
            'online_count' => (clone $onlineQuery)->count(),
            'online_total' => round((float) (clone $onlineQuery)->sum('total'), 2),
            'paid_count' => (clone $base)->where('payment_status', 'paid')->count(),
            'settled_amount' => round((float) OrderSettlement::where('business_id', $business->id)->sum('restaurant_amount'), 2),
        ];

        return $this->successResponse(['payments' => $records], 'Payment records retrieved.', 200, [
            'current_page' => $orders->currentPage(),
            'last_page' => $orders->lastPage(),
            'per_page' => $orders->perPage(),
            'total' => $orders->total(),
            'summary' => $summary,
        ]);
    }
}