<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Rider "My Destination" mode (decision 2026-11-11).
 *
 * A rider heading somewhere (e.g. home) sets a destination. While it is
 * active, dispatch offers the rider only jobs (food and rides) that lie on the
 * way: the pickup(s) and the drop-off are each within `corridor_km` of the
 * straight route from the rider's position to the destination, and the
 * drop-off leaves the rider closer to the destination than they are now.
 *
 * It switches off by itself when the rider comes within `arrival_radius_m` of
 * the destination, or `duration_minutes` after it was set. Only offers are
 * filtered: the Available Deliveries board still lists every nearby job and
 * marks the ones on the way. Matching is straight-line geometry (no routing
 * calls) so it never slows dispatch.
 */
class RiderDestinationService
{
    public function corridorKm(): float
    {
        return (float) config('delivery.destination_mode.corridor_km', 2.0);
    }

    /** The rider's active destination, or null when off or expired. */
    public function active(?RiderDetail $detail): ?array
    {
        if (! $detail || $detail->destination_latitude === null || $detail->destination_longitude === null) {
            return null;
        }
        if ($detail->destination_expires_at !== null && $detail->destination_expires_at->isPast()) {
            return null;
        }

        return [
            'label' => $detail->destination_label,
            'latitude' => (float) $detail->destination_latitude,
            'longitude' => (float) $detail->destination_longitude,
            'set_at' => $detail->destination_set_at,
            'expires_at' => $detail->destination_expires_at,
        ];
    }

    /** API shape for the rider app. */
    public function state(User $rider): array
    {
        $detail = $this->detail($rider);
        $this->clearIfExpired($detail);
        $active = $this->active($detail);

        return [
            'active' => $active !== null,
            'destination' => $active,
            'corridor_km' => $this->corridorKm(),
            'arrival_radius_m' => (int) config('delivery.destination_mode.arrival_radius_m', 300),
            'duration_minutes' => (int) config('delivery.destination_mode.duration_minutes', 180),
        ];
    }

    public function set(User $rider, float $latitude, float $longitude, ?string $label): array
    {
        $detail = $this->detail($rider);
        $detail->update([
            'destination_label' => $label !== null && trim($label) !== '' ? trim($label) : null,
            'destination_latitude' => $latitude,
            'destination_longitude' => $longitude,
            'destination_set_at' => now(),
            'destination_expires_at' => now()->addMinutes((int) config('delivery.destination_mode.duration_minutes', 180)),
        ]);

        return $this->state($rider);
    }

    public function clear(User $rider): array
    {
        $this->detail($rider)->update([
            'destination_label' => null,
            'destination_latitude' => null,
            'destination_longitude' => null,
            'destination_set_at' => null,
            'destination_expires_at' => null,
        ]);

        return $this->state($rider);
    }

    /**
     * Called with each accepted rider location fix. Turns the mode off when
     * the rider has arrived. Returns the reason it ended, or null.
     */
    public function checkArrival(User $rider, float $latitude, float $longitude): ?string
    {
        $detail = $this->detail($rider);
        if ($this->clearIfExpired($detail)) {
            return 'expired';
        }
        $active = $this->active($detail);
        if ($active === null) {
            return null;
        }

        $radiusKm = ((int) config('delivery.destination_mode.arrival_radius_m', 300)) / 1000;
        if ($this->distanceKm($latitude, $longitude, $active['latitude'], $active['longitude']) <= $radiusKm) {
            $this->clear($rider);

            return 'arrived';
        }

        return null;
    }

    /**
     * Keep only riders this delivery may be offered to: riders without an
     * active destination, or whose route the delivery lies on. Works on both
     * MySQL candidate collections (User with locations loaded) and radar rows.
     *
     * @param  Collection<int, User>  $riders
     * @return Collection<int, User>
     */
    public function rejectOffRoute(Collection $riders, Delivery $delivery): Collection
    {
        if ($riders->isEmpty()) {
            return $riders;
        }

        $destinations = $this->activeDestinations($riders->pluck('id')->map(fn ($id) => (int) $id)->all());
        if ($destinations === []) {
            return $riders;
        }

        return $riders->filter(function (User $rider) use ($destinations, $delivery) {
            $destination = $destinations[(int) $rider->id] ?? null;
            if ($destination === null) {
                return true;
            }
            $location = $rider->relationLoaded('locations') ? $rider->locations->first() : null;
            $location ??= RiderLocation::where('rider_id', $rider->id)->latest('recorded_at')->first();

            return $this->onTheWay($location?->latitude, $location?->longitude, $destination, $delivery);
        })->values();
    }

    /** Single-rider check, e.g. for a live radar candidate. */
    public function allows(int $riderId, ?float $riderLat, ?float $riderLng, Delivery $delivery): bool
    {
        $destination = $this->activeDestinations([$riderId])[$riderId] ?? null;

        return $destination === null || $this->onTheWay($riderLat, $riderLng, $destination, $delivery);
    }

    /** Is the delivery on the way from the rider's position to the destination? */
    public function onTheWay(mixed $riderLat, mixed $riderLng, array $destination, Delivery $delivery): bool
    {
        // Without a known position the route cannot be drawn: do not offer.
        if ($riderLat === null || $riderLng === null) {
            return false;
        }
        $from = [(float) $riderLat, (float) $riderLng];
        $to = [(float) $destination['latitude'], (float) $destination['longitude']];
        $dropoff = $delivery->delivery_latitude !== null && $delivery->delivery_longitude !== null
            ? [(float) $delivery->delivery_latitude, (float) $delivery->delivery_longitude]
            : null;
        if ($dropoff === null) {
            return false;
        }

        $corridor = $this->corridorKm();
        foreach ([...$this->pickups($delivery), $dropoff] as $point) {
            if ($this->distanceToRouteKm($point, $from, $to) > $corridor) {
                return false;
            }
        }

        // The drop-off must bring the rider closer to where they are going.
        return $this->distanceKm($dropoff[0], $dropoff[1], $to[0], $to[1])
            < $this->distanceKm($from[0], $from[1], $to[0], $to[1]);
    }

    /** @return array<int, array{0: float, 1: float}> every pickup point of the delivery */
    private function pickups(Delivery $delivery): array
    {
        $points = [];
        if ($delivery->isGroup()) {
            foreach ($delivery->childOrders() as $order) {
                $business = $order->business;
                if ($business?->latitude !== null && $business?->longitude !== null) {
                    $points[] = [(float) $business->latitude, (float) $business->longitude];
                }
            }
        }
        if ($points === [] && $delivery->pickup_latitude !== null && $delivery->pickup_longitude !== null) {
            $points[] = [(float) $delivery->pickup_latitude, (float) $delivery->pickup_longitude];
        }

        return $points;
    }

    /** @return array<int, array> rider id => active destination */
    private function activeDestinations(array $riderIds): array
    {
        if ($riderIds === []) {
            return [];
        }

        return RiderDetail::query()
            ->whereIn('user_id', $riderIds)
            ->whereNotNull('destination_latitude')
            ->whereNotNull('destination_longitude')
            ->where(fn ($q) => $q->whereNull('destination_expires_at')->orWhere('destination_expires_at', '>', now()))
            ->get()
            ->mapWithKeys(fn (RiderDetail $d) => [(int) $d->user_id => $this->active($d)])
            ->filter()
            ->all();
    }

    private function detail(User $rider): RiderDetail
    {
        return $rider->riderDetail()->firstOrCreate([], ['rider_status' => 'offline']);
    }

    private function clearIfExpired(RiderDetail $detail): bool
    {
        if ($detail->destination_latitude !== null && $detail->destination_expires_at !== null
            && $detail->destination_expires_at->isPast()) {
            $detail->update([
                'destination_label' => null,
                'destination_latitude' => null,
                'destination_longitude' => null,
                'destination_set_at' => null,
                'destination_expires_at' => null,
            ]);

            return true;
        }

        return false;
    }

    /**
     * Shortest distance (km) from a point to the segment from -> to, on a
     * local flat projection (accurate at town scale).
     */
    public function distanceToRouteKm(array $point, array $from, array $to): float
    {
        $kmPerDegLat = 110.574;
        $kmPerDegLng = 111.320 * cos(deg2rad($from[0]));
        $px = ($point[1] - $from[1]) * $kmPerDegLng;
        $py = ($point[0] - $from[0]) * $kmPerDegLat;
        $bx = ($to[1] - $from[1]) * $kmPerDegLng;
        $by = ($to[0] - $from[0]) * $kmPerDegLat;
        $lengthSq = $bx * $bx + $by * $by;
        $t = $lengthSq > 0 ? max(0.0, min(1.0, ($px * $bx + $py * $by) / $lengthSq)) : 0.0;

        return sqrt(($px - $t * $bx) ** 2 + ($py - $t * $by) ** 2);
    }

    public function distanceKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return 6371 * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
