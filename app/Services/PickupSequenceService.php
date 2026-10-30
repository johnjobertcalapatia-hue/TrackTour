<?php

namespace App\Services;

use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\RiderLocation;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Payment-agnostic per-restaurant pickup sequence for a delivery.
 *
 * The delivery trip is a message-driven flow:
 *
 *     rider accepts → route to stop 1 → (within radius AND restaurant READY)
 *         → "Confirm Item Pickup" → route to stop 2 → … → last stop confirmed
 *         → route to the tourist's address → delivered → payment settled
 *         → rider available again
 *
 * This service owns the per-restaurant confirmation ledger
 * (delivery_pickup_stops, one row per fulfilling restaurant) and the gate
 * EVERY "Confirm Item Pickup" must pass:
 *
 *     CAN_CONFIRM_PICKUP =
 *         stop is the current (next unconfirmed) stop in route order
 *         AND the rider has confirmed arrival and remains within the configured
 *         pickup radius
 *         AND that restaurant's order items are all READY
 *
 * The delivered state and the COD purchasing-cash money ledger
 * (cod_purchases) are untouched; for COD the two move together. The delivery
 * may not leave the pickup area (picked_up) until every stop is confirmed.
 */
class PickupSequenceService
{
    /** Pickup stages during which the rider may confirm restaurant stops. */
    public const PICKUP_STAGE_STATUSES = ['assigned', 'en_route_pickup', 'arrived_pickup'];

    /**
     * Idempotently seed one delivery_pickup_stops row per fulfilling
     * restaurant, in drive order (ascending preparation time). Transport rides
     * and item-less deliveries seed nothing. Stops never overwrite existing
     * rows, so re-confirms and re-reads are harmless.
     */
    public function ensureStops(Delivery $delivery): void
    {
        $primaryOrder = $delivery->primaryOrder();

        if (! $primaryOrder || (string) $primaryOrder->order_type !== 'delivery') {
            return;
        }

        $routeStops = app(PurchasingCashService::class)->routeStops($delivery);

        if ($routeStops->isEmpty()) {
            return;
        }

        $existing = DeliveryPickupStop::where('delivery_id', $delivery->id)
            ->pluck('business_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        foreach ($routeStops as $entry) {
            $businessId = (int) $entry['business_id'];
            if (in_array($businessId, $existing, true)) {
                continue;
            }

            DeliveryPickupStop::create([
                'delivery_id' => $delivery->id,
                'order_id' => $primaryOrder->id,
                'business_id' => $businessId,
                'sequence' => (int) $entry['sequence'],
                'preparation_time' => $entry['preparation_time'] !== null ? (int) $entry['preparation_time'] : null,
                'pickup_latitude' => $entry['pickup_latitude'],
                'pickup_longitude' => $entry['pickup_longitude'],
                'pickup_address' => $entry['pickup_address'],
                'status' => DeliveryPickupStop::STATUS_PENDING,
            ]);
        }
    }

    /**
     * Ordered stops for the delivery (seeded lazily).
     *
     * @return Collection<int, DeliveryPickupStop>
     */
    public function stops(Delivery $delivery): Collection
    {
        $this->ensureStops($delivery);

        return DeliveryPickupStop::where('delivery_id', $delivery->id)
            ->orderBy('sequence')
            ->get();
    }

    /**
     * The next stop in route order that has not been confirmed yet (the one
     * the rider may currently confirm).
     */
    public function currentStop(Delivery $delivery): ?DeliveryPickupStop
    {
        return $this->stops($delivery)->first(
            fn (DeliveryPickupStop $stop) => ! $this->stopConfirmed($delivery, $stop)
        );
    }

    /**
     * A stop counts as confirmed when its pickup row is collected OR (COD) the
     * matching cod_purchases row is collected — the two ledgers stay in step.
     */
    public function stopConfirmed(Delivery $delivery, DeliveryPickupStop $stop): bool
    {
        if ($stop->status === DeliveryPickupStop::STATUS_COLLECTED) {
            return true;
        }

        if (app(NearestRiderService::class)->isCodDelivery($delivery)) {
            return $delivery->codPurchases
                ->firstWhere('business_id', (int) $stop->business_id)?->status === CodPurchase::STATUS_COLLECTED;
        }

        return false;
    }

    /**
     * True when every restaurant stop is confirmed (or the delivery has no
     * stops at all, e.g. transport / item-less). Precondition for picked_up.
     */
    public function allConfirmed(Delivery $delivery): bool
    {
        $stops = $this->stops($delivery);

        if ($stops->isEmpty()) {
            return true;
        }

        return $stops->every(fn (DeliveryPickupStop $stop) => $this->stopConfirmed($delivery, $stop));
    }

    /**
     * Whether the restaurant whose items are picked up here is READY: every
     * non-cancelled/rejected item belonging to the restaurant is 'ready'. A
     * stop with no active items left is considered ready (nothing to wait for).
     */
    public function businessReady(Delivery $delivery, int $businessId): bool
    {
        return $this->businessReadiness($delivery, $businessId)['ready'];
    }

    /**
     * Readiness detail for a restaurant, derived from the order-item snapshots.
     *
     * label: 'ready' | 'preparing' | 'accepted' | 'none' (no active items)
     *
     * @return array{ready: bool, label: string, ready_item_count: int, active_item_count: int}
     */
    public function businessReadiness(Delivery $delivery, int $businessId): array
    {
        $items = $this->itemsForBusiness($delivery, $businessId);

        $active = $items->reject(fn ($item) => in_array($item->status, ['cancelled', 'rejected'], true));

        if ($active->isEmpty()) {
            return ['ready' => true, 'label' => 'none', 'ready_item_count' => 0, 'active_item_count' => 0];
        }

        $readyCount = $active->where('status', 'ready')->count();
        $isReady = $readyCount === $active->count();

        $label = $isReady
            ? 'ready'
            : ($active->where('status', 'preparing')->count() > 0 ? 'preparing' : 'accepted');

        return [
            'ready' => $isReady,
            'label' => $label,
            'ready_item_count' => $readyCount,
            'active_item_count' => $active->count(),
        ];
    }

    /**
     * The restaurant's live (non-cancelled/rejected) order items, grouped by
     * each item's own business_id (falls back to the order's business).
     */
    private function itemsForBusiness(Delivery $delivery, int $businessId): Collection
    {
        $items = collect();

        foreach ($delivery->childOrders() as $order) {
            foreach ($order->items()->get() as $item) {
                $itemBusinessId = (int) ($item->business_id ?: $order->business_id);
                if ($itemBusinessId === $businessId) {
                    $items->push($item);
                }
            }
        }

        return $items;
    }

    /**
     * The rider's most recent reported location, if any.
     *
     * @return array{latitude: float, longitude: float, recorded_at: \Illuminate\Support\Carbon}|null
     */
    public function latestRiderLocation(int $riderId): ?array
    {
        $location = RiderLocation::where('rider_id', $riderId)->latest('recorded_at')->first();

        if (! $location) {
            return null;
        }

        return [
            'latitude' => (float) $location->latitude,
            'longitude' => (float) $location->longitude,
            'recorded_at' => $location->recorded_at,
        ];
    }

    public function distanceMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371000;

        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /**
     * Distance from the rider's latest location to the stop, if measurable.
     */
    public function stopDistanceMeters(Delivery $delivery, DeliveryPickupStop $stop): ?float
    {
        $location = $this->latestRiderLocation((int) $delivery->rider_id);

        if (! $location || $stop->pickup_latitude === null || $stop->pickup_longitude === null) {
            return null;
        }

        return $this->distanceMeters(
            $location['latitude'],
            $location['longitude'],
            (float) $stop->pickup_latitude,
            (float) $stop->pickup_longitude,
        );
    }

    /**
     * Gate evaluation for one stop — mirrors CAN_CONFIRM_PICKUP. Stops without
     * coordinates cannot satisfy the server-enforced pickup geofence.
     *
     * @return array{can_confirm: bool, reason: string|null, distance_meters: float|null}
     */
    public function confirmability(Delivery $delivery, DeliveryPickupStop $stop): array
    {
        $confirmed = $this->stopConfirmed($delivery, $stop);
        $current = $this->currentStop($delivery);

        $distance = $this->stopDistanceMeters($delivery, $stop);
        $hasCoords = $stop->pickup_latitude !== null && $stop->pickup_longitude !== null;

        if ($confirmed) {
            return ['can_confirm' => false, 'reason' => 'already_confirmed', 'distance_meters' => $distance];
        }

        $isCurrent = $current?->id === $stop->id;

        $withinRadius = ! $hasCoords
            ? false
            : ($distance !== null
                ? $distance <= (float) config('tracking.pickup_radius_meters', 50)
                : false);

        $readiness = $this->businessReadiness($delivery, (int) $stop->business_id);

        if (! $isCurrent) {
            return ['can_confirm' => false, 'reason' => 'not_current', 'distance_meters' => $distance];
        }

        if ($stop->arrived_at === null) {
            return ['can_confirm' => false, 'reason' => 'waiting_arrival', 'distance_meters' => $distance];
        }

        if ($readiness['label'] !== 'ready' && $readiness['label'] !== 'none') {
            return ['can_confirm' => false, 'reason' => 'waiting_ready', 'distance_meters' => $distance];
        }

        if (! $withinRadius) {
            return [
                'can_confirm' => false,
                'reason' => $hasCoords && $distance === null ? 'gps_unavailable' : 'too_far',
                'distance_meters' => $distance,
            ];
        }

        return ['can_confirm' => true, 'reason' => null, 'distance_meters' => $distance];
    }

    /**
     * The rider confirms arrival at the current restaurant stop.
     *
     * The original server timestamp is immutable on retries. Both the shared
     * delivery arrival and per-stop arrival are committed under their locks.
     *
     * @return array{success: bool, arrived_at: string, stop: array<string, mixed>, delivery_status_change: array{old_status: string, new_status: string}|null}
     *
     * @throws InvalidArgumentException
     */
    public function confirmArrival(Delivery $delivery, int $businessId, int $riderId): array
    {
        return DB::transaction(function () use ($delivery, $businessId, $riderId) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked) {
                throw new InvalidArgumentException('Delivery not found.');
            }

            if ((int) $locked->rider_id !== $riderId) {
                throw new InvalidArgumentException('You are not assigned to this delivery.');
            }

            $statusNow = $locked->status->value ?? $locked->status;
            if (! in_array($statusNow, self::PICKUP_STAGE_STATUSES, true)) {
                throw new InvalidArgumentException('Arrival can only be confirmed during the pickup stage.');
            }

            $this->ensureStops($locked);
            $stops = DeliveryPickupStop::where('delivery_id', $locked->id)
                ->orderBy('sequence')
                ->lockForUpdate()
                ->get();
            $stop = $stops->firstWhere('business_id', $businessId);

            if (! $stop) {
                throw new InvalidArgumentException('This restaurant does not fulfil items on this delivery.');
            }

            if ($this->stopConfirmed($locked, $stop)) {
                throw new InvalidArgumentException('This restaurant pickup has already been confirmed.');
            }

            $current = $stops->first(fn (DeliveryPickupStop $entry) => ! $this->stopConfirmed($locked, $entry));
            if (! $current || (int) $current->business_id !== $businessId) {
                throw new InvalidArgumentException('Confirm arrival in route order at the next restaurant stop.');
            }

            $deliveryStatusChange = null;
            if ($stop->arrived_at === null) {
                $distance = $this->stopDistanceMeters($locked, $stop);
                $hasCoordinates = $stop->pickup_latitude !== null && $stop->pickup_longitude !== null;
                $withinRadius = ! $hasCoordinates
                    ? false
                    : ($distance !== null && $distance <= (float) config('tracking.pickup_radius_meters', 50));

                if (! $withinRadius) {
                    throw new InvalidArgumentException(
                        $distance === null
                            ? 'A current GPS location is required to confirm arrival.'
                            : 'You must be within the pickup area to confirm arrival.'
                    );
                }

                $stop->update(['arrived_at' => now()]);
                $deliveryStatusChange = app(PickupDeliveryTransitionService::class)->arriveAtPickup($locked);
            }

            return [
                'success' => true,
                'arrival_changed' => $deliveryStatusChange !== null || $stop->wasChanged('arrived_at'),
                'arrived_at' => $stop->fresh()->arrived_at->toIso8601String(),
                'stop' => $this->stopPayload($locked->fresh(), $stop->fresh()),
                'delivery_status_change' => $deliveryStatusChange,
            ];
        });
    }

    /**
     * The rider confirms they received the order items at one restaurant.
     *
     * Enforces (server-authoritative, under a delivery row lock):
     *   1. the delivery is assigned to this rider and at the pickup stage,
     *   2. the stop is the current (next unconfirmed) stop in route order,
     *   3. the rider is within the configured pickup radius of the restaurant,
     *   4. the restaurant's order items are all READY.
     *
     * For COD the matching cod_purchases row is purchased+collected in the same
     * transaction so the purchasing-cash ledger and the confirmation sequence
     * never drift. Confirming an already-confirmed stop is an idempotent no-op.
     *
     * @return array{success: bool, all_confirmed: bool, stop: array<string, mixed>|null}
     *
     * @throws InvalidArgumentException
     */
    public function confirmStop(Delivery $delivery, int $businessId, int $riderId): array
    {
        return DB::transaction(function () use ($delivery, $businessId, $riderId) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked) {
                throw new InvalidArgumentException('Delivery not found.');
            }

            if ((int) $locked->rider_id !== $riderId) {
                throw new InvalidArgumentException('You are not assigned to this delivery.');
            }

            $isCod = app(NearestRiderService::class)->isCodDelivery($locked);
            if ($isCod) {
                app(PurchasingCashService::class)->assertCashReceived($locked);
            }

            $statusNow = $locked->status->value ?? $locked->status;
            if (! in_array($statusNow, self::PICKUP_STAGE_STATUSES, true)) {
                throw new InvalidArgumentException('Pickups can only be confirmed while at the pickup stage.');
            }

            $this->ensureStops($locked);
            $lockedStops = DeliveryPickupStop::where('delivery_id', $locked->id)
                ->orderBy('sequence')
                ->lockForUpdate()
                ->get();
            $stop = $lockedStops->firstWhere('business_id', $businessId);

            if (! $stop) {
                throw new InvalidArgumentException('This restaurant does not fulfil items on this delivery.');
            }

            $wasConfirmed = $this->stopConfirmed($locked, $stop);
            if (! $wasConfirmed) {
                $current = $lockedStops->first(fn (DeliveryPickupStop $entry) => ! $this->stopConfirmed($locked, $entry));

                if ($current && (int) $current->business_id !== $businessId) {
                    $businessName = $stop->business?->business_name ?? $stop->business?->name ?? ('Business #'.$businessId);
                    throw new InvalidArgumentException('Confirm the pickup in route order. '.$businessName.' is not the next pickup yet.');
                }

                if ($stop->arrived_at === null) {
                    throw new InvalidArgumentException('Confirm your arrival at this restaurant before confirming pickup.');
                }

                $readiness = $this->businessReadiness($locked, $businessId);
                if (! $readiness['ready']) {
                    throw new InvalidArgumentException('Your order is not ready for pickup at this restaurant. Please wait for the restaurant to finish preparing before confirming.');
                }

                $distance = $this->stopDistanceMeters($locked, $stop);
                $hasCoords = $stop->pickup_latitude !== null && $stop->pickup_longitude !== null;

                $withinRadius = ! $hasCoords
                    ? false
                    : ($distance !== null
                        && $distance <= (float) config('tracking.pickup_radius_meters', 50));

                if (! $withinRadius) {
                    throw new InvalidArgumentException('You must be within the pickup area before confirming the order items.');
                }

                $stop->update([
                    'status' => DeliveryPickupStop::STATUS_COLLECTED,
                    'pickup_confirmed_at' => now(),
                ]);
            }

            // Keep the COD purchasing-cash ledger in step with the pickup
            // confirmation (purchased → collected atomically).
            if ($isCod) {
                $purchase = CodPurchase::where('delivery_id', $locked->id)
                    ->where('business_id', $businessId)
                    ->lockForUpdate()
                    ->first();

                if ($purchase) {
                    if ($purchase->status === CodPurchase::STATUS_PENDING) {
                        $purchase->update([
                            'status' => CodPurchase::STATUS_PURCHASED,
                            'purchased_at' => now(),
                        ]);
                        $purchase->refresh();
                    }

                    if ($purchase->status !== CodPurchase::STATUS_COLLECTED) {
                        $purchase->update([
                            'status' => CodPurchase::STATUS_COLLECTED,
                            'collected_at' => now(),
                        ]);
                    }
                }
            }

            $locked->unsetRelation('codPurchases');
            $allConfirmed = $this->allConfirmed($locked);
            $deliveryStatusChange = null;

            if ($allConfirmed) {
                $deliveryStatusChange = app(PickupDeliveryTransitionService::class)->pickUp($locked);
                if (! $deliveryStatusChange) {
                    throw new InvalidArgumentException(
                        'The delivery cannot leave the pickup stage until all pickup and COD checks pass.'
                    );
                }
            }

            // Capture the ACTUAL pickup GPS point from the rider's latest fix
            // the moment the full pickup sequence completes. This is the
            // authoritative "food was picked up here" coordinate for the
            // tourist's live tracking map (pickup point -> drop-off route). It is
            // deliberately separate from pickup_latitude/longitude (the planned
            // point used by dispatch, fees, offers and the pickup geofence) and
            // is written once, never overwritten.
            if ($allConfirmed && $locked->pickup_actual_latitude === null && $locked->rider_id) {
                $location = RiderLocation::where('rider_id', $locked->rider_id)
                    ->latest('recorded_at')
                    ->first();

                if ($location) {
                    $locked->update([
                        'pickup_actual_latitude' => $location->latitude,
                        'pickup_actual_longitude' => $location->longitude,
                        'pickup_actual_at' => now(),
                    ]);
                }
            }

            return [
                'success' => true,
                'stop_changed' => ! $wasConfirmed,
                'all_confirmed' => $allConfirmed,
                'stop' => $this->stopPayload($locked, $stop->fresh()),
                'delivery_status_change' => $deliveryStatusChange,
            ];
        });
    }

    /**
     * Single-stop payload for the API (status, readiness, confirmability).
     *
     * @return array<string, mixed>
     */
    public function stopPayload(Delivery $delivery, DeliveryPickupStop $stop): array
    {
        $confirmability = $this->confirmability($delivery, $stop->fresh());
        $readiness = $this->businessReadiness($delivery, (int) $stop->business_id);

        return [
            'id' => $stop->id,
            'business_id' => (int) $stop->business_id,
            'business_name' => $stop->business?->business_name ?? $stop->business?->name,
            'sequence' => (int) $stop->sequence,
            'preparation_time' => $stop->preparation_time !== null ? (int) $stop->preparation_time : null,
            'pickup_lat' => $stop->pickup_latitude !== null ? (float) $stop->pickup_latitude : null,
            'pickup_lng' => $stop->pickup_longitude !== null ? (float) $stop->pickup_longitude : null,
            'pickup_address' => $stop->pickup_address,
            'arrived_at' => $stop->arrived_at?->toIso8601String(),
            'waiting_seconds' => $stop->arrived_at
                ? (int) $stop->arrived_at->diffInSeconds($stop->pickup_confirmed_at ?? now())
                : null,
            'status' => $this->stopConfirmed($delivery, $stop) ? DeliveryPickupStop::STATUS_COLLECTED : DeliveryPickupStop::STATUS_PENDING,
            'pickup_confirmed_at' => $stop->pickup_confirmed_at,
            'is_ready' => $readiness['ready'],
            'ready_label' => $readiness['label'],
            'ready_item_count' => $readiness['ready_item_count'],
            'active_item_count' => $readiness['active_item_count'],
            'distance_meters' => $confirmability['distance_meters'] !== null ? round($confirmability['distance_meters'], 0) : null,
            'can_confirm' => $confirmability['can_confirm'],
            'reason' => $confirmability['reason'],
            'arrival_can_confirm' => $stop->arrived_at === null
                && ! $this->stopConfirmed($delivery, $stop)
                && $this->currentStop($delivery)?->id === $stop->id
                && $confirmability['distance_meters'] !== null
                && $confirmability['distance_meters'] <= (float) config('tracking.pickup_radius_meters', 50),
            'arrival_reason' => $stop->arrived_at !== null
                ? null
                : ($this->currentStop($delivery)?->id !== $stop->id
                    ? 'not_current'
                    : ($confirmability['distance_meters'] === null
                        ? 'gps_unavailable'
                        : ($confirmability['distance_meters'] > (float) config('tracking.pickup_radius_meters', 50) ? 'too_far' : null))),
        ];
    }

    /**
     * The current stop's payload plus the full-drive result after a confirm.
     *
     * @return array<string, mixed>
     */
    public function currentStopPayload(Delivery $delivery): ?array
    {
        $current = $this->currentStop($delivery);

        return $current ? $this->stopPayload($delivery, $current) : null;
    }
}