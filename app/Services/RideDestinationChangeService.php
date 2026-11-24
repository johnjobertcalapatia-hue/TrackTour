<?php

namespace App\Services;

use App\Exceptions\RideDestinationChangeException;
use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RideDestinationChange;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Carbon\CarbonInterface;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Ride hailing — one-time destination change (owner decisions 2026-11-17).
 *
 * WHEN: once per trip, after the passenger is on board (picked_up /
 * in_transit / en_route_destination) and before arrival; never after
 * completion or cancellation. Only a CONFIRMED change uses the allowance:
 * previews are not stored, and a refused or expired confirm stores nothing.
 *
 * REVISED ESTIMATE (shown before confirming):
 *   travelled_km  = verified GPS distance from the pickup to now (rules below)
 *   remaining_km  = road route (OSRM) from the rider's latest saved fix to the
 *                   new destination; straight line only when the router is down
 *   estimated     = round(max(base + round((travelled + remaining) × per_km, 2), base), 2)
 *   max_fare      = round(estimated × 1.15, 2)
 * base / per_km are the ride's BOOKED rates (fare configuration used), not
 * today's settings. The preview returns a signed, 3-minute quote; confirming
 * stores exactly the numbers the tourist saw.
 *
 * FINAL FARE (when the rider reaches the destination — arrived_destination,
 * or delivered if arrival was skipped — before any cash amount is fixed):
 *   computed = round(max(base + round(verified_km × per_km, 2), base), 2)
 *   final    = min(computed, max_fare); cap_adjustment = computed − final
 *   commission = round(max(₱20, 40% × final), 2)
 * Order subtotal/total, the ride item and the delivery's rider_commission
 * become the final values; the booked fare and commission stay on the
 * change row and in the untouched "ride_quoted" ledger event.
 *
 * VERIFIED GPS DISTANCE: the rider's SAVED fixes (rider_locations; the server
 * saves only ±50 m or better and refuses teleports), from the pickup point at
 * picked_up_at to the latest fix, in time order:
 *   - jitter: a fix closer to the last counted point than max(10 m, the two
 *     fixes' mean accuracy) adds nothing (the anchor stays put);
 *   - impossible jump: a segment faster than tracking.max_speed_kph (150) is
 *     NOT counted (unverified) and flagged;
 *   - gap: a segment spanning more than 60 s without a fix is NOT counted
 *     (unverified, recorded with its length and duration);
 *   - an end more than 200 m short of the destination is unverified too.
 * Unverified distance is never charged. When it is material (> 0.5 km or
 * > 15% of the trip), or there is no track, or a jump was excluded, the fare
 * (verified distance only) is marked needs_review for the Tourism Office.
 */
class RideDestinationChangeService
{
    public const MAX_FARE_FACTOR = 1.15;

    public const QUOTE_TTL_SECONDS = 180;

    /** Delivery statuses in which the trip is under way (passenger on board, not arrived). */
    public const CHANGEABLE_STATUSES = ['picked_up', 'in_transit', 'en_route_destination'];

    public const GAP_SECONDS = 60;

    public const MIN_JITTER_M = 10;

    public const END_TOLERANCE_M = 200;

    public const REVIEW_UNVERIFIED_KM = 0.5;

    public const REVIEW_UNVERIFIED_SHARE = 0.15;

    public function __construct(
        private readonly TransportationService $transport,
        private readonly GpsService $gps,
        private readonly TransactionLedger $ledger,
        private readonly WebsocketNotifierService $notifier,
    ) {}

    public function changeFor(Order $order): ?RideDestinationChange
    {
        return RideDestinationChange::where('order_id', $order->id)->first();
    }

    /** @return array{allowed: bool, changes_left: int, reason: ?string} */
    public function eligibility(Order $order, ?Delivery $delivery): array
    {
        if ($this->changeFor($order) !== null) {
            return ['allowed' => false, 'changes_left' => 0, 'reason' => 'You have already changed the destination of this ride.'];
        }
        $reason = $this->blockingReason($order, $delivery);

        return ['allowed' => $reason === null, 'changes_left' => 1, 'reason' => $reason];
    }

    private function blockingReason(Order $order, ?Delivery $delivery): ?string
    {
        if ($order->order_type !== 'transport') {
            return 'Only rides can change destination.';
        }
        $orderStatus = (string) $order->status;
        if (in_array($orderStatus, ['cancelled', 'cancelled_by_tourist', 'rejected'], true)) {
            return 'This ride was cancelled.';
        }
        if (in_array($orderStatus, ['completed', 'delivered'], true)) {
            return 'This ride is already completed.';
        }
        $status = $delivery?->status?->value ?? $delivery?->status;
        if (in_array($status, ['arrived_destination', 'delivered', 'completed'], true)) {
            return 'This ride is already at its destination.';
        }
        if ($status === 'cancelled') {
            return 'This ride was cancelled.';
        }
        if (! in_array($status, self::CHANGEABLE_STATUSES, true)) {
            return 'You can change the destination once your driver has picked you up.';
        }

        return null;
    }

    // ───────────────────────── preview ─────────────────────────

    /**
     * The revised route and fare for a new destination. Stores nothing.
     *
     * @param  array{name: ?string, address: ?string, latitude: float, longitude: float}  $destination
     */
    public function preview(Order $order, array $destination, User $tourist): array
    {
        $delivery = $order->delivery;
        $eligibility = $this->eligibility($order, $delivery);
        if (! $eligibility['allowed']) {
            throw new RideDestinationChangeException($eligibility['reason'], 422);
        }

        $rates = $this->bookedRates($delivery);
        $now = now();
        $track = $this->verifiedTrack($delivery, $now);

        $position = RiderLocation::where('rider_id', $delivery->rider_id)->latest('recorded_at')->latest('id')->first();
        $maxAge = (int) config('tracking.proof_location_max_age_seconds', 120);
        if (! $position || $position->recorded_at === null || $position->recorded_at->lt($now->copy()->subSeconds($maxAge))) {
            throw new RideDestinationChangeException("We can't see your driver's current location right now, so the new route can't be estimated. Try again in a moment.", 422);
        }

        $route = $this->transport->getRoute(
            (float) $position->latitude, (float) $position->longitude,
            (float) $destination['latitude'], (float) $destination['longitude'],
        );
        $traveledKm = round($track['verified_km'], 3);
        $remainingKm = round((float) $route['distance_km'], 3);
        $estimated = $this->fare($rates['base_fare'], $rates['per_km'], $traveledKm + $remainingKm);
        $maxFare = self::cap($estimated);

        $quote = [
            'v' => 1,
            'order_id' => $order->id,
            'delivery_id' => $delivery->id,
            'user_id' => $tourist->id,
            'destination' => [
                'name' => $destination['name'] ?? null,
                'address' => $destination['address'] ?? null,
                'latitude' => round((float) $destination['latitude'], 7),
                'longitude' => round((float) $destination['longitude'], 7),
            ],
            'traveled_km' => $traveledKm,
            'remaining_km' => $remainingKm,
            'route_source' => $route['source'],
            'estimated_fare' => $estimated,
            'max_fare' => $maxFare,
            'base_fare' => $rates['base_fare'],
            'per_km' => $rates['per_km'],
            'expires_at' => $now->copy()->addSeconds(self::QUOTE_TTL_SECONDS)->timestamp,
        ];

        return [
            'quote_token' => Crypt::encryptString(json_encode($quote)),
            'expires_at' => $now->copy()->addSeconds(self::QUOTE_TTL_SECONDS)->toIso8601String(),
            'destination' => $quote['destination'],
            'traveled_km' => $traveledKm,
            'remaining_km' => $remainingKm,
            'route_source' => $route['source'],
            'route' => $route['polyline'],
            'from' => ['latitude' => (float) $position->latitude, 'longitude' => (float) $position->longitude],
            'original_fare' => round((float) $order->total, 2),
            'estimated_fare' => $estimated,
            'max_fare' => $maxFare,
            'base_fare' => $rates['base_fare'],
            'per_km' => $rates['per_km'],
            'changes_left' => 1,
        ];
    }

    // ───────────────────────── confirm ─────────────────────────

    /**
     * Confirm the previewed change. Locked and idempotent: the same key
     * returns the same change; any other second change is refused (409).
     *
     * @return array{change: RideDestinationChange, replayed: bool}
     */
    public function confirm(Order $order, string $quoteToken, string $idempotencyKey, User $tourist): array
    {
        $replay = RideDestinationChange::where('idempotency_key', $idempotencyKey)->first();
        if ($replay !== null) {
            if ((int) $replay->order_id !== (int) $order->id) {
                throw new RideDestinationChangeException('This request was already used for another ride.', 409);
            }

            return ['change' => $replay, 'replayed' => true];
        }

        $quote = $this->readQuote($quoteToken, $order, $tourist);

        try {
            $change = DB::transaction(function () use ($order, $quote, $idempotencyKey, $tourist) {
                // Serialise every change request for this trip on the delivery row.
                $delivery = Delivery::where('order_id', $order->id)->lockForUpdate()->first();
                $lockedOrder = Order::whereKey($order->id)->lockForUpdate()->first();
                if ($delivery === null || $lockedOrder === null) {
                    throw new RideDestinationChangeException('This ride could not be found.', 404);
                }
                if ((int) $delivery->id !== (int) $quote['delivery_id']) {
                    throw new RideDestinationChangeException('This estimate is for a different trip. Review the new destination again.', 422);
                }
                if (RideDestinationChange::where('order_id', $lockedOrder->id)->exists()) {
                    throw new RideDestinationChangeException('You have already changed the destination of this ride.', 409);
                }
                $reason = $this->blockingReason($lockedOrder, $delivery);
                if ($reason !== null) {
                    throw new RideDestinationChangeException($reason, 422);
                }

                $notes = json_decode((string) $delivery->notes, true) ?: [];
                $bookedQuote = $notes['fare_quote'] ?? [];
                $change = RideDestinationChange::create([
                    'order_id' => $lockedOrder->id,
                    'delivery_id' => $delivery->id,
                    'requested_by' => $tourist->id,
                    'idempotency_key' => $idempotencyKey,
                    'status' => RideDestinationChange::STATUS_CONFIRMED,
                    'original_address' => $delivery->delivery_address,
                    'original_latitude' => (float) $delivery->delivery_latitude,
                    'original_longitude' => (float) $delivery->delivery_longitude,
                    'new_name' => $quote['destination']['name'],
                    'new_address' => $quote['destination']['address'] ?: $quote['destination']['name'],
                    'new_latitude' => $quote['destination']['latitude'],
                    'new_longitude' => $quote['destination']['longitude'],
                    'original_fare' => round((float) $lockedOrder->total, 2),
                    'original_commission' => round((float) $delivery->rider_commission, 2),
                    'vehicle_type' => (string) ($notes['vehicle_type'] ?? 'motorcycle'),
                    'base_fare' => $quote['base_fare'],
                    'per_km' => $quote['per_km'],
                    'fare_settings_fingerprint' => $bookedQuote['fare_settings_fingerprint'] ?? null,
                    'traveled_km_at_change' => $quote['traveled_km'],
                    'remaining_km_estimate' => $quote['remaining_km'],
                    'remaining_route_source' => (string) $quote['route_source'],
                    'estimated_fare' => $quote['estimated_fare'],
                    'max_fare' => $quote['max_fare'],
                    'confirmed_at' => now(),
                ]);

                // The trip itself follows the new destination (live tracking,
                // the rider's route, arrival checks). No second booking.
                $delivery->forceFill([
                    'delivery_address' => $change->new_address,
                    'delivery_latitude' => $change->new_latitude,
                    'delivery_longitude' => $change->new_longitude,
                ])->save();

                $this->ledger->record($lockedOrder, 'ride_destination_changed', [
                    'change_id' => $change->id,
                    'delivery_id' => $delivery->id,
                    'requested_by' => $tourist->id,
                    'original' => ['address' => $change->original_address, 'latitude' => $change->original_latitude, 'longitude' => $change->original_longitude],
                    'new' => ['address' => $change->new_address, 'latitude' => $change->new_latitude, 'longitude' => $change->new_longitude],
                    'traveled_km' => $change->traveled_km_at_change,
                    'remaining_km' => $change->remaining_km_estimate,
                    'route_source' => $change->remaining_route_source,
                    'base_fare' => $change->base_fare,
                    'per_km' => $change->per_km,
                    'original_fare' => $change->original_fare,
                    'estimated_fare' => $change->estimated_fare,
                    'max_fare' => $change->max_fare,
                    'max_fare_rule' => 'round(estimated_fare × 1.15, 2)',
                ], $delivery);

                ActivityLog::record(
                    'ride.destination_changed',
                    "Ride {$lockedOrder->order_number}: destination changed from \"{$change->original_address}\" to \"{$change->new_address}\" (estimate ₱".number_format($change->estimated_fare, 2).', at most ₱'.number_format($change->max_fare, 2).').',
                    $lockedOrder,
                    ActivityLog::TYPE_FINANCIAL,
                );

                return $change;
            });
        } catch (UniqueConstraintViolationException) {
            // A concurrent request won the race (UNIQUE order_id / idempotency_key).
            $winner = RideDestinationChange::where('idempotency_key', $idempotencyKey)->first();
            if ($winner !== null) {
                return ['change' => $winner, 'replayed' => true];
            }
            throw new RideDestinationChangeException('You have already changed the destination of this ride.', 409);
        }

        $this->notifyRider($change);

        return ['change' => $change->fresh(), 'replayed' => false];
    }

    /**
     * Tell the rider (and the tourist's other screens) in real time. Best
     * effort AFTER the change is committed: a failed push never undoes the
     * change — it is recorded, and the rider app picks the change up on its
     * next poll and asks the rider to acknowledge it.
     */
    public function notifyRider(RideDestinationChange $change): void
    {
        $delivery = $change->delivery;
        $order = $change->order;
        $rooms = array_filter([
            $delivery?->rider_id ? 'user:'.$delivery->rider_id : null,
            $order?->user_id ? 'user:'.$order->user_id : null,
            $delivery ? 'trip:'.$delivery->id : null,
        ]);
        $sent = false;
        try {
            $sent = $this->notifier->notifyStatusEvent('ride.destination.changed', $rooms, [
                'order_id' => $change->order_id,
                'delivery_id' => $change->delivery_id,
                'change_id' => $change->id,
                'new_address' => $change->new_address,
                'new_latitude' => $change->new_latitude,
                'new_longitude' => $change->new_longitude,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Ride destination change: rider notification failed', ['change_id' => $change->id, 'error' => $e->getMessage()]);
        }
        $change->forceFill([
            'rider_notification_status' => $sent ? 'sent' : 'failed',
            'rider_notified_at' => $sent ? now() : null,
        ])->save();
    }

    /** The rider confirms they saw the new destination. Recorded once. */
    public function acknowledge(Delivery $delivery, User $rider): ?RideDestinationChange
    {
        return DB::transaction(function () use ($delivery, $rider) {
            $change = RideDestinationChange::where('delivery_id', $delivery->id)->lockForUpdate()->first();
            if ($change === null) {
                return null;
            }
            if ($change->rider_acknowledged_at === null) {
                $change->forceFill(['rider_acknowledged_at' => now()])->save();
                $order = $change->order;
                if ($order) {
                    $this->ledger->record($order, 'ride_destination_acknowledged', [
                        'change_id' => $change->id,
                        'rider_id' => $rider->id,
                        'acknowledged_at' => $change->rider_acknowledged_at->toIso8601String(),
                    ], $delivery);
                }
            }

            return $change;
        });
    }

    // ───────────────────────── final fare ─────────────────────────

    /**
     * Compute and apply the final fare of a changed ride. Call inside the
     * rider's status transaction, on the LOCKED delivery, when it reaches the
     * destination (before a cash amount is frozen). Idempotent.
     */
    public function finalizeIfChanged(Delivery $locked): ?RideDestinationChange
    {
        $change = RideDestinationChange::where('delivery_id', $locked->id)->lockForUpdate()->first();
        if ($change === null || $change->status === RideDestinationChange::STATUS_FINALIZED) {
            return $change;
        }
        $order = Order::whereKey($change->order_id)->lockForUpdate()->first();
        if ($order === null) {
            return $change;
        }

        $track = $this->verifiedTrack($locked, now(), [(float) $change->new_latitude, (float) $change->new_longitude]);
        $verifiedKm = round($track['verified_km'], 3);
        $unverifiedKm = round($track['unverified_km'], 3);
        $computed = $this->fare($change->base_fare, $change->per_km, $verifiedKm);
        $final = min($computed, (float) $change->max_fare);
        $capAdjustment = round($computed - $final, 2);
        $commission = self::commission($final);

        $reasons = [];
        if ($track['points'] < 2) {
            $reasons[] = 'Too few saved GPS fixes on this trip to measure it.';
        }
        if ($track['jumps'] > 0) {
            $reasons[] = "{$track['jumps']} impossible location jump(s) were excluded.";
        }
        $total = $verifiedKm + $unverifiedKm;
        if ($unverifiedKm > self::REVIEW_UNVERIFIED_KM || ($total > 0 && $unverifiedKm / $total > self::REVIEW_UNVERIFIED_SHARE)) {
            $reasons[] = sprintf('%.2f km of the trip had no verified GPS (gaps or an early end) and was not charged.', $unverifiedKm);
        }
        $review = $reasons === [] ? RideDestinationChange::REVIEW_OK : RideDestinationChange::REVIEW_NEEDED;

        $order->update(['subtotal' => $final, 'total' => $final]);
        $item = $order->items()->first();
        $item?->update(['unit_price' => $final, 'subtotal' => $final]);
        $locked->forceFill(['rider_commission' => $commission])->save();
        $locked->unsetRelation('order');

        $change->forceFill([
            'status' => RideDestinationChange::STATUS_FINALIZED,
            'verified_km' => $verifiedKm,
            'unverified_km' => $unverifiedKm,
            'track_summary' => $track['summary'],
            'computed_fare' => $computed,
            'final_fare' => $final,
            'cap_adjustment' => $capAdjustment,
            'final_commission' => $commission,
            'fare_review_status' => $review,
            'review_reasons' => $reasons,
            'finalized_at' => now(),
        ])->save();

        $this->ledger->record($order, 'ride_fare_finalized', [
            'change_id' => $change->id,
            'delivery_id' => $locked->id,
            'base_fare' => $change->base_fare,
            'per_km' => $change->per_km,
            'verified_km' => $verifiedKm,
            'unverified_km' => $unverifiedKm,
            'track' => $track['summary'],
            'computed_fare' => $computed,
            'max_fare' => (float) $change->max_fare,
            'final_fare' => $final,
            'cap_adjustment' => $capAdjustment,
            'original_fare' => (float) $change->original_fare,
            'original_commission' => (float) $change->original_commission,
            'rider_commission' => $commission,
            'fare_review_status' => $review,
            'review_reasons' => $reasons,
            'fare_rule' => 'min(round(max(base + round(verified_km × per_km, 2), base), 2), max_fare)',
            'commission_rule' => 'max(₱20, 40% of final fare), at most the fare',
        ], $locked);

        if ($review === RideDestinationChange::REVIEW_NEEDED) {
            ActivityLog::record(
                'escalation.ride_fare_review',
                "Ride {$order->order_number}: final fare ₱".number_format($final, 2).' charged for '.number_format($verifiedKm, 2).' km of verified GPS only. '.implode(' ', $reasons).' Review the trip.',
                $order,
                ActivityLog::TYPE_FINANCIAL,
            );
        }

        return $change;
    }

    // ───────────────────────── GPS ─────────────────────────

    /**
     * Verified distance of the trip from the pickup (at picked_up_at) to $until.
     *
     * @param  array{0: float, 1: float}|null  $destination  when given, an end short of it is unverified
     * @return array{verified_km: float, unverified_km: float, points: int, gaps: int, jumps: int, summary: array}
     */
    public function verifiedTrack(Delivery $delivery, CarbonInterface $until, ?array $destination = null): array
    {
        $start = $delivery->picked_up_at ?? $delivery->arrived_pickup_at ?? $delivery->assigned_at;
        $maxSpeed = (float) config('tracking.max_speed_kph', 150) / 3.6; // m/s

        $fixes = $start === null ? collect() : RiderLocation::where('rider_id', $delivery->rider_id)
            ->whereBetween('recorded_at', [$start, $until])
            ->orderBy('recorded_at')->orderBy('id')
            ->get(['latitude', 'longitude', 'accuracy_m', 'recorded_at']);

        // The trip starts at the pickup point when the passenger got on board.
        $anchor = $start !== null && $delivery->pickup_latitude !== null
            ? ['lat' => (float) $delivery->pickup_latitude, 'lng' => (float) $delivery->pickup_longitude, 'acc' => 0.0, 't' => $start->getTimestamp()]
            : null;
        $lastSeen = $anchor['t'] ?? null;

        $verified = 0.0;
        $unverified = 0.0;
        $gaps = [];
        $jumps = 0;
        $jitter = 0;
        $accuracies = [];

        foreach ($fixes as $fix) {
            $point = ['lat' => (float) $fix->latitude, 'lng' => (float) $fix->longitude, 'acc' => (float) ($fix->accuracy_m ?? 0), 't' => $fix->recorded_at->getTimestamp()];
            $accuracies[] = $point['acc'];
            if ($anchor === null) {
                $anchor = $point;
                $lastSeen = $point['t'];

                continue;
            }
            $d = $this->gps->distanceMeters($anchor['lat'], $anchor['lng'], $point['lat'], $point['lng']);
            $sinceSeen = max(0, $point['t'] - (int) $lastSeen);
            $sinceAnchor = max(1, $point['t'] - $anchor['t']);

            if ($sinceSeen > self::GAP_SECONDS) {
                // No fix for too long: whatever was driven is not verified.
                $unverified += $d;
                $gaps[] = ['from' => date('c', (int) $lastSeen), 'to' => date('c', $point['t']), 'seconds' => $sinceSeen, 'km' => round($d / 1000, 3)];
                $anchor = $point;
            } elseif ($d / $sinceAnchor > $maxSpeed && $d > max(self::MIN_JITTER_M, ($anchor['acc'] + $point['acc']) / 2)) {
                // Faster than any vehicle: excluded, never charged.
                $unverified += $d;
                $jumps++;
                $anchor = $point;
            } elseif ($d < max(self::MIN_JITTER_M, ($anchor['acc'] + $point['acc']) / 2)) {
                // GPS jitter: inside the fixes' own error. The anchor stays put.
                $jitter++;
            } else {
                $verified += $d;
                $anchor = $point;
            }
            $lastSeen = $point['t'];
        }

        $endShortM = null;
        if ($destination !== null && $anchor !== null) {
            $endShortM = $this->gps->distanceMeters($anchor['lat'], $anchor['lng'], $destination[0], $destination[1]);
            if ($endShortM > self::END_TOLERANCE_M) {
                $unverified += $endShortM;
            }
        }

        return [
            'verified_km' => $verified / 1000,
            'unverified_km' => $unverified / 1000,
            'points' => $fixes->count(),
            'gaps' => count($gaps),
            'jumps' => $jumps,
            'summary' => [
                'from' => $start?->toIso8601String(),
                'until' => $until->toIso8601String(),
                'fixes' => $fixes->count(),
                'first_fix_at' => $fixes->first()?->recorded_at?->toIso8601String(),
                'last_fix_at' => $fixes->last()?->recorded_at?->toIso8601String(),
                'jitter_fixes_ignored' => $jitter,
                'jumps_excluded' => $jumps,
                'gaps' => array_slice($gaps, 0, 20),
                'gap_count' => count($gaps),
                'end_short_of_destination_m' => $endShortM !== null ? (int) round($endShortM) : null,
                'accuracy_m' => $accuracies === [] ? null : [
                    'best' => round(min($accuracies), 1),
                    'worst' => round(max($accuracies), 1),
                    'mean' => round(array_sum($accuracies) / count($accuracies), 1),
                ],
                'rules' => [
                    'gap_seconds' => self::GAP_SECONDS,
                    'max_speed_kph' => (float) config('tracking.max_speed_kph', 150),
                    'jitter_m' => 'max('.self::MIN_JITTER_M.' m, mean accuracy of the two fixes)',
                    'end_tolerance_m' => self::END_TOLERANCE_M,
                ],
            ],
        ];
    }

    // ───────────────────────── helpers ─────────────────────────

    /** Same formula as booking (TransportationService::estimateFare). */
    public function fare(float $base, float $perKm, float $km): float
    {
        return round(max($base + round($km * $perKm, 2), $base), 2);
    }

    public static function cap(float $estimated): float
    {
        return round($estimated * self::MAX_FARE_FACTOR, 2);
    }

    /**
     * The one ride rule (booking, destination change, time charges and the
     * integrity check): max(₱20, 40% of the fare), never more than the fare,
     * so the office's share can never go below zero (§R5, 2026-11-24).
     */
    public static function commission(float $fare): float
    {
        return round(min(max($fare, 0), max(20, $fare * 0.4)), 2);
    }

    /** @return array{base_fare: float, per_km: float} The ride's booked rates. */
    private function bookedRates(Delivery $delivery): array
    {
        $notes = json_decode((string) $delivery->notes, true) ?: [];
        $quote = $notes['fare_quote'] ?? [];
        $base = $quote['base_fare'] ?? $notes['base_fare'] ?? null;
        $perKm = $quote['per_km'] ?? $notes['per_km'] ?? null;
        if ($base === null || $perKm === null) {
            $vehicle = (string) ($notes['vehicle_type'] ?? 'motorcycle');
            $rates = app(RideFareSettings::class)->forVehicle($vehicle);
            $base ??= $rates['base_fare'];
            $perKm ??= $rates['per_km'];
        }

        return ['base_fare' => (float) $base, 'per_km' => (float) $perKm];
    }

    private function readQuote(string $token, Order $order, User $tourist): array
    {
        try {
            $quote = json_decode(Crypt::decryptString($token), true);
        } catch (DecryptException) {
            throw new RideDestinationChangeException('This estimate is not valid. Review the new destination again.', 422);
        }
        if (! is_array($quote) || ($quote['v'] ?? null) !== 1
            || (int) ($quote['order_id'] ?? 0) !== (int) $order->id
            || (int) ($quote['user_id'] ?? 0) !== (int) $tourist->id) {
            throw new RideDestinationChangeException('This estimate is not for this ride. Review the new destination again.', 422);
        }
        if ((int) ($quote['expires_at'] ?? 0) < now()->timestamp) {
            throw new RideDestinationChangeException('This estimate has expired. Review the new destination again to see the current fare.', 422);
        }

        return $quote;
    }
}
