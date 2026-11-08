<?php

namespace App\Services;

use App\Exceptions\CodPaymentPendingException;
use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\OrderItem;
use Illuminate\Support\Collection;

/**
 * COD "paid before ready" rule (rider trip flow, Stage B, decision 2026-11-08).
 *
 * For a COD delivery, a restaurant's food may only become READY after the
 * RESTAURANT confirmed it received the rider's payment for its stop
 * (cod_purchases.payment_confirmed_at). The rider's own purchase ledger
 * (status purchased/collected) never counts — a rider can't unlock "ready".
 *
 * The single authority used by:
 *   - Order / OrderItem model `saving` hooks (any path that saves 'ready')
 *   - explicit checks before bulk item updates (kitchen, owner mark-ready)
 *   - the preparation timer (readies only paid restaurants' items)
 *
 * Prepaid orders, pickup (non-delivery) orders and transport are unaffected.
 */
class CodPickupPaymentGuard
{
    /** Does the rule apply to this order (a COD delivery order)? */
    public function appliesTo(Order $order): bool
    {
        if ($order->order_type !== 'delivery') {
            return false;
        }
        $delivery = $order->activeDelivery();

        return $delivery !== null && app(NearestRiderService::class)->isCodDelivery($delivery);
    }

    /**
     * Restaurants (business ids) with active items in the order whose payment
     * the restaurant has NOT confirmed yet. Empty = all paid (or rule n/a).
     *
     * @return array<int, int>
     */
    public function unpaidBusinessIds(Order $order): array
    {
        if (! $this->appliesTo($order)) {
            return [];
        }

        $businessIds = $this->activeBusinessIds($order);
        if ($businessIds->isEmpty()) {
            return [];
        }

        $confirmed = CodPurchase::query()
            ->where('delivery_id', $order->activeDelivery()->id)
            ->whereIn('business_id', $businessIds)
            ->whereNotNull('payment_confirmed_at')
            ->pluck('business_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        return $businessIds->reject(fn (int $id) => in_array($id, $confirmed, true))->values()->all();
    }

    public function isBusinessPaid(Order $order, int $businessId): bool
    {
        return ! in_array($businessId, $this->unpaidBusinessIds($order), true);
    }

    /**
     * Refuse marking food ready while payment is pending: for one restaurant
     * ($businessId) or the whole order (null).
     *
     * @throws CodPaymentPendingException
     */
    public function assertCanMarkReady(Order $order, ?int $businessId = null): void
    {
        $unpaid = $this->unpaidBusinessIds($order);
        if ($businessId !== null) {
            $unpaid = in_array($businessId, $unpaid, true) ? [$businessId] : [];
        }
        if ($unpaid !== []) {
            throw new CodPaymentPendingException($unpaid);
        }
    }

    public function itemBusinessId(OrderItem $item, ?Order $order = null): int
    {
        return (int) ($item->business_id ?: ($order ?? $item->order)?->business_id);
    }

    /** @return Collection<int, int> */
    private function activeBusinessIds(Order $order): Collection
    {
        return $order->items()
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->get(['id', 'business_id', 'order_id', 'quantity', 'cancelled_quantity'])
            ->filter(fn (OrderItem $i) => $i->activeQuantity() > 0)
            ->map(fn (OrderItem $i) => (int) ($i->business_id ?: $order->business_id))
            ->filter()
            ->unique()
            ->values();
    }

    /** Delivery the order's payment confirmation is recorded against. */
    public function deliveryFor(Order $order): ?Delivery
    {
        return $order->activeDelivery();
    }
}
