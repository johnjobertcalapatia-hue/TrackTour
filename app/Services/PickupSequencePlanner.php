<?php

namespace App\Services;

use App\Models\Business;
use App\Models\Delivery;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Pickup sequence for a delivery (docs/dispatch-escalation-plan.md §2):
 * the restaurant FARTHEST from the tourist's drop-off is the first pickup,
 * the rest follow from farther to nearer; the tourist is the final stop.
 *
 * Planned BEFORE any rider is searched, because the rider must start at the
 * first pickup: the delivery's pickup point becomes stop 1 and the rider
 * search is centred there. The order is persisted on deliveries.pickup_sequence
 * so every later read (routeStops, stops, purchasing cash) is cheap and stable.
 *
 * Road distance (OSRM through DeliveryFeeService) is used when enabled and
 * reachable; straight-line distance is always the fallback, so routing never
 * blocks dispatch. Callers inside a DB lock pass $allowRoad = false.
 */
class PickupSequencePlanner
{
    public function __construct(private DeliveryFeeService $fees) {}

    /**
     * Plan (or re-plan before a rider accepts) and persist the sequence.
     * Returns the ordered business ids. No-op once a rider is assigned.
     *
     * @return array<int, int>
     */
    public function plan(Delivery $delivery, bool $allowRoad = true): array
    {
        if ($delivery->rider_id !== null && ! empty($delivery->pickup_sequence)) {
            return array_map('intval', $delivery->pickup_sequence);
        }

        $ordered = $this->order($delivery, $allowRoad);
        if ($ordered->isEmpty()) {
            return [];
        }

        $first = $ordered->first()['business'];
        $delivery->forceFill([
            'pickup_sequence' => $ordered->pluck('business.id')->map(fn ($id) => (int) $id)->values()->all(),
            'pickup_latitude' => $first->latitude,
            'pickup_longitude' => $first->longitude,
            'pickup_address' => $first->address ?: ($first->business_name ?? $delivery->pickup_address),
        ])->save();

        return $delivery->pickup_sequence;
    }

    /** Plan only when nothing has been planned yet. */
    public function ensurePlanned(Delivery $delivery, bool $allowRoad = true): void
    {
        if (empty($delivery->pickup_sequence)) {
            $this->plan($delivery, $allowRoad);
        }
    }

    /**
     * Restaurants of the delivery ordered farthest → nearest from the drop-off.
     *
     * @return Collection<int, array{business: Business, distance_km: float}>
     */
    public function order(Delivery $delivery, bool $allowRoad = true): Collection
    {
        $businesses = $this->businesses($delivery);
        if ($businesses->isEmpty()) {
            return collect();
        }

        $toLat = $delivery->delivery_latitude !== null ? (float) $delivery->delivery_latitude : null;
        $toLng = $delivery->delivery_longitude !== null ? (float) $delivery->delivery_longitude : null;
        $useRoad = $allowRoad && $businesses->count() > 1 && (bool) config('delivery.dispatch_road_distance', true);

        return $businesses
            ->map(fn (Business $b) => [
                'business' => $b,
                'distance_km' => $this->distanceToDropoff($b, $toLat, $toLng, $useRoad),
            ])
            // Farthest first; stable tie-break on id. Unknown distance sorts last.
            ->sort(fn ($a, $b) => [$b['distance_km'] ?? -1, $a['business']->id] <=> [$a['distance_km'] ?? -1, $b['business']->id])
            ->values();
    }

    /** Distinct fulfilling restaurants (item business_id, else the order's business). */
    private function businesses(Delivery $delivery): Collection
    {
        $ids = [];
        foreach ($delivery->childOrders() as $order) {
            foreach ($order->items()->get(['id', 'business_id', 'order_id', 'status']) as $item) {
                if (in_array($item->status, ['cancelled', 'rejected'], true)) {
                    continue;
                }
                $id = (int) ($item->business_id ?: $order->business_id);
                if ($id > 0) {
                    $ids[$id] = true;
                }
            }
            if ($ids === [] && $order->business_id) {
                $ids[(int) $order->business_id] = true;
            }
        }

        return $ids === [] ? collect() : Business::query()->whereIn('id', array_keys($ids))->get();
    }

    private function distanceToDropoff(Business $b, ?float $toLat, ?float $toLng, bool $useRoad): ?float
    {
        if ($toLat === null || $toLng === null || $b->latitude === null || $b->longitude === null) {
            return null;
        }

        if ($useRoad) {
            // Dispatch uses a short routing timeout; restore the fee setting after.
            $originalTimeout = config('delivery.routing_timeout');
            try {
                config(['delivery.routing_timeout' => (int) config('delivery.dispatch_routing_timeout', 2)]);
                $route = $this->fees->calculateRouteDistance((float) $b->latitude, (float) $b->longitude, $toLat, $toLng);
                if ($route !== null && isset($route['distance_km'])) {
                    return (float) $route['distance_km'];
                }
            } catch (\Throwable $e) {
                Log::info('[PickupSequence] road distance unavailable, using straight line', ['business_id' => $b->id, 'error' => $e->getMessage()]);
            } finally {
                config(['delivery.routing_timeout' => $originalTimeout]);
            }
        }

        return $this->fees->calculateFallbackDistance((float) $b->latitude, (float) $b->longitude, $toLat, $toLng);
    }
}
