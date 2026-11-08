<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderCashFund;
use App\Models\RiderCashFundTransaction;
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
    public function __construct(
        private PickupSequenceService $pickupSequence,
        private RiderCashFundService $cashFunds,
        private CodSettlementService $settlements,
    ) {}

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
    public function issuePurchasingCash(Delivery $delivery, User $officer): array
    {
        return DB::transaction(function () use ($delivery, $officer) {
            $locked = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);

            if (! $this->isCod($locked)) {
                throw new InvalidArgumentException('This delivery is not a cash-on-delivery order.');
            }

            if (! $locked->rider_id) {
                throw new InvalidArgumentException('This delivery has no assigned rider yet.');
            }

            if ($locked->purchasing_cash_issued_at !== null) {
                throw new InvalidArgumentException('Purchasing cash has already been issued for this delivery.');
            }

            $status = $locked->status->value ?? $locked->status;
            if (! in_array($status, self::ISSUABLE_STATUSES, true)) {
                throw new InvalidArgumentException('Purchasing cash can only be issued while the rider is en route to or at the pickup area.');
            }

            $this->initializeForDelivery($locked);
            $rows = CodPurchase::query()->where('delivery_id', $locked->id)->get();
            $total = round($rows->sum(fn (CodPurchase $p) => (float) $p->purchase_amount), 2);

            if ($rows->isEmpty() || $total <= 0) {
                throw new InvalidArgumentException('There are no purchasable items on this delivery.');
            }

            // Financial invariant (AGENTS.md §5.3): the restaurant purchase
            // allocations must reconcile exactly to the canonical rider-financed
            // amount before any cash is issued. A mismatch means the ledger has
            // drifted (e.g. a tampered/stale row) and must never be issued.
            $canonical = $this->settlements->settlementBaseFor($locked);
            if (round($total, 2) !== round($canonical, 2)) {
                throw new InvalidArgumentException(sprintf(
                    'Purchasing cash invariant violated: restaurant purchase allocations total ₱%s but the canonical rider-financed amount is ₱%s.',
                    number_format($total, 2),
                    number_format($canonical, 2)
                ));
            }

            $fund = $this->cashFunds->recordDeliveryIssuance($locked, $officer, $total);
            $locked->update([
                'purchasing_cash' => $total,
                'purchasing_cash_issued_at' => now(),
                'purchasing_cash_issued_by' => $officer->id,
                'rider_cash_fund_id' => $fund->id,
            ]);

            ActivityLog::record(
                'purchasing_cash.issued',
                sprintf(
                    'Issued purchasing cash ₱%s to rider #%s for delivery #%s (%d restaurant purchase stop(s)).',
                    number_format($total, 2),
                    (string) $locked->rider_id,
                    (string) $locked->id,
                    $rows->count()
                ),
                $locked,
                ActivityLog::TYPE_FINANCIAL
            );

            return [
                'delivery_id' => $locked->id,
                'rider_cash_fund_id' => $fund->id,
                'purchasing_cash' => $total,
                'purchasing_cash_issued_at' => $locked->fresh()->purchasing_cash_issued_at,
                'purchases_count' => $rows->count(),
            ];
        });
    }

    public function issueAdditionalPurchasingCash(
        Delivery $delivery,
        User $officer,
        float $amount,
        string $idempotencyKey
    ): RiderCashFundTransaction {
        return $this->cashFunds->issueAdditionalCash($delivery, $officer, $amount, $idempotencyKey);
    }

    /**
     * Rider acknowledges receipt of the issued purchasing cash.
     *
     * @throws InvalidArgumentException
     */
    public function confirmCashReceipt(Delivery $delivery, User $rider): void
    {
        $this->cashFunds->confirmCashReceipt($delivery, $rider);
    }

    /**
     * Mark one restaurant purchase stop. Only the assigned rider may perform
     * this after the Tourism Office issues the cash and the rider confirms
     * receipt.
     *
     * @throws InvalidArgumentException
     */
    public function markPurchase(Delivery $delivery, int $purchaseId, int $riderId, string $status): ?array
    {
        $this->assertRiderOwnership($delivery, $riderId);
        // Daily advance: the rider already holds the office cash.
        $this->linkDailyAdvance($delivery);

        if (! in_array($status, [CodPurchase::STATUS_PURCHASED, CodPurchase::STATUS_COLLECTED], true)) {
            throw new InvalidArgumentException('Invalid purchase status. Use purchased or collected.');
        }

        if ($status === CodPurchase::STATUS_COLLECTED) {
            $purchase = CodPurchase::where('id', $purchaseId)
                ->where('delivery_id', $delivery->id)
                ->first();

            if (! $purchase) {
                throw new InvalidArgumentException('Purchase stop does not belong to this delivery.');
            }

            if ($purchase->status === CodPurchase::STATUS_COLLECTED) {
                throw new InvalidArgumentException('This purchase stop has already been processed.');
            }
            if ($purchase->status !== CodPurchase::STATUS_PURCHASED) {
                throw new InvalidArgumentException('Mark the purchase as bought first.');
            }

            return $this->pickupSequence->confirmStop(
                $delivery,
                (int) $purchase->business_id,
                $riderId,
            );
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

            if ($purchase->status !== CodPurchase::STATUS_PENDING) {
                throw new InvalidArgumentException('This purchase stop has already been processed.');
            }
            $purchase->update([
                'status' => CodPurchase::STATUS_PURCHASED,
                'purchased_at' => now(),
            ]);
        });

        return null;
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

        foreach ($delivery->childOrders() as $order) {
            // Delegate to the single canonical allocation formula so the
            // purchasing-cash ledger always mirrors the settlement ledger and
            // sums exactly to the order's rider-financed amount.
            foreach ($this->settlements->businessBases($order) as $businessId => $base) {
                $key = (string) $businessId;
                $allocations->put($key, round((float) $allocations->get($key, 0.0) + $base, 2));
            }
        }

        return $allocations;
    }

    public function submitPurchaseExpense(
        Delivery $delivery,
        CodPurchase $purchase,
        User $rider,
        float $actualAmount,
        float $officeCashUsed,
        float $personalContribution,
        \Illuminate\Http\UploadedFile $receipt
    ): \App\Models\CodPurchaseExpense {
        return $this->cashFunds->submitPurchaseExpense(
            $delivery,
            $purchase,
            $rider,
            $actualAmount,
            $officeCashUsed,
            $personalContribution,
            $receipt
        );
    }

    public function reviewPurchaseExpense(
        Delivery $delivery,
        CodPurchase $purchase,
        \App\Models\CodPurchaseExpense $expense,
        User $officer,
        bool $approve,
        ?string $reason = null
    ): \App\Models\CodPurchaseExpense {
        return $this->cashFunds->reviewPurchaseExpense($delivery, $purchase, $expense, $officer, $approve, $reason);
    }

    /**
     * Per-business preparation time (minutes) for a delivery, computed from
     * the order-time item snapshots (order_items.preparation_time), grouped by
     * the restaurant fulfilling each item. Used to order the pickup route:
     * the restaurant that finishes preparing soonest is picked up first, and
     * the last restaurant (longest prep) becomes the drop-off route origin.
     *
     * @return array<int, int> business_id => prep minutes (0 when unknown)
     */
    public function businessPrepTimes(Delivery $delivery): array
    {
        $map = [];

        foreach ($delivery->childOrders() as $order) {
            foreach ($order->items()->get() as $item) {
                $businessId = (int) ($item->business_id ?: $order->business_id);
                $prep = (int) ($item->preparation_time ?? 0);
                $map[$businessId] = max($map[$businessId] ?? 0, $prep);
            }
        }

        return $map;
    }

    /**
     * The grouped pickup route for ANY delivery, COD or prepaid: every
     * restaurant that fulfils items on this trip, in ascending preparation
     * time (shortest prep picked up first), with the longest-prep restaurant
     * exposed as the drop-off route origin and the tourist destination as the
     * drop-off point. COD stops additionally carry their cod_purchases ledger
     * row so the purchasing-cash flow and the ALL-COLLECTED gate keep working
     * unchanged (see the full payload shape in RIDER_PICKUP_ROUTE fields).
     *
     * @return array<string, mixed>
     */
    public function pickupRoute(Delivery $delivery): array
    {
        return [
            'delivery_id' => $delivery->id,
            'is_cod' => $this->isCod($delivery),
            'stops' => $this->routeStops($delivery)->map(function (array $entry) {
                $purchase = $entry['cod_purchase'];

                return [
                    'business_id' => $entry['business_id'],
                    'business_name' => $entry['business_name'],
                    'sequence' => $entry['sequence'],
                    'preparation_time' => $entry['preparation_time'],
                    'pickup_lat' => $entry['pickup_latitude'],
                    'pickup_lng' => $entry['pickup_longitude'],
                    'pickup_address' => $entry['pickup_address'],
                    'cod_purchase' => $purchase ? [
                        'id' => $purchase->id,
                        'purchase_number' => $purchase->purchase_number,
                        'purchase_amount' => (float) $purchase->purchase_amount,
                        'status' => $purchase->status,
                        'purchased_at' => $purchase->purchased_at,
                        'collected_at' => $purchase->collected_at,
                    ] : null,
                ];
            })->values(),
            'pickup_origin' => $this->pickupOrigin($delivery),
            'dropoff' => [
                'latitude' => $delivery->delivery_latitude !== null ? (float) $delivery->delivery_latitude : null,
                'longitude' => $delivery->delivery_longitude !== null ? (float) $delivery->delivery_longitude : null,
                'address' => $delivery->delivery_address,
            ],
        ];
    }

    /**
     * Payment-agnostic per-restaurant pickup stops for a delivery, derived
     * from the order-item snapshots. This is the single canonical derivation
     * for COD (which adds the cod_purchases ledger row per stop) AND prepaid
     * multi-restaurant trips.
     *
     * Drive order (docs/dispatch-escalation-plan.md §2): the restaurant
     * FARTHEST from the tourist is stop 1, then farther → nearer. The order
     * planned before dispatch (deliveries.pickup_sequence, PickupSequencePlanner)
     * is authoritative; restaurants missing from it (or an unplanned legacy
     * delivery) are ordered farthest-first by straight-line distance.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function routeStops(Delivery $delivery): Collection
    {
        $prepTimes = $this->businessPrepTimes($delivery);
        $businesses = [];

        foreach ($delivery->childOrders() as $order) {
            $orderBusiness = $order->business;
            foreach ($order->items()->with('business')->get() as $item) {
                $businessId = (int) ($item->business_id ?: $order->business_id);
                if ($businessId <= 0) {
                    continue;
                }
                $businesses[$businessId] ??= $item->business ?? $orderBusiness;
            }
        }

        if (empty($businesses)) {
            return collect();
        }

        $planned = array_values(array_filter(
            array_map('intval', (array) ($delivery->pickup_sequence ?? [])),
            fn (int $id) => isset($businesses[$id])
        ));
        $dropLat = $delivery->delivery_latitude !== null ? (float) $delivery->delivery_latitude : null;
        $dropLng = $delivery->delivery_longitude !== null ? (float) $delivery->delivery_longitude : null;
        $distanceFromDropoff = function (int $id) use ($businesses, $dropLat, $dropLng): float {
            $b = $businesses[$id];
            if ($dropLat === null || $dropLng === null || $b?->latitude === null || $b?->longitude === null) {
                return -1.0;
            }

            return app(DeliveryFeeService::class)->calculateFallbackDistance((float) $b->latitude, (float) $b->longitude, $dropLat, $dropLng);
        };
        $unplanned = collect(array_keys($businesses))
            ->reject(fn (int $id) => in_array($id, $planned, true))
            ->sort(fn (int $a, int $b) => [$distanceFromDropoff($b), $a] <=> [$distanceFromDropoff($a), $b])
            ->values();

        $orderedIds = collect($planned)->concat($unplanned)->values();

        $purchases = $this->isCod($delivery)
            ? $delivery->codPurchases->keyBy(fn (CodPurchase $p) => (int) $p->business_id)
            : collect();

        $sequence = 0;

        return $orderedIds->map(function (int $businessId) use (&$sequence, $prepTimes, $businesses, $purchases) {
            $sequence++;
            $business = $businesses[$businessId];

            return [
                'business_id' => $businessId,
                'business_name' => $business->business_name ?? $business->name,
                'sequence' => $sequence,
                'preparation_time' => $prepTimes[$businessId] ?? 0,
                'pickup_latitude' => $business->latitude !== null ? (float) $business->latitude : null,
                'pickup_longitude' => $business->longitude !== null ? (float) $business->longitude : null,
                'pickup_address' => $business->address,
                'cod_purchase' => $purchases->get($businessId),
            ];
        });
    }

    /**
     * Per-restaurant pickup stops in drive order (farthest from the tourist
     * first — the route the rider drives), each annotated with its sequence, prep time and
     * restaurant pickup coordinates/address. COD-only: every stop carries its
     * cod_purchases ledger row (the controller's cash-flow panel consumes it).
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function pickupStops(Delivery $delivery): Collection
    {
        return $this->routeStops($delivery)
            ->filter(fn (array $entry) => $entry['cod_purchase'] !== null)
            ->map(function (array $entry) {
                $purchase = $entry['cod_purchase'];

                return [
                    'stop' => $purchase,
                    'sequence' => $entry['sequence'],
                    'preparation_time' => $entry['preparation_time'],
                    'pickup_latitude' => $entry['pickup_latitude'],
                    'pickup_longitude' => $entry['pickup_longitude'],
                    'pickup_address' => $entry['pickup_address'],
                ];
            })
            ->values();
    }

    /**
     * The LAST restaurant the rider picks up (longest preparation time). Per
     * the route model this is the pickup point the drop-off route originates
     * from. Works for COD and prepaid alike.
     *
     * @return array<string, mixed>|null
     */
    public function pickupOrigin(Delivery $delivery): ?array
    {
        $entry = $this->routeStops($delivery)->last();

        if (! $entry) {
            return null;
        }

        return [
            'business_id' => $entry['business_id'],
            'business_name' => $entry['business_name'],
            'latitude' => $entry['pickup_latitude'],
            'longitude' => $entry['pickup_longitude'],
            'address' => $entry['pickup_address'],
        ];
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

    /**
     * Daily cash advance (decision 2026-11-08): a COD delivery draws on the
     * rider's open Tourism Office cash fund instead of a per-delivery issue.
     * Links the fund and records the purchase total as the delivery's
     * purchasing cash (no new cash-issued ledger row: the advance already
     * counted that money). No-op for prepaid, unassigned, already-linked
     * deliveries, or when no advance is recorded yet. Returns true if linked.
     */
    public function linkDailyAdvance(Delivery $delivery): bool
    {
        if (! $this->isCod($delivery) || ! $delivery->rider_id || $delivery->rider_cash_fund_id !== null) {
            return false;
        }

        $fundId = RiderCashFund::query()
            ->where('active_rider_key', $delivery->rider_id)
            ->where('status', RiderCashFund::STATUS_OPEN)
            ->value('id');
        if (! $fundId) {
            return false;
        }

        $this->initializeForDelivery($delivery);
        $total = round((float) CodPurchase::query()->where('delivery_id', $delivery->id)->sum('purchase_amount'), 2);

        $linked = Delivery::query()
            ->whereKey($delivery->id)
            ->whereNull('rider_cash_fund_id')
            ->update([
                'rider_cash_fund_id' => $fundId,
                'purchasing_cash' => $total,
                'purchasing_cash_issued_at' => $delivery->purchasing_cash_issued_at ?? now(),
                'purchasing_cash_received_at' => $delivery->purchasing_cash_received_at ?? now(),
            ]);

        return $linked > 0;
    }

    public function assertCashReceived(Delivery $delivery): void
    {
        $this->assertIssued($delivery);

        if ($delivery->purchasing_cash_received_at === null) {
            throw new InvalidArgumentException('Confirm receipt of the purchasing cash before purchasing food.');
        }

        if (RiderCashFundTransaction::query()
            ->where('rider_cash_fund_id', $delivery->rider_cash_fund_id)
            ->where('delivery_id', $delivery->id)
            ->whereIn('type', [
                RiderCashFundTransaction::TYPE_CASH_ISSUED,
                RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED,
            ])
            ->whereNull('received_at')
            ->exists()) {
            throw new InvalidArgumentException('Confirm receipt of all purchasing-cash issuances before purchasing food.');
        }
    }

    private function assertRiderOwnership(Delivery $delivery, int $riderId): void
    {
        if ((int) ($delivery->rider_id ?? 0) !== $riderId) {
            throw new InvalidArgumentException('You are not assigned to this delivery.');
        }
    }
}