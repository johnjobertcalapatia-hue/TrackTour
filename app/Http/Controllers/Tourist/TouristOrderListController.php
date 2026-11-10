<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderItemReview;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * GET /api/tourist/orders?tab=all|to_pay|preparing|in_transit|to_receive|to_review
 *
 * My Orders, item by item. Each checkout is one section (one order number,
 * one delivery fee) listing every dish it contains — a group checkout's
 * dishes from several restaurants stay together in the same section.
 *
 * Read-only. Tabs are derived from the authoritative order + delivery status:
 *   to_pay      online payment not completed (pending_payment / unpaid GCash),
 *               and COD orders whose cash is still due (until delivered); a COD
 *               order also stays in its progress tab so it can be followed
 *   preparing   placed and paid (or COD): waiting for a rider, accepted, cooking, ready
 *   in_transit  the rider picked it up and is on the way
 *   to_receive  the rider has arrived; the tourist confirms receipt
 *   to_review   delivered/completed and not rated yet
 * "all" lists every section, including completed and cancelled ones.
 */
class TouristOrderListController extends Controller
{
    public const TABS = ['to_pay', 'preparing', 'in_transit', 'to_receive', 'to_review'];

    private const CANCELLED = ['cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'];

    private const UNPAID = ['pending', 'unpaid', 'failed', 'awaiting_payment'];

    private const OFFLINE_METHODS = ['cash', 'cod'];

    /** Most recent checkouts considered (keeps the page fast). */
    private const LIMIT = 100;

    /** @var \Illuminate\Support\Collection<int, OrderItemReview> keyed by order_item_id */
    private Collection $itemReviews;

    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tab' => ['nullable', 'in:all,'.implode(',', self::TABS)],
        ]);
        $tab = $validated['tab'] ?? 'all';
        $user = $request->user();

        $orders = Order::query()
            ->where('order_type', '!=', 'transport')
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('customer_email', $user->email))
            ->with([
                'business:id,business_name,latitude,longitude',
                'items.offering:id,business_id,image,price,is_available,status',
                'items.business:id,business_name,latitude,longitude,status',
                'delivery.rider.profile',
                'groupOrder.delivery.rider.profile',
            ])
            ->latest()
            ->limit(self::LIMIT * 3)
            ->get();

        // Per-dish reviews for these orders, in one query.
        $this->itemReviews = OrderItemReview::query()
            ->whereIn('order_id', $orders->pluck('id'))
            ->get(['order_item_id', 'rating'])
            ->keyBy('order_item_id');

        // One section per checkout: a group checkout's orders share a section.
        $sections = $orders
            ->groupBy(fn (Order $o) => $o->group_order_id ? 'g'.$o->group_order_id : 'o'.$o->id)
            ->map(fn (Collection $group) => $this->section($group))
            ->sortByDesc('placed_at')
            ->values()
            ->take(self::LIMIT);

        $counts = ['all' => $sections->count()];
        foreach (self::TABS as $t) {
            $counts[$t] = $sections->filter(fn (array $s) => in_array($t, $s['tabs'], true))->count();
        }

        return $this->successResponse([
            'tab' => $tab,
            'counts' => $counts,
            'sections' => ($tab === 'all' ? $sections : $sections->filter(fn (array $s) => in_array($tab, $s['tabs'], true)))->values(),
        ]);
    }

    /** @param  Collection<int, Order>  $orders */
    private function section(Collection $orders): array
    {
        /** @var Order $primary */
        $primary = $orders->sortBy('id')->first();
        $group = $primary->groupOrder;
        $delivery = $primary->delivery ?? $group?->delivery;
        $deliveryStatus = $delivery?->status?->value ?? $delivery?->status;
        $tab = $this->tabFor($primary, $deliveryStatus);
        $paymentMethod = $group?->payment_method ?? $primary->payment_method;
        $paymentStatus = $group?->payment_status ?? $primary->payment_status;
        // COD: the cash is paid to the rider on delivery, so it is "to pay" until then.
        $codDue = in_array(strtolower((string) $paymentMethod), self::OFFLINE_METHODS, true)
            && $paymentStatus !== 'paid'
            && in_array($tab, ['preparing', 'in_transit', 'to_receive'], true);
        $tabs = array_values(array_unique(array_filter([$tab, $codDue ? 'to_pay' : null])));

        $items = $orders->flatMap(fn (Order $o) => $o->items->map(fn (OrderItem $item) => [$o, $item]))
            ->map(function (array $pair) {
                [$order, $item] = $pair;
                $qty = max(0, (int) $item->quantity - (int) ($item->cancelled_quantity ?? 0));
                $business = $item->business ?? $order->business;
                $offering = $item->offering;
                $review = $this->itemReviews->get($item->id);

                return [
                    'id' => $item->id,
                    'order_id' => $order->id,
                    'offering_id' => $item->offering_id,
                    'name' => $item->product_name,
                    'image' => $offering?->image,
                    'restaurant' => $business?->business_name,
                    'business_id' => $business?->id,
                    'business_latitude' => $business?->latitude !== null ? (float) $business->latitude : null,
                    'business_longitude' => $business?->longitude !== null ? (float) $business->longitude : null,
                    'notes' => $item->notes,
                    'quantity' => $qty,
                    'unit_price' => (float) $item->unit_price,
                    'line_total' => round((float) $item->unit_price * $qty, 2),
                    'status' => $item->status,
                    // Buy again / Add to cart use today's menu, not the old price.
                    'can_order' => $offering !== null && $offering->is_available && $offering->status === 'available',
                    'current_price' => $offering !== null ? (float) $offering->price : null,
                    'reviewed' => $review !== null,
                    'my_rating' => $review?->rating,
                ];
            })
            ->filter(fn (array $i) => $i['quantity'] > 0)
            ->values();

        // Delivered orders stay "to review" until every dish is reviewed. Orders
        // rated the earlier, whole-order way (no dish reviews) count as reviewed.
        if ($tab === 'delivered') {
            $anyItemReviews = $items->contains('reviewed', true);
            $tab = $anyItemReviews
                ? ($items->every(fn (array $i) => $i['reviewed']) ? 'completed' : 'to_review')
                : ($primary->rating === null ? 'to_review' : 'completed');
            $tabs = [$tab];
        }

        // A checkout has exactly one delivery fee (group checkouts store it once).
        $deliveryFee = (float) ($group ? $group->delivery_total : $primary->delivery_fee);
        $tip = (float) ($group ? $group->rider_tip : $primary->rider_tip);
        $subtotal = round((float) $items->sum('line_total'), 2);
        $rider = $delivery?->rider;

        return [
            'key' => $group ? 'group-'.$group->id : 'order-'.$primary->id,
            'reference' => $group?->reference_number ?? $primary->order_number,
            'primary_order_id' => $primary->id,
            // "Complete payment" pays the whole checkout: the group checkout when
            // there is one, otherwise the order (PaymentController::createIntent).
            'group_order_id' => $group?->id,
            'placed_at' => $primary->created_at?->toIso8601String(),
            'tab' => $tab,
            /** Every tab this order shows in (a COD order: its progress tab + to_pay). */
            'tabs' => $tabs,
            'cod_due' => $codDue,
            'status' => $primary->status,
            'delivery_status' => $deliveryStatus,
            'status_label' => $this->label($tab, $primary->status),
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentStatus,
            'items' => $items,
            'subtotal' => $subtotal,
            'delivery_fee' => $deliveryFee,
            'rider_tip' => $tip,
            'total' => (float) ($group ? $group->grand_total : $primary->total),
            'rated' => $tab === 'completed',
            'rider_rated' => $primary->delivery_rating !== null,
            // Delivery details (shown on To Review).
            'delivered_at' => ($delivery?->delivered_at ?? $primary->completed_at)?->toIso8601String(),
            'customer_name' => $group?->customer_name ?? $primary->customer_name,
            'customer_phone' => $group?->customer_phone ?? $primary->customer_phone,
            'delivery_address' => $group?->delivery_address ?? $primary->delivery_address,
            // Rider's proof-of-delivery photo (completion with proof, 2026-11-08).
            'delivery_proof_url' => $delivery?->delivery_proof_path
                ? \Illuminate\Support\Facades\Storage::disk('public')->url($delivery->delivery_proof_path)
                : null,
            'rider' => $rider ? [
                'name' => $rider->name,
                'photo' => $rider->profile?->avatar,
            ] : null,
        ];
    }

    private function tabFor(Order $order, ?string $deliveryStatus): string
    {
        $status = $order->status;
        if (in_array($status, self::CANCELLED, true)) {
            return 'cancelled';
        }

        $online = ! in_array(strtolower((string) $order->payment_method), self::OFFLINE_METHODS, true);
        if ($status === 'pending_payment' || ($online && in_array($order->payment_status, self::UNPAID, true))) {
            return 'to_pay';
        }

        if (in_array($status, ['delivered', 'completed'], true) || in_array($deliveryStatus, ['delivered', 'completed'], true)) {
            return 'delivered'; // resolved to to_review / completed from the dish reviews in section()
        }
        if ($status === 'arrived_destination' || $deliveryStatus === 'arrived_destination') {
            return 'to_receive';
        }
        if (in_array($status, ['picked_up', 'in_transit'], true)
            || in_array($deliveryStatus, ['picked_up', 'in_transit', 'en_route_destination'], true)) {
            return 'in_transit';
        }

        return 'preparing';
    }

    private function label(string $tab, string $status): string
    {
        return match ($tab) {
            'to_pay' => 'Waiting for payment',
            'in_transit' => 'On the way',
            'to_receive' => 'Rider has arrived',
            'to_review' => 'Delivered',
            'completed' => 'Completed',
            'cancelled' => $status === 'refunded' ? 'Refunded' : 'Cancelled',
            default => match ($status) {
                'accepted' => 'Rider assigned',
                'preparing' => 'Preparing',
                'ready' => 'Ready for pickup',
                default => 'Finding a rider',
            },
        };
    }
}
