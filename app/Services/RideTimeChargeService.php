<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\RideAdditionalCharge;
use App\Models\RideTimeEvent;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Ride hailing — time-based additional fees, Phase 1: pickup waiting
 * (owner decisions 2026-11-18).
 *
 * ARRIVAL: the rider confirms arrival at the pickup ("I've arrived"). The
 * server checks the location — within tracking.arrival_radius_meters (100 m)
 * by the rider's fresh SAVED fix, or by the phone's own fix up to ±200 m
 * (DropoffLocationProof rules) — and records a pickup_arrival_confirmed
 * event at the SERVER time. Waiting starts there; a repeated confirmation
 * keeps the first time (UNIQUE event_key). Rides no longer arrive
 * automatically from the GPS heartbeat.
 *
 * WAITING FEE: when the trip starts ("Passenger on board", status picked_up)
 *   waiting_seconds = trip_started.occurred_at − pickup_arrival_confirmed.occurred_at (integer, ≥ 0)
 *   fee = floor(max(0, waiting_seconds − 180) / 180) × ₱2
 * recorded once as an itemised charge (UNIQUE charge_key). No arrival
 * confirmation → no waiting fee. A tourist cancelling while the rider waits
 * owes no waiting fee (cancelled rides take no payment).
 *
 * TOTAL: orders.subtotal stays the ride fare (booked, or a changed
 * destination's final fare — the 115% cap applies to that fare only); the
 * approved charges are added on top: orders.total = subtotal + charges, and
 * the rider commission follows the existing rule on the total:
 * max(₱20, 40% × total). Every application is a "ride_charges_applied"
 * ledger event; the booking quote is never changed.
 */
class RideTimeChargeService
{
    public const WAITING_FREE_SECONDS = 180;

    public const WAITING_UNIT_SECONDS = 180;

    public const WAITING_RATE = 2.0;

    public function __construct(
        private readonly DropoffLocationProof $proof,
        private readonly TransactionLedger $ledger,
    ) {}

    /** floor(max(0, seconds − 180) / 180) × ₱2 */
    public static function waitingFee(int $seconds): float
    {
        return (float) (intdiv(max(0, $seconds - self::WAITING_FREE_SECONDS), self::WAITING_UNIT_SECONDS) * (int) self::WAITING_RATE);
    }

    public function arrivalEvent(int $deliveryId): ?RideTimeEvent
    {
        return RideTimeEvent::where('event_key', 'pickup_arrival:'.$deliveryId)->first();
    }

    /**
     * Inside the rider's status transaction (locked delivery). Returns the
     * refusal message, or null when the arrival is (already) confirmed.
     */
    public function confirmPickupArrival(Delivery $locked, User $rider, ?array $deviceFix): ?string
    {
        if ($this->arrivalEvent($locked->id) !== null) {
            return null; // already confirmed: waiting keeps its first start
        }
        if ($locked->pickup_latitude === null || $locked->pickup_longitude === null) {
            return 'This ride has no pickup point to confirm against.';
        }

        $check = $this->proof->evaluate(
            $locked, (int) $rider->id, $deviceFix, "I've arrived at the ride pickup",
            'You must be within %d m of the pickup point to confirm your arrival (you are %s away).',
            [(float) $locked->pickup_latitude, (float) $locked->pickup_longitude],
            (float) config('tracking.arrival_radius_meters', 100),
        );
        if (! $check['ok']) {
            return $check['message'];
        }

        $fix = $check['source'] === 'device' ? (PickupEvidenceService::deviceFixFrom(request()) ?? $deviceFix) : null;
        $event = $this->record($locked, $rider, RideTimeEvent::PICKUP_ARRIVAL_CONFIRMED, 'pickup_arrival:'.$locked->id, [
            'latitude' => $fix['latitude'] ?? null,
            'longitude' => $fix['longitude'] ?? null,
            'accuracy_m' => $check['accuracy'],
            'location_source' => $check['source'],
            'reason' => 'Rider confirmed arrival at the pickup ('.(int) round((float) $check['distance']).' m away).',
        ]);
        $order = Order::find($locked->order_id);
        if ($order && $event) {
            $this->ledger->record($order, 'ride_time_event', [
                'event' => RideTimeEvent::PICKUP_ARRIVAL_CONFIRMED,
                'event_id' => $event->id,
                'at' => $event->occurred_at->toIso8601String(),
                'distance_m' => round((float) $check['distance'], 1),
                'location_source' => $check['source'],
                'waiting_rule' => 'first 180 s free, then ₱2 per completed 180 s',
            ], $locked);
        }

        return null;
    }

    /**
     * Inside the rider's status transaction, when the passenger is on board.
     * Records the trip start and, after a confirmed arrival, the waiting
     * charge — once — then re-applies the charges to the order total.
     */
    public function startTrip(Delivery $locked, User $rider, ?array $deviceFix): ?RideAdditionalCharge
    {
        $start = $this->record($locked, $rider, RideTimeEvent::TRIP_STARTED, 'trip_started:'.$locked->id, [
            'latitude' => is_numeric($deviceFix['latitude'] ?? null) ? (float) $deviceFix['latitude'] : null,
            'longitude' => is_numeric($deviceFix['longitude'] ?? null) ? (float) $deviceFix['longitude'] : null,
            'accuracy_m' => is_numeric($deviceFix['accuracy'] ?? null) ? (float) $deviceFix['accuracy'] : null,
            'location_source' => $deviceFix ? 'device' : null,
            'reason' => 'Passenger on board.',
        ]);
        $arrival = $this->arrivalEvent($locked->id);
        if ($arrival === null || $start === null) {
            return null;
        }

        $seconds = max(0, $start->occurred_at->getTimestamp() - $arrival->occurred_at->getTimestamp());
        try {
            $charge = RideAdditionalCharge::firstOrCreate(['charge_key' => 'pickup_waiting:'.$locked->id], [
                'order_id' => $locked->order_id,
                'delivery_id' => $locked->id,
                'charge_type' => RideAdditionalCharge::TYPE_PICKUP_WAITING,
                'start_event_id' => $arrival->id,
                'end_event_id' => $start->id,
                'duration_seconds' => $seconds,
                'free_seconds' => self::WAITING_FREE_SECONDS,
                'unit_seconds' => self::WAITING_UNIT_SECONDS,
                'rate' => self::WAITING_RATE,
                'method' => 'floor(max(0, seconds − 180) / 180) × ₱2',
                'amount' => self::waitingFee($seconds),
                'status' => RideAdditionalCharge::STATUS_APPROVED,
            ]);
        } catch (UniqueConstraintViolationException) {
            $charge = RideAdditionalCharge::where('charge_key', 'pickup_waiting:'.$locked->id)->first();
        }

        $this->applyCharges($locked);

        return $charge;
    }

    /**
     * orders.total = subtotal + approved charges; commission max(₱20, 40% × total).
     * Idempotent; a no-op while there is no charged amount.
     */
    public function applyCharges(Delivery $locked): void
    {
        $charges = RideAdditionalCharge::where('delivery_id', $locked->id)->where('status', RideAdditionalCharge::STATUS_APPROVED)->get();
        $chargesTotal = round((float) $charges->sum('amount'), 2);
        $order = Order::whereKey($locked->order_id)->lockForUpdate()->first();
        if ($order === null || $order->order_type !== 'transport' || $chargesTotal <= 0) {
            return;
        }
        $subtotal = round((float) $order->subtotal, 2);
        $total = round($subtotal + $chargesTotal, 2);
        $commission = RideDestinationChangeService::commission($total);
        if (abs((float) $order->total - $total) < 0.005 && abs((float) $locked->rider_commission - $commission) < 0.005) {
            return; // already applied
        }

        $order->update(['total' => $total]);
        $locked->forceFill(['rider_commission' => $commission])->save();
        $locked->unsetRelation('order');

        $this->ledger->record($order, 'ride_charges_applied', [
            'delivery_id' => $locked->id,
            'subtotal' => $subtotal,
            'charges' => $charges->map(fn (RideAdditionalCharge $c) => [
                'id' => $c->id, 'type' => $c->charge_type, 'duration_seconds' => $c->duration_seconds, 'amount' => $c->amount,
            ])->values()->all(),
            'charges_total' => $chargesTotal,
            'total' => $total,
            'rider_commission' => $commission,
            'commission_rule' => 'max(₱20, 40% of total)',
        ], $locked);
    }

    /** What the tourist and the rider see about pickup waiting. */
    public function waitingState(Delivery $delivery): array
    {
        $arrival = $this->arrivalEvent($delivery->id);
        $start = RideTimeEvent::where('event_key', 'trip_started:'.$delivery->id)->first();
        $charge = RideAdditionalCharge::where('charge_key', 'pickup_waiting:'.$delivery->id)->first();

        return [
            'arrived_at' => $arrival?->occurred_at?->toIso8601String(),
            'ended_at' => $start && $arrival ? $start->occurred_at->toIso8601String() : null,
            'server_now' => now()->toIso8601String(),
            'free_seconds' => self::WAITING_FREE_SECONDS,
            'unit_seconds' => self::WAITING_UNIT_SECONDS,
            'rate' => self::WAITING_RATE,
            'charged_seconds' => $charge?->duration_seconds,
            'amount' => $charge?->amount,
        ];
    }

    /** @return array<int, array> itemised approved charges */
    public function charges(int $deliveryId): array
    {
        return RideAdditionalCharge::where('delivery_id', $deliveryId)->where('status', RideAdditionalCharge::STATUS_APPROVED)
            ->orderBy('id')->get()->map->present()->values()->all();
    }

    private function record(Delivery $delivery, User $actor, string $type, string $key, array $extra): ?RideTimeEvent
    {
        $existing = RideTimeEvent::where('event_key', $key)->first();
        if ($existing) {
            return $existing;
        }
        try {
            return RideTimeEvent::create($extra + [
                'order_id' => $delivery->order_id,
                'delivery_id' => $delivery->id,
                'actor_id' => $actor->id,
                'actor_role' => (string) $actor->role,
                'event_type' => $type,
                'event_key' => $key,
                'occurred_at' => now(),
                'created_at' => now(),
            ]);
        } catch (UniqueConstraintViolationException) {
            return RideTimeEvent::where('event_key', $key)->first();
        }
    }
}
