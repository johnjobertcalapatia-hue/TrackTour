<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * Purchasing-cash COD flow (professor model).
 *
 * After a rider accepts a COD delivery, the Tourism Office issues the rider
 * the cash needed to buy the food from every participating restaurant
 * (deliveries.purchasing_cash). The rider receives the cash, then works the
 * pickup route restaurant by restaurant, marking each cod_purchases stop
 * purchased → collected. The delivery cannot leave the pickup area (picked_up)
 * until every purchase stop is collected.
 *
 * Money invariants (AGENTS.md §5.3):
 *
 *     purchasing_cash issued  = Σ purchase_amount
 *                             = order.rider_financed_amount
 *                             = settlement base (restaurant 80 / office 20)
 *
 * Each purchase_amount uses the exact CodSettlementService allocation formula
 * (business subtotal + system-fee share), so the ledger always reconciles to
 * the authoritative settlement base. No rider wallet/credit is involved.
 */
class PurchasingCashService
{
    /** Statuses during which purchasing cash may still be issued / spent. */
    public const ISSUABLE_STATUSES = ['assigned', 'en_route_pickup', 'arrived_pickup'];

    /**
     * Create the per-restaurant cod_purchases rows for a COD delivery.
     *
     * Idempotent: safe to call more than once (acceptance re-runs, double-tap,
     * race). Amounts are recomputed from the canonical order items with the
     * same allocation CodSettlementService::recordAllocations() uses.
     */
    public function initializeForDelivery(Delivery $delivery): void
    {
        if (! $this->isCod($delivery)) {
            return;
        }

        if (CodPurchase::where('delivery_id', $delivery->id)->exists()) {
            return;
        }

        $allocations = $this->allocation($delivery);
        if ($allocations->isEmpty()) {
            return;
        }

        $createdAt = now();

        foreach ($allocations as $businessId => $amount) {
            CodPurchase::create([
                'purchase_number' => 'COD-PUR-' . Str::upper(Str::random(10)),
                'delivery_id' => $delivery->id,
                'order_id' => $delivery->primaryOrder()?->id ?? $delivery->order_id,
                'business_id' => $businessId,
                'purchase_amount' => $amount,
                'status' => CodPurchase::STATUS_PENDING,
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ]);
        }
    }

    /**
     * Tourism Office issues the rider the purchasing cash for the delivery.
     *
     * @return array summary of the issued cash
     *
     * @throws InvalidArgumentException
     */
    public function issuePurchasingCash(Delivery $delivery, int $officerId): array
    {
        if (! $this->isCod($delivery)) {
            throw new InvalidArgumentException('This delivery is not a cash-on-delivery order.');
        }

        if (! $delivery->rider_id) {
            throw new InvalidArgumentException('This delivery has no assigned rider yet.');
        }

        if ($delivery->purchasing_cash_issued_at !== null) {
            throw new InvalidArgumentException('Purchasing cash has already been issued for this delivery.');
        }

        $status = $delivery->status->value ?? $delivery->status;
        if (! in_array($status, self::ISSUABLE_STATUSES, true)) {
            throw new InvalidArgumentException('Purchasing cash can only be issued while the rider is en route to or at the pickup area.');
        }

        $delivery = Delivery::find($delivery->id);
        $this->initializeForDelivery($delivery);

        $rows = $delivery->codPurchases;
        $total = round($rows->sum(fn (CodPurchase $p) => (float) $p->purchase_amount), 2);

        if ($rows->isEmpty() || $total <= 0) {
            throw new InvalidArgumentException('There are no purchasable items on this delivery.');
        }

        DB::transaction(function () use ($delivery, $officerId, $total) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked || $locked->purchasing_cash_issued_at !== null) {
                return;
            }

            $locked->update([
                'purchasing_cash' => $total,
                'purchasing_cash_issued_at' => now(),
                'purchasing_cash_issued_by' => $officerId,
            ]);

            ActivityLog::create([
                'user_id' => $officerId,
                'action' => 'purchasing_cash.issued',
                'description' => sprintf(
                    'Issued purchasing cash ₱%s to rider #%s for delivery #%s (%d restaurant purchase stop(s)).',
                    number_format($total, 2),
                    (string) $delivery->rider_id,
                    (string) $delivery->id,
                    (int) $delivery->codPurchases->count()
                ),
            ]);
        });

        return [
            'delivery_id' => $delivery->id,
            'purchasing_cash' => $total,
            'purchasing_cash_issued_at' => now(),
            'purchases_count' => $delivery->codPurchases->count(),
        ];
    }

    /**
     * Rider acknowledges receipt of the issued purchasing cash.
     *
     * @throws InvalidArgumentException
     */
    public function confirmCashReceipt(Delivery $delivery, int $riderId): void
    {
        $this->assertRiderOwnership($delivery, $riderId);
        $this->assertIssued($delivery);

        if ($delivery->purchasing_cash_received_at !== null) {
            return; // Idempotent: already confirmed.
        }

        $status = $delivery->status->value ?? $delivery->status;
        if (! in_array($status, self::ISSUABLE_STATUSES, true)) {
            throw new InvalidArgumentException('Purchasing cash receipt can only be confirmed at the pickup stage.');
        }

        $delivery->update(['purchasing_cash_received_at' => now()]);
    }

    /**
     * Mark one restaurant purchase stop. Only the assigned rider may perform
     * this, and only after the purchasing cash has been issued.
     *
     * @throws InvalidArgumentException
     */
    public function markPurchase(Delivery $delivery, int $purchaseId, int $riderId, string $status): void
    {
        $this->assertRiderOwnership($delivery, $riderId);
        $this->assertIssued($delivery);

        if (! in_array($status, [CodPurchase::STATUS_PURCHASED, CodPurchase::STATUS_COLLECTED], true)) {
            throw new InvalidArgumentException('Invalid purchase status. Use purchased or collected.');
        }

        DB::transaction(function () use ($delivery, $purchaseId, $status) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked) {
                throw new InvalidArgumentException('Delivery not found.');
            }

            $statusNow = $locked->status->value ?? $locked->status;
            if (! in_array($statusNow, self::ISSUABLE_STATUSES, true)) {
                throw new InvalidArgumentException('Purchases can only be marked at the pickup stage.');
            }

            $purchase = CodPurchase::where('id', $purchaseId)
                ->where('delivery_id', $locked->id)
                ->lockForUpdate()
                ->first();

            if (! $purchase) {
                throw new InvalidArgumentException('Purchase stop does not belong to this delivery.');
            }

            if ($status === CodPurchase::STATUS_PURCHASED) {
                if ($purchase->status !== CodPurchase::STATUS_PENDING) {
                    throw new InvalidArgumentException('This purchase stop has already been processed.');
                }
                $purchase->update([
                    'status' => CodPurchase::STATUS_PURCHASED,
                    'purchased_at' => now(),
                ]);

                return;
            }

            if ($purchase->status === CodPurchase::STATUS_COLLECTED) {
                throw new InvalidArgumentException('This purchase stop has already been processed.');
            }
            if ($purchase->status !== CodPurchase::STATUS_PURCHASED) {
                throw new InvalidArgumentException('Mark the purchase as bought first.');
            }
            $purchase->update([
                'status' => CodPurchase::STATUS_COLLECTED,
                'collected_at' => now(),
            ]);
        });
    }

    /**
     * Delivery may leave the pickup area only when EVERY purchase stop is
     * collected (the professor "ALL FOOD COLLECTED" gate). A delivery with no
     * purchase rows is NOT fully collected.
     */
    public function isFullyCollected(Delivery $delivery): bool
    {
        $rows = $delivery->codPurchases;

        if ($rows->isEmpty()) {
            return false;
        }

        return $rows->every(fn (CodPurchase $p) => $p->status === CodPurchase::STATUS_COLLECTED);
    }

    public function pendingPurchaseCount(Delivery $delivery): int
    {
        return $delivery->codPurchases
            ->where('status', '!=', CodPurchase::STATUS_COLLECTED)
            ->count();
    }

    /**
     * Per-business purchase allocation using the exact CodSettlementService
     * formula so the ledger reconciles to order.rider_financed_amount.
     *
     * @return Collection<string, float> business_id => purchase amount
     */
    public function allocation(Delivery $delivery): Collection
    {
        $allocations = collect();
        $orders = $delivery->childOrders();

        foreach ($orders as $order) {
            $orderSubtotal = max(0.01, (float) $order->subtotal);
            $systemFee = (float) $order->system_fee;

            $groups = $order->items()->get()->groupBy(fn ($item) => $item->business_id ?: $order->business_id);

            foreach ($groups as $businessId => $items) {
                $businessSubtotal = round($items->sum(fn ($item) =>
                    (float) $item->unit_price * max(0, (int) $item->quantity - (int) $item->cancelled_quantity)
                ), 2);
                $systemFeeShare = round($systemFee * ($businessSubtotal / $orderSubtotal), 2);
                $base = round($businessSubtotal + $systemFeeShare, 2);

                $allocations->put((string) $businessId, round((float) $allocations->get((string) $businessId, 0.0) + $base, 2));
            }
        }

        return $allocations;
    }

    private function isCod(Delivery $delivery): bool
    {
        return app(NearestRiderService::class)->isCodDelivery($delivery);
    }

    private function assertIssued(Delivery $delivery): void
    {
        if ($delivery->purchasing_cash_issued_at === null) {
            throw new InvalidArgumentException('Purchasing cash has not been issued yet.');
        }
    }

    private function assertRiderOwnership(Delivery $delivery, int $riderId): void
    {
        if ((int) ($delivery->rider_id ?? 0) !== $riderId) {
            throw new InvalidArgumentException('You are not assigned to this delivery.');
        }
    }
}