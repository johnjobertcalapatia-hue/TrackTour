<?php

namespace App\Services;

use App\Events\DeliveryStatusChanged;
use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Rider self-diagnostics and safe self-repair (2026-11-10).
 *
 * The rider runs "Diagnostics" when something looks stuck. Each check reports
 * what is wrong in plain words; "Fix problems" repairs what can be repaired
 * WITHOUT bypassing a business rule, so the rider can repeat the step:
 *
 *   - status:   "busy" with no live delivery → available (stale busy);
 *               a live delivery but not "busy" → busy.
 *   - location: saved fixes with an exact 0 latitude / longitude are removed;
 *               the device's current fix is saved when the normal plausibility
 *               rule allows it (never a teleport inside the 120 s window).
 *   - trip:     missing pickup stops are created; a delivery whose every
 *               restaurant pickup is confirmed but which is still "arrived at
 *               pickup" is moved on through the canonical transition.
 *
 * Never repaired here (they are rules, not bugs): the 50 m radii, food ready,
 * the restaurant's "Payment received", the one-active-delivery rule. For those
 * the check says exactly what the rider must do. Every repair is written to
 * the activity log.
 */
class RiderDiagnosticsService
{
    private const TERMINAL = ['completed', 'cancelled'];
    private const PICKUP_STAGE = ['assigned', 'en_route_pickup', 'arrived_pickup'];
    private const MAX_ACCURACY_M = 50;

    public function __construct(
        private PickupSequenceService $pickupSequence,
        private PickupDeliveryTransitionService $pickupTransitions,
    ) {}

    /**
     * @param  array{latitude: float, longitude: float, accuracy?: float|null}|null  $deviceFix  the device's current GPS fix (repair only)
     * @return array{ok: bool, checks: list<array{key: string, status: string, title: string, message: string}>, repaired: list<string>}
     */
    public function run(User $rider, bool $repair = false, ?array $deviceFix = null): array
    {
        $this->lastTrip = null;
        $repaired = [];
        $checks = [
            $this->checkAccount($rider),
            $this->checkLocation($rider, $repair, $deviceFix, $repaired),
            $this->checkStatus($rider, $repair, $repaired),
            ...$this->checkTrip($rider, $repair, $repaired),
        ];

        foreach ($repaired as $what) {
            ActivityLog::create([
                'user_id' => $rider->id,
                'action' => 'rider_self_repair',
                'type' => 'rider',
                'description' => $what,
                'model_type' => User::class,
                'model_id' => $rider->id,
            ]);
        }

        return [
            'ok' => collect($checks)->every(fn (array $c) => in_array($c['status'], ['ok', 'fixed'], true)),
            'checks' => $checks,
            'repaired' => $repaired,
            // The trip's canonical path: every step done / current / to do and
            // the one next thing to do (null without a live delivery).
            'trip' => $this->lastTrip ? [
                'order_number' => $this->lastTrip['order_number'],
                'path' => $this->lastTrip['path'],
                'next_step' => $this->lastTrip['next_step'],
                'reset_available' => $this->lastTrip['resets'] !== [],
            ] : null,
        ];
    }

    private function check(string $key, string $status, string $title, string $message): array
    {
        return compact('key', 'status', 'title', 'message');
    }

    private function checkAccount(User $rider): array
    {
        return $rider->account_status === User::ACCOUNT_STATUS_APPROVED
            ? $this->check('account', 'ok', 'Account', 'Your rider account is approved.')
            : $this->check('account', 'needs_action', 'Account', 'Your rider account is not approved yet. Contact the Tourism Office.');
    }

    /** @param list<string> $repaired */
    private function checkLocation(User $rider, bool $repair, ?array $deviceFix, array &$repaired): array
    {
        $invalid = RiderLocation::where('rider_id', $rider->id)
            ->where(fn ($q) => $q->where('latitude', 0)->orWhere('longitude', 0));
        if ($repair && $invalid->exists()) {
            $count = $invalid->delete();
            $repaired[] = "Removed {$count} invalid saved location(s) (0 latitude / longitude).";
        }

        $saved = fn () => RiderLocation::where('rider_id', $rider->id)->latest('recorded_at')->orderByDesc('id')->first();
        $last = $saved();

        if ($repair && $deviceFix !== null && $this->usable($deviceFix)) {
            // Same accuracy rule as RiderMapController::updateLocation: a fix
            // coarser than 50 m is never saved (the map shows it, the trip
            // buttons do not count it).
            $accuracy = isset($deviceFix['accuracy']) ? (float) $deviceFix['accuracy'] : null;
            if ($accuracy !== null && $accuracy > self::MAX_ACCURACY_M) {
                return $this->check('location', 'needs_action', 'Location',
                    'Your GPS is not precise enough (±'.((int) round($accuracy)).' m; it needs '.self::MAX_ACCURACY_M.' m or better), so your location is not saved. Move to an open area with location on and try again.');
            }

            $blockedFor = $this->secondsUntilAccepted($last, (float) $deviceFix['latitude'], (float) $deviceFix['longitude']);
            if ($blockedFor === 0) {
                RiderLocation::create([
                    'rider_id' => $rider->id,
                    'latitude' => (float) $deviceFix['latitude'],
                    'longitude' => (float) $deviceFix['longitude'],
                    'recorded_at' => now(),
                ]);
                $repaired[] = 'Saved your current location.';

                return $this->check('location', 'fixed', 'Location', 'Your current location is saved.');
            }

            return $this->check('location', 'warn', 'Location',
                "Your location jumped too far from your last saved position to be real. If TrackTour is open in another tab or phone, close it, then try again in about {$blockedFor} seconds.");
        }

        if (! $last) {
            return $this->check('location', 'needs_action', 'Location', 'No location saved yet. Turn on location and keep the map open.');
        }
        if ((float) $last->latitude == 0.0 || (float) $last->longitude == 0.0) {
            return $this->check('location', 'needs_action', 'Location', 'Your saved location is invalid. Tap "Fix problems" to clear it.');
        }
        $maxAge = (int) config('delivery.cod_location_max_age_minutes', 5) * 60;
        if ($last->recorded_at && $last->recorded_at->lt(now()->subSeconds($maxAge))) {
            return $this->check('location', 'warn', 'Location', 'Your saved location is old. Tap "Fix problems" to send your current location.');
        }

        return $this->check('location', 'ok', 'Location', 'Your location is up to date.');
    }

    /** @param list<string> $repaired */
    private function checkStatus(User $rider, bool $repair, array &$repaired): array
    {
        $status = $rider->riderDetail?->rider_status ?? $rider->rider_status;
        $live = $this->liveDeliveries($rider)->count();

        if ($live === 0 && $status === User::RIDER_STATUS_BUSY) {
            if ($repair) {
                $this->setStatus($rider, User::RIDER_STATUS_AVAILABLE);
                $repaired[] = 'Released a stale "busy" status (no live delivery).';

                return $this->check('status', 'fixed', 'Status', 'You were stuck as "on a trip" with no delivery. You are available again.');
            }

            return $this->check('status', 'needs_action', 'Status', 'You are marked "on a trip" but have no delivery. Tap "Fix problems".');
        }
        if ($live > 0 && $status !== User::RIDER_STATUS_BUSY) {
            if ($repair) {
                $this->setStatus($rider, User::RIDER_STATUS_BUSY);
                $repaired[] = 'Set status to busy for the live delivery.';

                return $this->check('status', 'fixed', 'Status', 'Your status now matches your delivery.');
            }

            return $this->check('status', 'needs_action', 'Status', 'Your status does not match your delivery. Tap "Fix problems".');
        }

        return $this->check('status', 'ok', 'Status', $live > 0 ? 'You are on a delivery.' : 'You have no delivery right now.');
    }

    /**
     * @param  list<string>  $repaired
     * @return list<array>
     */
    private function checkTrip(User $rider, bool $repair, array &$repaired): array
    {
        $live = $this->liveDeliveries($rider);
        if ($live->isEmpty()) {
            return [];
        }
        if ($live->count() > 1) {
            return [$this->check('trip', 'needs_action', 'Delivery',
                'You have more than one delivery open. Contact the Tourism Office to release the extra one.')];
        }

        /** @var Delivery $delivery */
        $delivery = $live->first();
        $status = $delivery->status->value ?? $delivery->status;
        $label = $delivery->primaryOrder()?->order_number ?? "#{$delivery->id}";

        // The canonical trip path (TripPathDiagnostics): the rider may apply
        // FIXES only (re-syncing derived state to the recorded facts).
        // Reopening a recorded step is for the Tourism Office.
        $diagnosis = app(TripPathDiagnostics::class)->diagnose($delivery, $repair, $rider, log: false);
        $this->lastTrip = $diagnosis;
        if (! $diagnosis['covered']) {
            return [$this->check('trip', 'ok', 'Delivery', "Order {$label} is in progress ({$this->statusText($status)}).")];
        }
        foreach ($diagnosis['repaired'] as $what) {
            $repaired[] = $what;
        }

        // The first trip finding keeps the key "trip"; the rest are suffixed.
        return array_values(array_map(
            fn (array $f, int $i) => $this->check($i === 0 ? 'trip' : "trip_{$f['code']}", $f['status'], $f['title'], $f['message']),
            $diagnosis['findings'],
            array_keys($diagnosis['findings']),
        ));
    }

    /** The last trip diagnosis (path + next step), for the response. */
    private ?array $lastTrip = null;

    private function liveDeliveries(User $rider)
    {
        return Delivery::where('rider_id', $rider->id)->whereNotIn('status', self::TERMINAL)->get();
    }

    private function setStatus(User $rider, string $status): void
    {
        $rider->riderDetail()->updateOrCreate(
            ['user_id' => $rider->id],
            ['rider_status' => $status, 'rider_status_updated_at' => now()]
        );
    }

    private function usable(array $fix): bool
    {
        $lat = (float) ($fix['latitude'] ?? 0);
        $lng = (float) ($fix['longitude'] ?? 0);

        return $lat != 0.0 && $lng != 0.0 && abs($lat) <= 90 && abs($lng) <= 180;
    }

    /** 0 = the normal plausibility rule accepts this fix now; otherwise seconds to wait. */
    private function secondsUntilAccepted(?RiderLocation $last, float $lat, float $lng): int
    {
        if (! $last || ! $last->recorded_at || (float) $last->latitude == 0.0 || (float) $last->longitude == 0.0) {
            return 0;
        }
        $window = (int) config('tracking.plausibility_window_seconds', 120);
        $elapsed = max(0, now()->timestamp - $last->recorded_at->timestamp);
        if ($elapsed > $window) {
            return 0;
        }
        $elapsed = max(1, $elapsed); // same second: judged as 1 s, like RiderMapController
        $km = $this->pickupSequence->distanceMeters((float) $last->latitude, (float) $last->longitude, $lat, $lng) / 1000;
        $kph = $km / ($elapsed / 3600);

        return $kph <= (float) config('tracking.max_speed_kph', 150) ? 0 : ($window - $elapsed + 1);
    }

    private function statusText(string $status): string
    {
        return match ($status) {
            'picked_up', 'in_transit' => 'on the way to the tourist',
            'arrived_destination' => 'at the drop-off',
            'delivered' => 'delivered, cash to settle',
            default => str_replace('_', ' ', $status),
        };
    }
}
