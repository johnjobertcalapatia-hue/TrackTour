<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Delivery;
use Carbon\CarbonImmutable;

/**
 * Where is the rider, for the food drop-off steps (I've Arrived at the tourist,
 * Confirm Delivered)? Owner decision 2026-11-12.
 *
 *  1. The rider's latest SAVED fix (≤ 120 s old, saved only at ±50 m or
 *     better) within the drop-off radius — exactly as before.
 *  2. Otherwise the phone's OWN fix sent with the request, when it is
 *     ≤ 30 s old, within the radius, at most ±200 m (owner decision; first
 *     ±100 m, raised to ±200 m the same day), and plausible against
 *     the last saved position (no teleport). A doorway, a roof or nearby
 *     buildings often push a phone past ±50 m, which used to block a rider
 *     standing at the tourist's door (2026-11-12, "you are 29 m away").
 *     Accepted fixes coarser than ±50 m are flagged for the Tourism Office.
 *
 * Coarser than ±200 m is still refused, with what to do about it.
 *
 * Restaurant pickups use the same rules (owner decision 2026-11-24): arrival
 * and Confirm Pick Up at the restaurant pass the stop's point, the pickup
 * radius, "the restaurant" and their own escalation action.
 */
class DropoffLocationProof
{
    public function __construct(private PickupSequenceService $sequence) {}

    /**
     * @param  array{latitude?: mixed, longitude?: mixed, accuracy?: mixed, fix_at?: mixed}|null  $deviceFix
     * @param  string  $farFormat  sprintf format for "too far" (radius m, distance text)
     * @return array{ok: bool, source: ?string, distance: ?float, accuracy: ?float, flagged: bool, message: ?string}
     */
    public function evaluate(Delivery $delivery, int $riderId, ?array $deviceFix, string $action,
        string $farFormat = 'You must be within %d m of the delivery address (you are %s away).',
        ?array $target = null, ?float $radiusMeters = null,
        string $targetLabel = 'the drop-off', string $escalationAction = 'escalation.dropoff_low_precision_gps'): array
    {
        // Default target: the drop-off. A ride's pickup arrival passes its own
        // point and radius (2026-11-18), with the same saved / device-fix rules.
        $radius = $radiusMeters ?? (float) config('tracking.dropoff_radius_meters', 50);
        $tLat = (float) ($target[0] ?? $delivery->delivery_latitude);
        $tLng = (float) ($target[1] ?? $delivery->delivery_longitude);
        $maxAge = (int) config('tracking.proof_location_max_age_seconds', 120);
        $saved = $this->sequence->latestRiderLocation($riderId);
        $savedFresh = $saved && $saved['recorded_at'] && ! $saved['recorded_at']->lt(now()->subSeconds($maxAge));
        $savedDistance = $savedFresh ? $this->distanceTo($saved['latitude'], $saved['longitude'], $tLat, $tLng) : null;

        if ($savedDistance !== null && $savedDistance <= $radius) {
            return $this->pass('saved', $savedDistance, null, false);
        }

        $device = $this->usableDeviceFix($deviceFix);
        if ($device !== null) {
            $maxAccuracy = (float) config('tracking.dropoff_max_fix_accuracy_m', 200);
            if ($device['accuracy'] === null || $device['accuracy'] > $maxAccuracy) {
                $acc = $device['accuracy'] !== null ? ' (±'.((int) round($device['accuracy'])).' m)' : '';

                return $this->fail("Your GPS is not precise enough{$acc}; it needs ±".((int) $maxAccuracy).' m or better. Turn on Precise location for TrackTour, or step outside away from the roof, then try again.');
            }
            if (! $this->plausible($device, $saved)) {
                return $this->fail('Your phone\'s location jumped too far from your last saved position. If TrackTour is open in another tab or phone, close it, then try again.');
            }
            $distance = $this->distanceTo($device['latitude'], $device['longitude'], $tLat, $tLng);
            if ($distance <= $radius) {
                $flagged = $device['accuracy'] > (float) config('tracking.max_saved_accuracy_m', 50);
                if ($flagged) {
                    ActivityLog::record(
                        $escalationAction,
                        "Delivery #{$delivery->id} ({$action}) was confirmed from the rider's phone GPS at ±".((int) round($device['accuracy']))." m precision, {$this->away($distance)} from {$targetLabel}. Review if anything looks wrong.",
                        $delivery,
                        'delivery',
                    );
                }

                return $this->pass('device', $distance, $device['accuracy'], $flagged);
            }

            return $this->fail(sprintf($farFormat, (int) $radius, $this->away($distance)));
        }

        if ($savedDistance !== null) {
            return $this->fail(sprintf($farFormat, (int) $radius, $this->away($savedDistance)));
        }

        return $this->fail('We need your current location. Keep the map open with location on, then try again.');
    }

    /** @return array{latitude: float, longitude: float, accuracy: ?float, fix_at: CarbonImmutable}|null */
    private function usableDeviceFix(?array $fix): ?array
    {
        if ($fix === null) {
            return null;
        }
        $lat = $fix['latitude'] ?? null;
        $lng = $fix['longitude'] ?? null;
        if (! is_numeric($lat) || ! is_numeric($lng) || (float) $lat == 0.0 || (float) $lng == 0.0 || abs((float) $lat) > 90 || abs((float) $lng) > 180) {
            return null;
        }
        try {
            $fixAt = isset($fix['fix_at']) && $fix['fix_at'] !== '' ? CarbonImmutable::parse((string) $fix['fix_at']) : null;
        } catch (\Throwable) {
            $fixAt = null;
        }
        $maxAge = (int) config('tracking.device_fix_max_age_seconds', 30);
        // A fix must say when it was taken, be recent, and not come from the future.
        if (! $fixAt || $fixAt->lt(now()->subSeconds($maxAge)) || $fixAt->gt(now()->addSeconds(5))) {
            return null;
        }

        return [
            'latitude' => (float) $lat,
            'longitude' => (float) $lng,
            'accuracy' => is_numeric($fix['accuracy'] ?? null) && (float) $fix['accuracy'] >= 0 ? (float) $fix['accuracy'] : null,
            'fix_at' => $fixAt,
        ];
    }

    /** The same speed rule the location endpoint uses (no teleport from the last saved fix). */
    private function plausible(array $device, ?array $saved): bool
    {
        if (! $saved || ! $saved['recorded_at']) {
            return true;
        }
        $window = (int) config('tracking.plausibility_window_seconds', 120);
        $elapsed = abs($device['fix_at']->timestamp - $saved['recorded_at']->timestamp);
        if ($elapsed > $window) {
            return true;
        }
        $km = $this->sequence->distanceMeters((float) $saved['latitude'], (float) $saved['longitude'], $device['latitude'], $device['longitude']) / 1000;
        $kph = $km / (max(1, $elapsed) / 3600);

        return $kph <= (float) config('tracking.max_speed_kph', 150);
    }

    private function distanceTo(float $lat, float $lng, float $tLat, float $tLng): float
    {
        return $this->sequence->distanceMeters($lat, $lng, $tLat, $tLng);
    }

    private function away(float $meters): string
    {
        return $meters < 1000 ? ((int) round($meters)).' m' : number_format($meters / 1000, 1).' km';
    }

    private function pass(string $source, float $distance, ?float $accuracy, bool $flagged): array
    {
        return ['ok' => true, 'source' => $source, 'distance' => $distance, 'accuracy' => $accuracy, 'flagged' => $flagged, 'message' => null];
    }

    private function fail(string $message): array
    {
        return ['ok' => false, 'source' => null, 'distance' => null, 'accuracy' => null, 'flagged' => false, 'message' => $message];
    }
}
