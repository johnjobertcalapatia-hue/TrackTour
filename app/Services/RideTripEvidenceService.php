<?php

namespace App\Services;

use App\Models\Delivery;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Ride trip evidence (Stage 4, observe-only). At each ride step the rider's
 * location is recorded — the device fix sent with the request and the
 * server-saved fix, kept apart, each with accuracy, fix age and distance to
 * the step's target — once per step on deliveries.trip_evidence and as an
 * immutable "trip_evidence" ledger event. GPS refusals during an active ride
 * are recorded as "gps_anomaly" events (throttled). Nothing here allows or
 * blocks a step: the evidence feeds investigation and integrity FLAGs only.
 * Offline gaps are never recorded as anomalies. No PIN (decision 2026-11-11).
 */
class RideTripEvidenceService
{
    /** Delivery status reached → evidence step and its target. */
    public const STEPS = [
        'picked_up' => ['step' => 'passenger_on_board', 'target' => 'pickup'],
        'arrived_destination' => ['step' => 'arrived_destination', 'target' => 'destination'],
        'delivered' => ['step' => 'completed', 'target' => 'destination'],
    ];

    public const ACTIVE_STATUSES = ['assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'];

    public function __construct(
        private readonly PickupEvidenceService $evidence,
        private readonly TransactionLedger $ledger,
    ) {}

    public static function isRide(Delivery $delivery): bool
    {
        return strtolower((string) ($delivery->primaryOrder()?->order_type ?? '')) === 'transport';
    }

    /**
     * Record the step reached by $status (call inside the transition's
     * transaction, on the locked delivery). Written once per step.
     */
    public function recordStep(Delivery $delivery, string $status, int $riderId, ?array $deviceFix): void
    {
        $map = self::STEPS[$status] ?? null;
        if ($map === null || ! self::isRide($delivery)) {
            return;
        }
        $all = $delivery->trip_evidence ?? [];
        if (isset($all[$map['step']])) {
            return;
        }

        [$lat, $lng] = $map['target'] === 'pickup'
            ? [$delivery->pickup_latitude, $delivery->pickup_longitude]
            : [$delivery->delivery_latitude, $delivery->delivery_longitude];
        $evidence = $this->evidence->captureAt($riderId, $lat, $lng, $map['target'], $deviceFix);

        $all[$map['step']] = $evidence;
        $delivery->forceFill(['trip_evidence' => $all])->save();

        $this->ledger->recordForOrders(TransactionLedger::ordersForDelivery($delivery), 'trip_evidence', [
            'delivery_id' => $delivery->id,
            'step' => $map['step'],
            'evidence' => $evidence,
        ], $delivery);
    }

    /**
     * A location the server refused during an active ride. Throttled to one
     * event per reason per minute per ride; never blocks the heartbeat.
     */
    public function recordGpsAnomaly(int $riderId, string $reason, array $details = []): void
    {
        try {
            $delivery = Delivery::where('rider_id', $riderId)->whereIn('status', self::ACTIVE_STATUSES)->latest('id')->first();
            if (! $delivery || ! self::isRide($delivery)) {
                return;
            }
            if (! Cache::add("ride-gps-anomaly:{$delivery->id}:{$reason}", true, 60)) {
                return;
            }
            $this->ledger->recordForOrders(TransactionLedger::ordersForDelivery($delivery), 'gps_anomaly', [
                'delivery_id' => $delivery->id,
                'rider_id' => $riderId,
                'reason' => $reason,
                'delivery_status' => TransactionLedger::scalar($delivery->status),
            ] + $details, $delivery);
        } catch (Throwable $e) {
            report($e);
        }
    }
}
