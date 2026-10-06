<?php

namespace App\Services;

use App\Models\CodSettlement;
use App\Models\Delivery;
use App\Models\Order;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * P11.1 COD settlement allocation (credit-free COD).
 *
 * A COD customer pays the rider in cash at the drop-off; the rider keeps that
 * cash. COD is credit-free (no rider-track credit is reserved or deducted).
 * This service books the auditable settlement allocation of the
 * rider-financed base:
 *
 *     settlement_base = order.rider_financed_amount
 *         ├── restaurant_share = base - platform_fee      (default 80%)
 *         └── platform_fee    = base × cod_platform_fee_percent (default 20%)
 *
 * The split rate always comes from config; the cod_settlements row's
 * UNIQUE(order_id) is the DB backstop against a duplicate split.
 *
 * record() is designed to run INSIDE the caller's DB transaction (the delivery
 * row lock / status guard in NearestRiderService::settleCodDelivery).
 */
class CodSettlementService
{
    public function platformFeePercent(): int
    {
        return max(0, min(100, (int) config('delivery.cod_platform_fee_percent', 20)));
    }

    /**
     * Split a settlement base decimal-safely. The platform fee is computed as
     * a rounded percent, and the restaurant receives the remainder so that
     * restaurant_share + platform_fee always equals the exact base.
     */
    public function split(float $base): array
    {
        $base = round((float) $base, 2);
        $fee = round($base * ($this->platformFeePercent() / 100), 2);

        return [
            'settlement_base' => $base,
            'restaurant_share' => round($base - $fee, 2),
            'platform_fee' => $fee,
        ];
    }

    /**
     * The canonical settlement base: the exact rider-financed amount for the
     * order.
     *
    * The rider covers the purchase with cash on hand; no wallet deduction or
    * reserve is involved. The persisted order.rider_financed_amount is the
    * settlement base for the restaurant/platform allocation.
     */
    public function settlementBaseFor(Delivery $delivery, ?Order $order = null): float
    {
        $order = $order ?? $delivery->primaryOrder();
        $financed = (float) ($order?->rider_financed_amount ?? 0);

        if ($financed <= 0) {
            throw new \InvalidArgumentException(
                'A COD settlement requires a rider-financed amount on the order.'
            );
        }

        return round($financed, 2);
    }

    /**
     * Whether an order already has a COD settlement booked.
     */
    public function isSettled(int $orderId): bool
    {
        return CodSettlement::where('order_id', $orderId)->exists();
    }

    /**
     * Book the restaurant / Tourism Office settlement allocation for a settled
     * COD order. MUST be called inside the same DB transaction that completes
     * the delivery, so the settlement is atomic with the cash payment, earnings
     * and credit finalization.
     */
    public function record(Delivery $delivery, Order $order, int $riderId): CodSettlement
    {
        return $this->recordAllocations($delivery, $order, $riderId)->firstOrFail();
    }

    /**
     * Record one restaurant allocation per business represented by the order's
     * items. The delivery, cash payment, and rider earning remain singular.
     */
    public function recordAllocations(Delivery $delivery, Order $order, int $riderId): Collection
    {
        // Transport (ride-hailing) orders have no restaurant: the ride fare is
        // never allocated to a restaurant / Tourism Office split, so no
        // CodSettlement is booked and no restaurant wallet is touched.
        if ($order->order_type === 'transport') {
            return new Collection;
        }

        $items = $order->items()->get();
        $groups = $items->groupBy(fn ($item) => $item->business_id ?: $order->business_id);
        $orderSubtotal = max(0.01, (float) $order->subtotal);

        return $groups->map(function (Collection $businessItems, $businessId) use ($delivery, $order, $riderId, $orderSubtotal) {
            $businessSubtotal = round($businessItems->sum(fn ($item) =>
                (float) $item->unit_price * max(0, (int) $item->quantity - (int) $item->cancelled_quantity)
            ), 2);
            $systemFeeShare = round((float) $order->system_fee * ($businessSubtotal / $orderSubtotal), 2);
            $base = round($businessSubtotal + $systemFeeShare, 2);
            $split = $this->split($base);

            $settlement = CodSettlement::create([
                'settlement_number' => 'COD-STL-' . Str::upper(Str::random(10)),
                'order_id' => $order->id,
                'delivery_id' => $delivery->id,
                'business_id' => (int) $businessId,
                'rider_id' => $riderId,
                'settlement_base' => $split['settlement_base'],
                'restaurant_share' => $split['restaurant_share'],
                'platform_fee' => $split['platform_fee'],
                'status' => CodSettlement::STATUS_SETTLED,
                'settled_at' => now(),
            ]);

            if (round((float) $settlement->restaurant_share + (float) $settlement->platform_fee, 2)
                !== round((float) $settlement->settlement_base, 2)) {
                throw new \RuntimeException('COD settlement split failed to reconcile to its base.');
            }

            return $settlement;
        })->values();
    }

    /**
     * Restaurant ledger: settleable/receivable + settled totals for a business.
     */
    public function restaurantLedger(int $businessId): array
    {
        $rows = CodSettlement::where('business_id', $businessId)->get();

        return [
            'settlements' => $rows,
            'total_settlement_base' => round($rows->sum(fn (CodSettlement $s) => (float) $s->settlement_base), 2),
            'total_restaurant_receivable' => round($rows->sum(fn (CodSettlement $s) => (float) $s->restaurant_share), 2),
            'total_platform_fee' => round($rows->sum(fn (CodSettlement $s) => (float) $s->platform_fee), 2),
        ];
    }

    /**
     * Tourism Office / admin revenue ledger across all restaurants.
     */
    public function tourismOfficeLedger(): array
    {
        $rows = CodSettlement::query()->orderByDesc('settled_at')->get();

        return [
            'settlements' => $rows,
            'count' => $rows->count(),
            'total_settlement_base' => round($rows->sum(fn (CodSettlement $s) => (float) $s->settlement_base), 2),
            'total_platform_revenue' => round($rows->sum(fn (CodSettlement $s) => (float) $s->platform_fee), 2),
            'total_restaurant_receivable' => round($rows->sum(fn (CodSettlement $s) => (float) $s->restaurant_share), 2),
        ];
    }
}