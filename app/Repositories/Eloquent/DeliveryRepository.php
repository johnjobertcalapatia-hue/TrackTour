<?php

namespace App\Repositories\Eloquent;

use App\Enums\TripStatus;
use App\Models\Delivery;
use App\Models\RiderLocation;
use App\Repositories\Contracts\DeliveryRepositoryInterface;
use App\Services\NearestRiderService;
use App\Services\ScheduledDispatchProcessor;
use App\Services\SequentialDispatchService;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class DeliveryRepository implements DeliveryRepositoryInterface
{
    /**
     * Statuses shown in the rider's active-deliveries list. 'delivered' stays
     * visible so a COD delivery awaiting cash settlement can be completed there.
     */
    const ACTIVE_FOR_SETTLEMENT = [
        'assigned',
        'en_route_pickup',
        'arrived_pickup',
        'tour_started',
        'en_route_destination',
        'arrived_destination',
        'delivered',
    ];

    public function __construct(
        protected Delivery $model,
    ) {}

    public function findById(int $id): ?Delivery
    {
        return $this->model->with(['order.business', 'rider', 'tripLog'])->find($id);
    }

    public function getByRider(int $riderId, ?string $status = null, int $perPage = 15): LengthAwarePaginator
    {
        $query = $this->model->with(['order.business'])
            ->where('rider_id', $riderId);

        if ($status) {
            $query->where('status', $status);
        }

        return $query->latest()->paginate($perPage);
    }

    /**
     * Deliveries the rider may act on from the booking page ("Available
     * Deliveries / Bookings"): their own live ping offers PLUS every OPEN
     * delivery no rider has claimed yet. Business rule: an order must stay
     * visible and claimable even when its ping wave expired or parked at
     * no_rider_available — visibility must never depend on this specific
     * rider having been pinged at placement time.
     *
     * Acceptance itself is enforced server-side in
     * NearestRiderService::handleRiderResponse() (direct-claim branch): any
     * eligible rider may claim an open delivery, first accept wins, and a
     * rider with an active delivery must finish it first.
     *
     * Dispatch Stage 3 (docs/dispatch-escalation-plan.md): a food delivery
     * still in its sequential targeted phase is NOT on the open board; only
     * the rider holding the live targeted offer sees it (pinged list). It
     * appears for everyone in range once it reaches the manual phase (after
     * 4 targeted offers, or no eligible rider). Order: this rider's own
     * offers first, then the board nearest first by distance to the first
     * pickup (deliveries.pickup_* = first stop, PickupSequencePlanner);
     * rows without a distance last, oldest first.
     */
    public function getPendingDeliveries(int $riderId, int $limit = 20): Collection
    {
        $location = $this->latestLocation($riderId);
        $distances = [];

        // Ride Hailing riders see only ride bookings (Available Bookings);
        // Food Delivery riders only food orders (Available Deliveries).
        $rides = \App\Models\RiderDetail::where('user_id', $riderId)->value('current_service') === 'transport';
        $forService = fn (Delivery $d) => ($d->order?->order_type === 'transport') === $rides;

        $pinged = $this->model->with(['order.business'])
            ->where('status', TripStatus::WAITING)
            ->whereHas('dispatchLogs', function ($query) use ($riderId) {
                $query->where('rider_id', $riderId)
                    ->where('response', 'pending');
            })
            ->orderBy('created_at')
            ->get()
            ->filter($forService)
            ->values();

        $open = $this->model->with(['order.business'])
            ->where('status', TripStatus::WAITING)
            ->whereNull('rider_id')
            ->whereIn('dispatch_status', NearestRiderService::OPEN_DISPATCH_STATUSES)
            ->where(fn ($q) => $q->whereNull('dispatch_phase')
                ->orWhere('dispatch_phase', '!=', SequentialDispatchService::PHASE_TARGETED))
            ->whereHas('order', function ($query) {
                $query->whereIn('status', ScheduledDispatchProcessor::DISPATCHABLE_ORDER_STATUSES)
                    ->orWhere(fn ($q) => $q->where('order_type', 'transport')->where('status', 'pending'));
            })
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->each(function (Delivery $delivery) use ($location, &$distances) {
                $distances[$delivery->id] = $this->distanceFrom($location, $delivery);
            })
            // No GPS fix yet: keep the row visible (acceptance enforces the
            // location eligibility gate server-side).
            ->filter(fn (Delivery $d) => $distances[$d->id] === null || $distances[$d->id] <= 25.0)
            // Nearest first; unknown distance last (stable: oldest first).
            ->sortBy(fn (Delivery $d) => $distances[$d->id] ?? PHP_FLOAT_MAX)
            ->reject(fn (Delivery $d) => $pinged->contains('id', $d->id))
            ->filter($forService);

        return $pinged->concat($open)->take($limit)->values();
    }

    /**
     * Deliveries this rider could see (pinged, or open on their board within
     * range) that ANOTHER rider accepted in the last $minutes. Shown as
     * "Already accepted by another rider" instead of silently vanishing.
     * Read-only: acceptance itself stays first-accept-wins under the lock.
     */
    public function getRecentlyTakenForRider(int $riderId, int $minutes = 10, int $limit = 15): Collection
    {
        return $this->model->with(['order.business'])
            ->whereNotNull('rider_id')
            ->where('rider_id', '!=', $riderId)
            ->where('assigned_at', '>=', now()->subMinutes($minutes))
            ->where('status', '!=', TripStatus::CANCELLED)
            ->latest('assigned_at')
            ->limit(50)
            ->get()
            ->filter(function (Delivery $delivery) use ($riderId) {
                if ($delivery->dispatchLogs()->where('rider_id', $riderId)->exists()) {
                    return true;
                }
                // Won during the targeted phase: it was never on this
                // rider's board, so there is nothing to explain (Stage 3).
                if ($delivery->dispatch_phase === SequentialDispatchService::PHASE_TARGETED) {
                    return false;
                }
                $distance = $this->distanceFromRider($riderId, $delivery);

                return $distance === null || $distance <= 25.0;
            })
            ->take($limit)
            ->values();
    }

    /**
     * Rider → pickup distance (km) from the rider's latest GPS fix; null when
     * the rider has never reported a location or the pickup has no coords.
     */
    public function pickupDistancesKm(int $riderId, Collection $deliveries): array
    {
        $location = $this->latestLocation($riderId);

        return $deliveries->mapWithKeys(fn (Delivery $d) => [$d->id => $this->distanceFrom($location, $d)])->all();
    }

    private function distanceFromRider(int $riderId, Delivery $delivery): ?float
    {
        return $this->distanceFrom($this->latestLocation($riderId), $delivery);
    }

    private function latestLocation(int $riderId): ?RiderLocation
    {
        return RiderLocation::where('rider_id', $riderId)->latest('recorded_at')->first();
    }

    private function distanceFrom(?RiderLocation $location, Delivery $delivery): ?float
    {
        if (! $location || $delivery->pickup_latitude === null || $delivery->pickup_longitude === null) {
            return null;
        }

        $earthRadiusKm = 6371.0;
        $dLat = deg2rad((float) $delivery->pickup_latitude - (float) $location->latitude);
        $dLng = deg2rad((float) $delivery->pickup_longitude - (float) $location->longitude);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad((float) $location->latitude))
            * cos(deg2rad((float) $delivery->pickup_latitude))
            * sin($dLng / 2) ** 2;

        return $earthRadiusKm * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    public function getActiveDeliveries(int $riderId): Collection
    {
        return $this->model->with(['order.business'])
            ->where('rider_id', $riderId)
            ->whereIn('status', self::ACTIVE_FOR_SETTLEMENT)
            ->get();
    }

    public function getCompletedDeliveries(int $riderId, int $perPage = 15, ?string $type = null): LengthAwarePaginator
    {
        return $this->model->with(['order.business', 'groupCheckout'])
            ->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            // A ride booking is a transport order; everything else (including
            // group food deliveries, which have no direct order) is food.
            ->when($type === 'ride', fn ($q) => $q->whereHas('order', fn ($o) => $o->where('order_type', 'transport')))
            ->when($type === 'food', fn ($q) => $q->whereDoesntHave('order', fn ($o) => $o->where('order_type', 'transport')))
            ->latest('delivered_at')
            ->latest()
            ->paginate($perPage);
    }

    public function getRiderEarnings(int $riderId, int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->with(['order.business'])
            ->where('rider_id', $riderId)
            ->where('status', '!=', TripStatus::CANCELLED)
            ->latest('assigned_at')
            ->latest()
            ->paginate($perPage);
    }

    public function countPending(): int
    {
        return $this->model->where('status', TripStatus::WAITING)->count();
    }

    public function countActiveByRider(int $riderId): int
    {
        return $this->model->where('rider_id', $riderId)
            ->whereIn('status', self::ACTIVE_FOR_SETTLEMENT)
            ->count();
    }

    public function countCompletedByRider(int $riderId): int
    {
        return $this->model->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            ->count();
    }

    public function getTotalEarningsByRider(int $riderId): float
    {
        return (float) $this->model->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            ->sum('rider_commission');
    }

    public function getThisMonthEarningsByRider(int $riderId): float
    {
        return (float) $this->model->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            ->whereMonth('delivered_at', now()->month)
            ->whereYear('delivered_at', now()->year)
            ->sum('rider_commission');
    }

    public function getActiveOperationsByBusiness(int $businessId): Collection
    {
        return $this->model->with(['order', 'rider'])
            ->whereHas('order', function ($q) use ($businessId) {
                $q->where('business_id', $businessId);
            })
            ->whereIn('status', [
                TripStatus::ASSIGNED,
                TripStatus::EN_ROUTE_PICKUP,
                TripStatus::ARRIVED_PICKUP,
                TripStatus::TOUR_STARTED,
                TripStatus::EN_ROUTE_DESTINATION,
                TripStatus::ARRIVED_DESTINATION,
            ])
            ->get();
    }

    public function countActiveByBusiness(int $businessId): int
    {
        return $this->model->whereHas('order', function ($q) use ($businessId) {
            $q->where('business_id', $businessId);
        })
            ->whereIn('status', [
            TripStatus::ASSIGNED,
            TripStatus::EN_ROUTE_PICKUP,
            TripStatus::ARRIVED_PICKUP,
            TripStatus::TOUR_STARTED,
            TripStatus::EN_ROUTE_DESTINATION,
            TripStatus::ARRIVED_DESTINATION,
        ])
            ->count();
    }
}
