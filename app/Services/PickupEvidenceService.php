<?php

namespace App\Services;

use App\Models\DeliveryPickupStop;
use App\Models\RiderLocation;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Restaurant pickup location evidence (Stage 3). Captured at the moment the
 * rider confirms arrival and pickup, and written once onto the stop (and so
 * into the transaction ledger event). Two sources are kept apart, each with
 * its own coordinates, accuracy, fix age and distance from the restaurant:
 *
 *   device  the fix the rider's phone sent with the request (client clock)
 *   server  the rider's last location saved by the server heartbeat
 *
 * Evidence only: it never decides whether a pickup is allowed (the pickup
 * geofence, P4, remains deferred), and missing or invalid coordinates are
 * recorded as such rather than blocking the pickup.
 */
class PickupEvidenceService
{
    public function __construct(private readonly PickupSequenceService $sequence) {}

    /**
     * @param  array<string, mixed>|null  $device  latitude, longitude, accuracy, fix_at (ISO or epoch ms) as sent
     */
    public function capture(int $riderId, DeliveryPickupStop $stop, ?array $device): array
    {
        $now = CarbonImmutable::now();
        $restaurant = $stop->pickup_latitude !== null && $stop->pickup_longitude !== null
            ? ['latitude' => (float) $stop->pickup_latitude, 'longitude' => (float) $stop->pickup_longitude]
            : null;

        return [
            'captured_at' => $now->toIso8601String(),
            'restaurant' => $restaurant,
            'device' => $this->deviceFix($device, $restaurant, $now),
            'server' => $this->serverFix($riderId, $restaurant, $now),
        ];
    }

    /**
     * Same evidence against any target point (Stage 4 ride steps: the
     * passenger pickup point or the destination). Never throws.
     */
    public function captureAt(int $riderId, mixed $latitude, mixed $longitude, string $label, ?array $device): array
    {
        $now = CarbonImmutable::now();
        $target = is_numeric($latitude) && is_numeric($longitude)
            ? ['latitude' => (float) $latitude, 'longitude' => (float) $longitude]
            : null;

        return [
            'captured_at' => $now->toIso8601String(),
            'target' => $target ? ['label' => $label] + $target : null,
            'device' => $this->deviceFix($device, $target, $now),
            'server' => $this->serverFix($riderId, $target, $now),
        ];
    }

    /** The optional device fix from a request (null when the app sent none). */
    public static function deviceFixFrom(\Illuminate\Http\Request $request): ?array
    {
        if (! $request->hasAny(['latitude', 'longitude'])) {
            return null;
        }

        return [
            'latitude' => $request->input('latitude'),
            'longitude' => $request->input('longitude'),
            'accuracy' => $request->input('accuracy'),
            'fix_at' => $request->input('fix_at'),
        ];
    }

    private function deviceFix(?array $device, ?array $restaurant, CarbonImmutable $now): ?array
    {
        if ($device === null) {
            return null;
        }
        $lat = $device['latitude'] ?? null;
        $lng = $device['longitude'] ?? null;
        if (! is_numeric($lat) || ! is_numeric($lng) || abs((float) $lat) > 90 || abs((float) $lng) > 180 || ((float) $lat === 0.0 && (float) $lng === 0.0)) {
            return ['rejected' => 'invalid coordinates'];
        }
        $accuracy = is_numeric($device['accuracy'] ?? null) && (float) $device['accuracy'] >= 0 ? round((float) $device['accuracy'], 1) : null;
        $fixAt = $this->parseTime($device['fix_at'] ?? null);

        return [
            'latitude' => round((float) $lat, 7),
            'longitude' => round((float) $lng, 7),
            'accuracy_m' => $accuracy,
            'fix_at' => $fixAt?->toIso8601String(),
            // Device clock: indicative only, may be skewed.
            'age_s' => $fixAt ? (int) round($now->diffInSeconds($fixAt, true)) : null,
            'distance_m' => $restaurant ? round($this->sequence->distanceMeters((float) $lat, (float) $lng, $restaurant['latitude'], $restaurant['longitude']), 1) : null,
        ];
    }

    private function serverFix(int $riderId, ?array $restaurant, CarbonImmutable $now): ?array
    {
        $location = RiderLocation::where('rider_id', $riderId)->latest('recorded_at')->orderByDesc('id')->first();
        if (! $location) {
            return null;
        }
        $recordedAt = $location->recorded_at ? Carbon::parse($location->recorded_at) : null;

        return [
            'latitude' => round((float) $location->latitude, 7),
            'longitude' => round((float) $location->longitude, 7),
            'accuracy_m' => $location->accuracy_m !== null ? round((float) $location->accuracy_m, 1) : null,
            'fix_at' => $recordedAt?->toIso8601String(),
            'age_s' => $recordedAt ? (int) round($now->diffInSeconds($recordedAt, true)) : null,
            'distance_m' => $restaurant ? round($this->sequence->distanceMeters((float) $location->latitude, (float) $location->longitude, $restaurant['latitude'], $restaurant['longitude']), 1) : null,
            'location_id' => $location->id,
        ];
    }

    private function parseTime(mixed $value): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }
        try {
            return is_numeric($value) ? CarbonImmutable::createFromTimestampMs((int) $value) : CarbonImmutable::parse((string) $value);
        } catch (Throwable) {
            return null;
        }
    }
}
