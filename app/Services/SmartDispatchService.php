<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Order;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class SmartDispatchService
{
    private const DEFAULT_PICKUP_BUFFER_SECONDS = 120; // 2 minutes

    private const DEFAULT_RIDER_ETA_SECONDS = 480; // 8 minutes fallback

    public function __construct(
        private NearestRiderService $nearestRiderService,
    ) {}

    /**
     * Calculate the optimal dispatch time for an order based on predicted
     * preparation time and rider ETA.
     *
     * dispatch_time = estimated_ready_at - rider_eta - pickup_buffer
     */
    public function calculateDispatchTime(Order $order): ?\Carbon\Carbon
    {
        if (! $order->predicted_ready_at) {
            return null;
        }

        $riderEta = $this->estimateRiderEta($order);
        $buffer = $order->pickup_buffer_seconds ?? self::DEFAULT_PICKUP_BUFFER_SECONDS;

        $dispatchTime = $order->predicted_ready_at->copy()
            ->subSeconds($riderEta)
            ->subSeconds($buffer);

        // Don't dispatch in the past
        if ($dispatchTime->isPast()) {
            return now()->addSeconds(30); // Small buffer to avoid immediate dispatch
        }

        return $dispatchTime;
    }

    /**
     * Estimate rider ETA to the restaurant for this order.
     */
    public function estimateRiderEta(Order $order): int
    {
        $business = $order->business;
        if (! $business?->latitude || ! $business?->longitude) {
            return self::DEFAULT_RIDER_ETA_SECONDS;
        }

        try {
            $riders = $this->nearestRiderService->findNearestAvailableRiders(
                (float) $business->latitude,
                (float) $business->longitude,
                'food',
                1,
                $business->municipality_id,
            );

            if ($riders->isEmpty()) {
                return self::DEFAULT_RIDER_ETA_SECONDS;
            }

            $nearest = $riders->first();
            $etaMinutes = $nearest->pivot->eta_minutes ?? 8;

            return $etaMinutes * 60;
        } catch (\Exception $e) {
            return self::DEFAULT_RIDER_ETA_SECONDS;
        }
    }

    /**
     * Schedule or immediately dispatch a rider for an accepted order.
     *
     * If the calculated dispatch time is in the future, the delivery record
     * is created with dispatch_status='scheduled'. The scheduler/queue will
     * pick it up at the right time.
     *
     * If dispatch time is now or past, dispatch immediately.
     *
     * The one-order ⇒ one-delivery invariant is enforced at the transaction
     * level: the order row is locked and existence re-checked before creation,
     * and UNIQUE(deliveries.order_id) is the schema backstop.
     */
    public function scheduleDispatch(Order $order): void
    {
        if ($order->order_type !== 'delivery') {
            return;
        }

        if ($order->group_order_id !== null) {
            // Group sub-orders ride on the group's single physical delivery.
            // They must never spawn their own per-restaurant delivery.
            return;
        }

        try {
            DB::transaction(function () use ($order) {
                $lockedOrder = Order::with('business')->lockForUpdate()->find($order->id);

                if (! $lockedOrder) {
                    return;
                }

                if ($lockedOrder->delivery()->exists()) {
                    return; // Already has a delivery
                }

                $business = $lockedOrder->business;
                if (! $business) {
                    return;
                }

                $dispatchTime = $this->calculateDispatchTime($lockedOrder) ?? now();
                $riderEta = $this->estimateRiderEta($lockedOrder);

                $lockedOrder->update([
                    'dispatch_scheduled_at' => $dispatchTime,
                    'rider_eta_seconds' => $riderEta,
                    'pickup_buffer_seconds' => $lockedOrder->pickup_buffer_seconds ?? self::DEFAULT_PICKUP_BUFFER_SECONDS,
                ]);

                // Create the delivery record (will be dispatched at the right time)
                $delivery = Delivery::create([
                    'order_id' => $lockedOrder->id,
                    'delivery_fee' => $lockedOrder->delivery_fee,
                    'distance_km' => $lockedOrder->delivery_distance_km,
                    'estimated_duration_minutes' => $lockedOrder->delivery_duration_minutes,
                    'status' => 'waiting',
                    'dispatch_status' => $dispatchTime->isPast() || $dispatchTime->eq(now())
                        ? 'waiting_for_rider'
                        : 'scheduled',
                    'scheduled_at' => $dispatchTime,
                    'pickup_address' => $business->address ?? $business->name,
                    'pickup_latitude' => $business->latitude,
                    'pickup_longitude' => $business->longitude,
                    'delivery_address' => $lockedOrder->delivery_address,
                    'delivery_latitude' => $lockedOrder->delivery_latitude,
                    'delivery_longitude' => $lockedOrder->delivery_longitude,
                    'rider_commission' => 40.00,
                ]);

                // If dispatch time is now or past, dispatch immediately
                if ($dispatchTime->isPast() || $dispatchTime->lte(now())) {
                    $this->dispatchNow($lockedOrder, $delivery);
                }
                // Otherwise, the scheduled task will dispatch at the right time
            });
        } catch (UniqueConstraintViolationException $e) {
            // A concurrent path created the delivery first; UNIQUE(order_id)
            // is the backstop — the order already has its delivery.
        }
    }

    /**
     * Dispatch a rider immediately for an order.
     *
     * The delivery row is locked and re-checked before the offer is created so
     * a manual dispatch-on-ready cannot race the scheduler and produce two
     * dispatch waves: if a rider already claimed the delivery, or an offer is
     * already pending ('notified') or another claim is in flight ('dispatching'),
     * this is a no-op.
     */
    public function dispatchNow(Order $order, Delivery $delivery): void
    {
        $business = $order->business;
        if (! $business?->latitude || ! $business?->longitude) {
            return;
        }

        $order->update(['dispatch_started_at' => now()]);

        try {
            DB::transaction(function () use ($order, $delivery, $business) {
                $lockedDelivery = Delivery::with('order')->lockForUpdate()->find($delivery->id);

                if (! $lockedDelivery || $lockedDelivery->rider_id !== null) {
                    return; // Already claimed by a rider.
                }

                if (in_array($lockedDelivery->dispatch_status, ['notified', 'dispatching'], true)) {
                    return; // An offer is pending or a scheduler claim is in flight.
                }

                $this->nearestRiderService->dispatchToNearest(
                    $lockedDelivery,
                    'food',
                    $business->municipality_id,
                );
            });
        } catch (\Exception $e) {
            Log::warning('Smart dispatch failed', [
                'order_id' => $order->id,
                'delivery_id' => $delivery->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Get or create the single physical delivery for a group checkout.
     *
    * One group checkout => ONE delivery. The delivery references the single
    * canonical order and retains the group anchor for checkout lookups.
     */
    public function createOrGetGroupDelivery(GroupCheckout $group): ?Delivery
    {
        $existing = $group->delivery;
        if ($existing) {
            return $existing;
        }

        try {
            return DB::transaction(function () use ($group) {
                $lockedGroup = GroupCheckout::with('orders.business')->lockForUpdate()->find($group->id);

                if (! $lockedGroup || $lockedGroup->order_type !== 'delivery') {
                    return null;
                }

                if ($lockedGroup->delivery()->exists()) {
                    return $lockedGroup->delivery;
                }

                $orders = $lockedGroup->orders()
                    ->where('order_type', 'delivery')
                    ->orderBy('id')
                    ->get();

                if ($orders->isEmpty()) {
                    return null;
                }

                $pickupBusiness = $orders->first()->business;
                if (! $pickupBusiness) {
                    return null;
                }

                return Delivery::create([
                    'group_checkout_id' => $lockedGroup->id,
                    'order_id' => $orders->first()->id,
                    'delivery_fee' => (float) $orders->first()->delivery_fee,
                    'distance_km' => $orders->max(fn (Order $o) => (float) $o->delivery_distance_km) ?? null,
                    'estimated_duration_minutes' => $orders->max(fn (Order $o) => (int) $o->delivery_duration_minutes) ?? null,
                    'status' => 'waiting',
                    'dispatch_status' => 'waiting_for_rider',
                    'scheduled_at' => now(),
                    'pickup_address' => $pickupBusiness->address ?? $pickupBusiness->name,
                    'pickup_latitude' => $pickupBusiness->latitude,
                    'pickup_longitude' => $pickupBusiness->longitude,
                    'delivery_address' => $lockedGroup->delivery_address,
                    'delivery_latitude' => $lockedGroup->delivery_latitude,
                    'delivery_longitude' => $lockedGroup->delivery_longitude,
                    'rider_commission' => 40.00,
                ]);
            });
        } catch (UniqueConstraintViolationException $e) {
            // Lost race: a concurrent path created the group delivery first.
            return $group->fresh()->delivery;
        }
    }

    /**
     * Dispatch a rider immediately for a group's single physical delivery.
     *
     * Group deliveries dispatch immediately (COD groups at creation, GCash
     * groups once paid): the rider collects from every restaurant in one trip.
     */
    public function scheduleGroupDispatch(GroupCheckout $group): void
    {
        if ($group->order_type !== 'delivery') {
            return;
        }

        $delivery = $this->createOrGetGroupDelivery($group);
        if (! $delivery) {
            return;
        }

        $business = $delivery->primaryOrder()?->business;

        $this->dispatchGroupNow($delivery, $business?->municipality_id);
    }

    /**
     * Same claim-protection as dispatchNow(), but for group deliveries which
     * have no parent order row.
     */
    public function dispatchGroupNow(Delivery $delivery, ?int $municipalityId): void
    {
        try {
            DB::transaction(function () use ($delivery, $municipalityId) {
                $lockedDelivery = Delivery::with('order', 'groupCheckout')->lockForUpdate()->find($delivery->id);

                if (! $lockedDelivery || $lockedDelivery->rider_id !== null) {
                    return; // Already claimed by a rider.
                }

                if (in_array($lockedDelivery->dispatch_status, ['notified', 'dispatching'], true)) {
                    return; // An offer is pending or a scheduler claim is in flight.
                }

                $this->nearestRiderService->dispatchToNearest(
                    $lockedDelivery,
                    'food',
                    $municipalityId,
                );
            });
        } catch (\Exception $e) {
            Log::warning('Group smart dispatch failed', [
                'group_checkout_id' => $delivery->group_checkout_id,
                'delivery_id' => $delivery->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
