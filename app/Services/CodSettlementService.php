<?php

namespace App\Services;

use App\Models\CodSettlement;
use App\Models\Delivery;
use App\Models\Order;
use Illuminate\Support\Str;

/**
 * P11.1 COD credit settlement allocation.
 *
 * A COD customer pays the rider in cash at the drop-off. The rider keeps that
 * cash, but the restaurant order was financed out of the rider's credit wallet
 * (reserved at dispatch-accept time). At completion the reserved credit is
 * debited by the existing finalizeCredits() path (this service never re-debits
 * the wallet), and THIS service books the auditable settlement allocation of
 * that financed amount:
 *
 *     settlement_base (delivery.cod_credit_reserved == order.rider_financed_amount)
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
     * Legacy credit-financed COD deliveries recorded the reserve on the
     * delivery (cod_credit_reserved == order.rider_financed_amount) and that
     * remains the authoritative base whenever it is greater than zero.
     *
     * New COD accepts no longer reserve rider credit (credit-free, step 3): the
     * rider covers the purchase with cash on hand and no wallet deduction
     * happens. For those deliveries the persisted order.rider_financed_amount
     * is the settlement base, keeping the invariant
     *
     *     delivery.cod_credit_reserved (=0)
     *         -> order.rider_financed_amount
     *         -> restaurant 80% + Tourism Office 20%
     */
    public function settlementBaseFor(Delivery $delivery, ?Order $order = null): float
    {
        $order = $order ?? $delivery->primaryOrder();
        $reserved = (float) ($delivery->cod_credit_reserved ?? 0);
        $financed = (float) ($order?->rider_financed_amount ?? 0);

        if ($financed <= 0) {
            throw new \InvalidArgumentException(
                'A COD settlement requires a rider-financed amount on the order.'
            );
        }

        if ($reserved > 0 && abs($reserved - $financed) > 0.01) {
            throw new \InvalidArgumentException(
                'COD settlement base (' . $reserved . ') does not match the rider-financed amount (' . $financed . ').'
            );
        }

        return round($reserved > 0 ? $reserved : $financed, 2);
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
        $base = $this->settlementBaseFor($delivery, $order);
        $split = $this->split($base);

        $settlement = CodSettlement::create([
            'settlement_number' => 'COD-STL-' . Str::upper(Str::random(10)),
            'order_id' => $order->id,
            'delivery_id' => $delivery->id,
            'business_id' => (int) $order->business_id,
            'rider_id' => $riderId,
            'settlement_base' => $split['settlement_base'],
            'restaurant_share' => $split['restaurant_share'],
            'platform_fee' => $split['platform_fee'],
            'status' => CodSettlement::STATUS_SETTLED,
            'settled_at' => now(),
        ]);

        // Audit invariant: the ledger split always reconciles to the base.
        if (
            round((float) $settlement->restaurant_share + (float) $settlement->platform_fee, 2)
            !== round((float) $settlement->settlement_base, 2)
        ) {
            throw new \RuntimeException('COD settlement split failed to reconcile to its base.');
        }

        return $settlement;
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