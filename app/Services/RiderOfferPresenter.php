<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\OrderItem;
use Illuminate\Support\Collection;

/**
 * Read-only presentation of a delivery offer for riders: what the rider needs
 * to decide whether to accept (order, type, money, distance, pickups, items).
 *
 * Money comes from authoritative columns only: deliveries.delivery_fee and
 * orders.rider_tip (the fast-delivery tip, rider earnings — AGENTS.md §5.4).
 * Nothing here mutates dispatch state; acceptance stays in
 * RiderDispatchController::accept.
 */
class RiderOfferPresenter
{
    /** Fields shown on the Available Deliveries card. */
    public function summary(Delivery $delivery): array
    {
        $orders = $delivery->childOrders();
        $primary = $orders->first();
        $items = $this->activeItems($orders);
        $speed = $this->speed($primary);

        return [
            'order_id' => $primary?->id,
            'order_number' => $primary?->order_number,
            'delivery_speed' => $speed,
            'delivery_type_label' => $speed === 'fast' ? 'Priority Delivery' : 'Standard Delivery',
            'pickup_names' => $this->businesses($orders, $items)->pluck('name')->filter()->values()->all(),
            'items_count' => (int) $items->sum(fn (OrderItem $i) => $i->activeQuantity()),
            'rider_tip' => (float) ($primary?->rider_tip ?? 0),
            'delivery_fee' => $delivery->delivery_fee !== null ? (float) $delivery->delivery_fee : null,
            'distance_km' => $delivery->distance_km !== null ? (float) $delivery->distance_km : null,
            'payment_method' => $primary?->payment_method,
            'is_cod' => strtolower((string) ($primary?->payment_method ?? '')) === 'cash',
        ];
    }

    /**
     * An offer another rider accepted: enough to recognise the card, with the
     * customer's drop-off and items withheld (it is someone else's job now).
     */
    public function takenSummary(Delivery $delivery): array
    {
        return $this->restrictedSummary($delivery, 'taken', 'Already accepted by another rider')
            + ['accepted_at' => $delivery->assigned_at];
    }

    /** An offer another rider is reviewing right now: details withheld until the hold ends. */
    public function reviewingSummary(Delivery $delivery): array
    {
        return $this->restrictedSummary($delivery, 'reviewing', 'Another rider is reviewing this offer')
            + ['review_expires_at' => $delivery->review_expires_at];
    }

    private function restrictedSummary(Delivery $delivery, string $availability, string $label): array
    {
        $summary = $this->summary($delivery);

        return [
            'id' => $delivery->id,
            'availability' => $availability,
            'status' => $availability,
            'status_label' => $label,
            'order_id' => $summary['order_id'],
            'order_number' => $summary['order_number'],
            'order_type' => $delivery->primaryOrder()?->order_type,
            'delivery_speed' => $summary['delivery_speed'],
            'delivery_type_label' => $summary['delivery_type_label'],
            'pickup_names' => $summary['pickup_names'],
            'pickup_address' => $delivery->pickup_address,
            'delivery_address' => null,
            'items_count' => $summary['items_count'],
            'rider_tip' => $summary['rider_tip'],
            'delivery_fee' => $summary['delivery_fee'],
            'distance_km' => $summary['distance_km'],
            'payment_method' => $summary['payment_method'],
            'is_cod' => $summary['is_cod'],
            'created_at' => $delivery->created_at,
        ];
    }

    /** Full offer page payload. */
    public function detail(Delivery $delivery): array
    {
        $orders = $delivery->childOrders();
        $items = $this->activeItems($orders);
        $itemsByBusiness = $items->groupBy(fn (OrderItem $i, $k) => (int) ($i->business_id ?: $i->order?->business_id));

        return array_merge($this->summary($delivery), [
            'id' => $delivery->id,
            'status' => $delivery->status?->value ?? $delivery->status,
            'is_mine' => $delivery->rider_id !== null && (int) $delivery->rider_id === (int) auth()->id(),
            // A live dispatch ping can be declined; an open board offer simply isn't taken.
            'offered_to_me' => \App\Models\BookingDispatchLog::query()
                ->where('delivery_id', $delivery->id)
                ->where('rider_id', auth()->id())
                ->where('response', 'pending')
                ->exists(),
            'estimated_duration_minutes' => $delivery->estimated_duration_minutes,
            'created_at' => $delivery->created_at,
            'pickup' => [
                'address' => $delivery->pickup_address,
                'latitude' => $delivery->pickup_latitude !== null ? (float) $delivery->pickup_latitude : null,
                'longitude' => $delivery->pickup_longitude !== null ? (float) $delivery->pickup_longitude : null,
            ],
            'dropoff' => [
                'address' => $delivery->delivery_address,
                'latitude' => $delivery->delivery_latitude !== null ? (float) $delivery->delivery_latitude : null,
                'longitude' => $delivery->delivery_longitude !== null ? (float) $delivery->delivery_longitude : null,
            ],
            'pickups' => $this->businesses($orders, $items)->map(fn (array $b) => $b + [
                'items_count' => (int) collect($itemsByBusiness->get($b['id'], []))->sum(fn (OrderItem $i) => $i->activeQuantity()),
            ])->values()->all(),
            'items' => $items->map(fn (OrderItem $i) => [
                'id' => $i->id,
                'business_id' => (int) ($i->business_id ?: $i->order?->business_id),
                'product_name' => $i->product_name,
                'quantity' => $i->activeQuantity(),
                'unit_price' => (float) $i->unit_price,
                'subtotal' => round((float) $i->unit_price * $i->activeQuantity(), 2),
                'notes' => $i->notes,
                'image' => $i->offering?->image,
            ])->values()->all(),
            'items_total' => round($items->sum(fn (OrderItem $i) => (float) $i->unit_price * $i->activeQuantity()), 2),
        ]);
    }

    /**
     * Rider trip status page (2026-11-08): facts only the ASSIGNED rider gets
     * (never on an offer another rider can see): when it was accepted, the
     * rider's earnings and how to reach the tourist.
     */
    public function assignedExtras(Delivery $delivery): array
    {
        $primary = $delivery->primaryOrder();

        return [
            'assigned_at' => $delivery->assigned_at,
            'rider_earnings' => $delivery->rider_commission !== null ? (float) $delivery->rider_commission : null,
            'customer_name' => $primary?->customer_name,
            'customer_phone' => $primary?->customer_phone,
            'order_status' => $primary?->status,
        ];
    }

    private function speed(?Order $order): string
    {
        return ($order?->delivery_speed ?? 'standard') === 'fast' ? 'fast' : 'standard';
    }

    /** Items still to be delivered (cancelled/rejected lines excluded). */
    private function activeItems(Collection $orders): Collection
    {
        return $orders
            ->flatMap(fn (Order $o) => $o->items()->with(['offering', 'order'])->get())
            ->reject(fn (OrderItem $i) => in_array($i->status, ['cancelled', 'rejected'], true) || $i->activeQuantity() <= 0)
            ->values();
    }

    /** Distinct pickup restaurants: from item business_id (group carts) or the order's business. */
    private function businesses(Collection $orders, Collection $items): Collection
    {
        $ids = ($items->isNotEmpty()
                ? $items->map(fn (OrderItem $i) => (int) ($i->business_id ?: $i->order?->business_id))
                : $orders->pluck('business_id')->map(fn ($id) => (int) $id))
            ->filter()
            ->unique()
            ->values();

        return \App\Models\Business::query()->whereIn('id', $ids)->get(['id', 'business_name', 'address', 'logo'])
            ->sortBy(fn ($b) => $ids->search($b->id))
            ->map(fn ($b) => ['id' => $b->id, 'name' => $b->business_name, 'address' => $b->address, 'logo' => $b->logo])
            ->values();
    }
}
