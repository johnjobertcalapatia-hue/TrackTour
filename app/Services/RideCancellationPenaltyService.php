<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RideCancellationPenalty;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Ride hailing — Stage B: tourist cancellation penalty assessment (owner
 * decisions 2026-11-18).
 *
 * WHEN: only a TOURIST cancellation (TransportationService::cancelRide) of a
 * ride a rider had accepted, more than 300 s after deliveries.assigned_at
 * (exactly 300 s is free). Rider, admin and safety cancellations and dispatch
 * failures never reach this. One penalty per cancelled ride (UNIQUE), ₱50,
 * owed to the rider who accepted — never to anyone else.
 *
 * EVIDENCE (no invented GPS rule; dev data 2026-11-18 had no saved accuracy
 * values and no real pickup approaches to calibrate a movement threshold):
 *   1. recent GPS — at least one saved rider fix since acceptance, and the
 *      latest saved fix no more than 180 s before the cancellation;
 *   2. arrival — a server-confirmed pickup arrival (Stage A) is strong
 *      evidence the rider reached the pickup.
 * OWED only when both hold. Otherwise UNDER_REVIEW with the reasons and the
 * evidence recorded (fix count, ages, distances to the pickup, accuracy
 * coverage) — movement toward the pickup is NOT judged automatically until
 * real accuracy/frequency data supports a threshold. Under-review or disputed
 * penalties are never collected and never block a booking.
 *
 * A tourist cancelling while the rider waits pays no WAITING fee (Stage A);
 * this cancellation penalty is separate and may still apply.
 */
class RideCancellationPenaltyService
{
    public const FREE_SECONDS = 300;

    public const AMOUNT = 50.0;

    public const RECENT_FIX_SECONDS = 180;

    public function __construct(
        private readonly TransactionLedger $ledger,
        private readonly GpsService $gps,
        private readonly RideTimeChargeService $timeCharges,
    ) {}

    /**
     * Inside the tourist's cancel transaction, on the locked rows, after the
     * order was marked cancelled. Returns the penalty, or null when free.
     */
    public function assess(Order $cancelled, ?Delivery $delivery, ?int $touristId): ?RideCancellationPenalty
    {
        if ($cancelled->order_type !== 'transport' || ! $delivery?->rider_id || ! $delivery->assigned_at) {
            return null; // before acceptance: free
        }
        $cancelledAt = $cancelled->cancelled_at ?? now();
        $seconds = max(0, $cancelledAt->getTimestamp() - $delivery->assigned_at->getTimestamp());
        if ($seconds <= self::FREE_SECONDS) {
            return null; // within 300 s of acceptance: free
        }

        [$status, $reasons, $evidence] = $this->judge($delivery, $cancelledAt);

        try {
            $penalty = RideCancellationPenalty::firstOrCreate(['cancelled_order_id' => $cancelled->id], [
                'delivery_id' => $delivery->id,
                'tourist_id' => $touristId ?? $cancelled->user_id,
                'compensated_rider_id' => $delivery->rider_id,
                'penalty_amount' => self::AMOUNT,
                'acceptance_at' => $delivery->assigned_at,
                'cancelled_at' => $cancelledAt,
                'seconds_after_acceptance' => $seconds,
                'status' => $status,
                'evidence' => $evidence,
                'review_reasons' => $reasons,
            ]);
        } catch (UniqueConstraintViolationException) {
            return RideCancellationPenalty::where('cancelled_order_id', $cancelled->id)->first();
        }

        if ($penalty->wasRecentlyCreated) {
            $this->ledger->record($cancelled, 'ride_cancellation_penalty_assessed', [
                'penalty_id' => $penalty->id,
                'amount' => self::AMOUNT,
                'compensated_rider_id' => (int) $delivery->rider_id,
                'tourist_id' => $penalty->tourist_id,
                'acceptance_at' => $delivery->assigned_at->toIso8601String(),
                'cancelled_at' => $cancelledAt->toIso8601String(),
                'seconds_after_acceptance' => $seconds,
                'status' => $status,
                'review_reasons' => $reasons,
                'rule' => 'tourist cancellation more than 300 s after acceptance; owed only with a confirmed pickup arrival and recent GPS',
            ], $delivery);
            ActivityLog::record(
                'ride.cancellation_penalty_assessed',
                "Ride {$cancelled->order_number}: ₱50 cancellation penalty ".($status === RideCancellationPenalty::STATUS_OWED ? 'owed' : 'under review')
                    ." ({$seconds} s after acceptance) for rider #{$delivery->rider_id}.".($reasons ? ' '.implode(' ', $reasons) : ''),
                $cancelled,
                ActivityLog::TYPE_FINANCIAL,
            );
        }

        return $penalty;
    }

    /** The tourist disputes an owed or under-review penalty. Idempotent. */
    public function dispute(RideCancellationPenalty $penalty, User $tourist, string $reason): RideCancellationPenalty
    {
        return DB::transaction(function () use ($penalty, $tourist, $reason) {
            $locked = RideCancellationPenalty::lockForUpdate()->findOrFail($penalty->id);
            if ((int) $locked->tourist_id !== (int) $tourist->id) {
                throw new \App\Exceptions\RidePenaltyException('This penalty is not yours.', 403);
            }
            if ($locked->status === RideCancellationPenalty::STATUS_DISPUTED) {
                return $locked;
            }
            if (! in_array($locked->status, [RideCancellationPenalty::STATUS_OWED, RideCancellationPenalty::STATUS_UNDER_REVIEW], true)) {
                throw new \App\Exceptions\RidePenaltyException('This penalty can no longer be disputed.', 422);
            }
            $from = $locked->status;
            $locked->forceFill(['status' => RideCancellationPenalty::STATUS_DISPUTED, 'disputed_at' => now(), 'dispute_reason' => $reason])->save();
            $order = Order::find($locked->cancelled_order_id);
            if ($order) {
                $this->ledger->record($order, 'ride_cancellation_penalty_disputed', [
                    'penalty_id' => $locked->id, 'from' => $from, 'tourist_id' => $tourist->id, 'reason' => $reason,
                ], $locked);
                ActivityLog::record('ride.cancellation_penalty_disputed', "Ride {$order->order_number}: the tourist disputed the ₱50 cancellation penalty. Reason: {$reason}", $order, ActivityLog::TYPE_FINANCIAL);
            }

            return $locked;
        });
    }

    /** Approved penalties the tourist still owes (collection arrives in Stage C). */
    public function outstandingFor(int $touristId)
    {
        return RideCancellationPenalty::where('tourist_id', $touristId)->where('status', RideCancellationPenalty::STATUS_OWED)->orderBy('id')->get();
    }

    /** Before cancelling: is it still free, and until when? */
    public function preview(?Delivery $delivery): ?array
    {
        if (! $delivery?->rider_id || ! $delivery->assigned_at) {
            return null;
        }
        $freeUntil = $delivery->assigned_at->copy()->addSeconds(self::FREE_SECONDS);

        return [
            'amount' => self::AMOUNT,
            'free_seconds' => self::FREE_SECONDS,
            'accepted_at' => $delivery->assigned_at->toIso8601String(),
            'free_until' => $freeUntil->toIso8601String(),
            'server_now' => now()->toIso8601String(),
            'applies_now' => now()->gt($freeUntil),
        ];
    }

    /** @return array{0: string, 1: list<string>, 2: array} */
    private function judge(Delivery $delivery, $cancelledAt): array
    {
        $fixes = RiderLocation::where('rider_id', $delivery->rider_id)
            ->where('recorded_at', '>=', $delivery->assigned_at)->where('recorded_at', '<=', $cancelledAt)
            ->orderBy('recorded_at')->get(['latitude', 'longitude', 'accuracy_m', 'recorded_at']);
        $latest = $fixes->last();
        $first = $fixes->first();
        $arrival = $this->timeCharges->arrivalEvent($delivery->id);
        $distance = fn ($fix) => $fix && $delivery->pickup_latitude !== null
            ? (int) round($this->gps->distanceMeters((float) $fix->latitude, (float) $fix->longitude, (float) $delivery->pickup_latitude, (float) $delivery->pickup_longitude))
            : null;
        $latestAge = $latest ? max(0, $cancelledAt->getTimestamp() - $latest->recorded_at->getTimestamp()) : null;

        $evidence = [
            'fixes_since_acceptance' => $fixes->count(),
            'fixes_with_accuracy' => $fixes->whereNotNull('accuracy_m')->count(),
            'first_fix_at' => $first?->recorded_at?->toIso8601String(),
            'first_fix_distance_to_pickup_m' => $distance($first),
            'latest_fix_at' => $latest?->recorded_at?->toIso8601String(),
            'latest_fix_age_s' => $latestAge,
            'latest_fix_distance_to_pickup_m' => $distance($latest),
            'latest_fix_accuracy_m' => $latest?->accuracy_m !== null ? (float) $latest->accuracy_m : null,
            'pickup_arrival_confirmed_at' => $arrival?->occurred_at?->toIso8601String(),
        ];

        $reasons = [];
        if ($fixes->isEmpty()) {
            $reasons[] = 'No saved rider location since the booking was accepted.';
        } elseif ($latestAge > self::RECENT_FIX_SECONDS) {
            $reasons[] = "The rider's latest saved location was {$latestAge} s before the cancellation (more than 3 minutes).";
        }
        if ($arrival === null) {
            $reasons[] = 'The rider had not confirmed arrival at the pickup; progress toward the pickup is not judged automatically yet.';
        }

        return [$reasons === [] ? RideCancellationPenalty::STATUS_OWED : RideCancellationPenalty::STATUS_UNDER_REVIEW, $reasons, $evidence];
    }
}
