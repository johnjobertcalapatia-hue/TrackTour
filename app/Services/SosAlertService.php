<?php

namespace App\Services;

use App\Exceptions\SosException;
use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderLocation;
use App\Models\SosAlert;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * SOS alerts (owner decisions 2026-11-18):
 * - a tourist during a ride, or a rider during any trip (ride or food), can raise one;
 * - it goes to the Bansud Tourism Office (in-app, no SMS);
 * - one active alert per sender per trip: a repeat refreshes its location;
 * - the other party on the trip is never told;
 * - only the Tourism Office resolves it ("I'm safe" from the sender is noted,
 *   the alert stays open until an admin closes it).
 */
class SosAlertService
{
    /** A trip with a rider bound to it that has not ended. */
    public const ACTIVE_TRIP = ['assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'];

    /** A rider GPS fix younger than this stands in when the device sent none. */
    private const RIDER_FIX_MAX_AGE_SECONDS = 300;

    /**
     * @param  array{latitude?: float|null, longitude?: float|null, accuracy?: float|null}  $location
     * @return array{0: SosAlert, 1: bool} the alert and whether it was created now
     */
    public function raiseForRide(User $tourist, Order $order, array $location = [], ?string $message = null): array
    {
        if ($order->order_type !== 'transport') {
            throw new SosException('SOS is for rides.');
        }

        return $this->raise($tourist, 'tourist', $order->delivery()->value('id'), $location, $message);
    }

    /** @return array{0: SosAlert, 1: bool} */
    public function raiseForRider(User $rider, Delivery $delivery, array $location = [], ?string $message = null): array
    {
        if ((int) $delivery->rider_id !== (int) $rider->id) {
            throw new SosException('This trip is not yours.', 403);
        }

        return $this->raise($rider, 'rider', $delivery->id, $location, $message);
    }

    /** @return array{0: SosAlert, 1: bool} */
    private function raise(User $sender, string $role, ?int $deliveryId, array $location, ?string $message): array
    {
        if (! $deliveryId) {
            throw new SosException('SOS is available once a rider is on the trip.');
        }

        return DB::transaction(function () use ($sender, $role, $deliveryId, $location, $message) {
            // Locking the trip serialises a double press: one alert, never two.
            $delivery = Delivery::with('order')->lockForUpdate()->findOrFail($deliveryId);
            $status = self::statusOf($delivery);
            if (! $delivery->rider_id || ! in_array($status, self::ACTIVE_TRIP, true)) {
                throw new SosException('SOS is available only while the trip is in progress.');
            }
            if ($role === 'tourist' && $delivery->order?->customer_email !== $sender->email) {
                throw new SosException('This ride is not yours.', 403);
            }

            $fix = $this->locationFor($location, (int) $delivery->rider_id);
            $message = $message !== null && trim($message) !== '' ? Str::limit(trim($message), 500, '') : null;

            $open = SosAlert::query()
                ->where('raised_by', $sender->id)
                ->where('delivery_id', $delivery->id)
                ->whereIn('status', SosAlert::ACTIVE)
                ->lockForUpdate()
                ->first();

            if ($open) {
                $open->fill(array_filter($fix, fn ($v) => $v !== null));
                if ($message !== null && $open->message === null) {
                    $open->message = $message;
                }
                $open->save();

                return [$open, false];
            }

            $alert = SosAlert::create([
                'reference' => $this->newReference(),
                'raised_by' => $sender->id,
                'raised_by_role' => $role,
                'service' => $delivery->order?->order_type === 'transport' ? 'ride' : 'food',
                'order_id' => $delivery->order_id,
                'delivery_id' => $delivery->id,
                'trip_status' => $status,
                'message' => $message,
                'status' => SosAlert::STATUS_PENDING,
                'raised_at' => now(),
            ] + $fix);

            ActivityLog::record('sos.raised', "SOS {$alert->reference} raised by the {$role} on order #".($delivery->order?->order_number ?? $delivery->order_id), $alert, ActivityLog::TYPE_SECURITY);

            return [$alert, true];
        });
    }

    /** deliveries.status is cast to the TripStatus enum. */
    private static function statusOf(Delivery $delivery): ?string
    {
        $status = $delivery->status;

        return $status instanceof \BackedEnum ? (string) $status->value : ($status !== null ? (string) $status : null);
    }

    /** Device fix when sent; otherwise the rider's recent GPS (riders, and passengers riding with them). */
    private function locationFor(array $location, int $riderId): array
    {
        $lat = $location['latitude'] ?? null;
        $lng = $location['longitude'] ?? null;
        if (is_numeric($lat) && is_numeric($lng)) {
            return [
                'latitude' => (float) $lat,
                'longitude' => (float) $lng,
                'accuracy_m' => is_numeric($location['accuracy'] ?? null) ? round((float) $location['accuracy'], 1) : null,
                'location_at' => now(),
                'location_source' => 'device',
            ];
        }

        $gps = $this->recentRiderFix($riderId);

        return $gps ? [
            'latitude' => (float) $gps->latitude,
            'longitude' => (float) $gps->longitude,
            'accuracy_m' => $gps->accuracy_m !== null ? (float) $gps->accuracy_m : null,
            'location_at' => $gps->recorded_at,
            'location_source' => 'rider_gps',
        ] : ['latitude' => null, 'longitude' => null, 'accuracy_m' => null, 'location_at' => null, 'location_source' => null];
    }

    private function recentRiderFix(int $riderId): ?RiderLocation
    {
        return RiderLocation::query()
            ->where('rider_id', $riderId)
            ->where('recorded_at', '>=', now()->subSeconds(self::RIDER_FIX_MAX_AGE_SECONDS))
            ->latest('recorded_at')
            ->first();
    }

    private function newReference(): string
    {
        do {
            $ref = 'SOS-'.now()->format('ymd').'-'.Str::upper(Str::random(4));
        } while (SosAlert::where('reference', $ref)->exists());

        return $ref;
    }

    /** The sender says they are safe now; the alert stays open until the Tourism Office closes it. */
    public function markSafe(User $sender, SosAlert $alert): SosAlert
    {
        if ((int) $alert->raised_by !== (int) $sender->id) {
            throw new SosException('This SOS is not yours.', 403);
        }

        return DB::transaction(function () use ($alert) {
            $locked = SosAlert::lockForUpdate()->findOrFail($alert->id);
            if ($locked->isActive() && ! $locked->sender_safe_at) {
                $locked->update(['sender_safe_at' => now()]);
                ActivityLog::record('sos.sender_safe', "SOS {$locked->reference}: the sender says they are safe", $locked, ActivityLog::TYPE_SECURITY);
            }

            return $locked;
        });
    }

    /** The sender's open SOS on this trip, if any. */
    public function activeFor(User $sender, ?int $deliveryId): ?SosAlert
    {
        if (! $deliveryId) {
            return null;
        }

        return SosAlert::where('raised_by', $sender->id)->where('delivery_id', $deliveryId)
            ->whereIn('status', SosAlert::ACTIVE)->latest('id')->first();
    }

    /** The sender's latest SOS on this trip (active or resolved), for their trip screen. */
    public function latestFor(User $sender, ?int $deliveryId): ?SosAlert
    {
        if (! $deliveryId) {
            return null;
        }

        return SosAlert::where('raised_by', $sender->id)->where('delivery_id', $deliveryId)->latest('id')->first();
    }

    /* ── Tourism Office ──────────────────────────────────────────────── */

    public function acknowledge(User $admin, int $id): SosAlert
    {
        return $this->transition($id, function (SosAlert $a) use ($admin) {
            if ($a->status !== SosAlert::STATUS_PENDING) {
                return false; // already acknowledged or further: nothing to do
            }
            $a->fill(['status' => SosAlert::STATUS_ACKNOWLEDGED, 'acknowledged_at' => now(), 'acknowledged_by' => $admin->id]);

            return "SOS {$a->reference} acknowledged";
        });
    }

    public function respond(User $admin, int $id, string $responder, ?string $note): SosAlert
    {
        return $this->transition($id, function (SosAlert $a) use ($admin, $responder, $note) {
            $a->fill([
                'status' => SosAlert::STATUS_RESPONDING,
                'acknowledged_at' => $a->acknowledged_at ?? now(),
                'acknowledged_by' => $a->acknowledged_by ?? $admin->id,
                'responding_at' => $a->responding_at ?? now(),
                'responding_by' => $a->responding_by ?? $admin->id,
                'responder' => Str::limit(trim($responder), 120, ''),
                'response_note' => $note !== null && trim($note) !== '' ? Str::limit(trim($note), 1000, '') : $a->response_note,
            ]);

            return "SOS {$a->reference}: help sent ({$a->responder})";
        });
    }

    public function resolve(User $admin, int $id, string $outcome, string $note): SosAlert
    {
        if (! in_array($outcome, [SosAlert::OUTCOME_HANDLED, SosAlert::OUTCOME_FALSE_ALARM], true)) {
            throw new SosException('Choose how the SOS ended.');
        }

        return $this->transition($id, function (SosAlert $a) use ($admin, $outcome, $note) {
            $a->fill([
                'status' => SosAlert::STATUS_RESOLVED,
                'acknowledged_at' => $a->acknowledged_at ?? now(),
                'acknowledged_by' => $a->acknowledged_by ?? $admin->id,
                'resolved_at' => now(),
                'resolved_by' => $admin->id,
                'outcome' => $outcome,
                'resolution_note' => Str::limit(trim($note), 1000, ''),
            ]);

            return "SOS {$a->reference} resolved (".($outcome === SosAlert::OUTCOME_FALSE_ALARM ? 'false alarm' : 'handled').')';
        });
    }

    /** @param  callable(SosAlert): (string|false)  $change  returns the log line, or false for no change */
    private function transition(int $id, callable $change): SosAlert
    {
        return DB::transaction(function () use ($id, $change) {
            $alert = SosAlert::lockForUpdate()->find($id);
            if (! $alert) {
                throw new SosException('SOS not found.', 404);
            }
            if (! $alert->isActive()) {
                throw new SosException('This SOS is already resolved.');
            }
            $log = $change($alert);
            if ($log !== false) {
                $alert->save();
                ActivityLog::record('sos.'.$alert->status, $log, $alert, ActivityLog::TYPE_SECURITY);
            }

            return $alert;
        });
    }

    /** Everything the Tourism Office needs to act. */
    public function presentForAdmin(SosAlert $a): array
    {
        $a->loadMissing('sender.profile', 'order', 'delivery.rider.profile', 'delivery.rider.riderDetail', 'acknowledger:id,name', 'respondingAdmin:id,name', 'resolver:id,name');
        $order = $a->order;
        $rider = $a->delivery?->rider;
        $detail = $rider?->riderDetail;
        $isTourist = $a->raised_by_role === 'tourist';

        $driver = $rider ? [
            'name' => $rider->name,
            'phone' => $rider->profile?->mobile_number,
            'vehicle_type' => $detail?->vehicle_type,
            'plate_number' => $detail?->vehicle_plate_number,
        ] : null;
        $customer = $order ? ['name' => $order->customer_name, 'phone' => $order->customer_phone] : null;

        // The live position: the rider's GPS (the passenger rides with them).
        $gps = $rider ? $this->latestRiderFix((int) $rider->id) : null;

        return [
            'id' => $a->id,
            'reference' => $a->reference,
            'status' => $a->status,
            'active' => $a->isActive(),
            'raised_by_role' => $a->raised_by_role,
            'service' => $a->service,
            'reporter' => [
                'name' => $a->sender?->name,
                'phone' => $isTourist ? ($order?->customer_phone ?: $a->sender?->profile?->mobile_number) : $a->sender?->profile?->mobile_number,
            ],
            // The other person on the trip (never told about the SOS).
            'other_party' => $isTourist
                ? ($driver ? ['role' => 'driver'] + $driver : null)
                : ($customer ? ['role' => $a->service === 'ride' ? 'passenger' : 'customer'] + $customer : null),
            'driver' => $driver,
            'rider_id' => $rider?->id,
            'order' => $order ? [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'pickup' => $a->delivery?->pickup_address,
                'dropoff' => $order->delivery_address,
            ] : null,
            'trip_status' => $a->trip_status,
            'current_trip_status' => $a->delivery ? self::statusOf($a->delivery) : null,
            'message' => $a->message,
            'location' => $a->latitude !== null ? [
                'latitude' => $a->latitude,
                'longitude' => $a->longitude,
                'accuracy_m' => $a->accuracy_m,
                'at' => $a->location_at?->toIso8601String(),
                'source' => $a->location_source,
            ] : null,
            'live_location' => $gps ? [
                'latitude' => (float) $gps->latitude,
                'longitude' => (float) $gps->longitude,
                'accuracy_m' => $gps->accuracy_m !== null ? (float) $gps->accuracy_m : null,
                'at' => $gps->recorded_at?->toIso8601String(),
            ] : null,
            'raised_at' => $a->raised_at?->toIso8601String(),
            'sender_safe_at' => $a->sender_safe_at?->toIso8601String(),
            'acknowledged_at' => $a->acknowledged_at?->toIso8601String(),
            'acknowledged_by' => $a->acknowledger?->name,
            'responding_at' => $a->responding_at?->toIso8601String(),
            'responding_by' => $a->respondingAdmin?->name,
            'responder' => $a->responder,
            'response_note' => $a->response_note,
            'resolved_at' => $a->resolved_at?->toIso8601String(),
            'resolved_by' => $a->resolver?->name,
            'outcome' => $a->outcome,
            'resolution_note' => $a->resolution_note,
        ];
    }

    private function latestRiderFix(int $riderId): ?RiderLocation
    {
        return RiderLocation::where('rider_id', $riderId)->latest('recorded_at')->first();
    }
}
