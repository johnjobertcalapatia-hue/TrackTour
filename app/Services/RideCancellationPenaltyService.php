<?php

namespace App\Services;

use App\Exceptions\RidePenaltyException;
use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Payment;
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
 * STATUS (Stage C2, owner decisions 2026-11-18 and 2026-11-23): every
 * qualifying tourist cancellation is OWED, with no Tourism Office review and
 * no tourist dispute. The rider's GPS and arrival are still recorded as
 * EVIDENCE but never decide the status. WAIVED only from the Tourism Office,
 * with a reason. Earlier under-review / disputed penalties were made owed
 * (oweReviewed, 2026-11-23).
 *
 * COLLECTION (owner decision 2026-11-23): an owed fee is added to the
 * tourist's NEXT payment — a ride or a food order, whichever comes first.
 * Cash (ride or COD food): the driver / rider collects it with the fare or
 * order and confirms it (collectCash). Online: it is a line on the same
 * PayMongo checkout (payment_penalty_items) and is marked collected when
 * that payment is confirmed (applyOnlinePayment). Either way the fee stays
 * its own record: it never changes an order's amounts.
 *
 * A tourist cancelling while the rider waits pays no WAITING fee (Stage A);
 * this cancellation penalty is separate and may still apply.
 */
class RideCancellationPenaltyService
{
    public const FREE_SECONDS = 300;

    public const AMOUNT = 50.0;

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
                'rule' => 'tourist cancellation more than 300 s after acceptance: owed (Stage C2; GPS and arrival recorded as evidence only)',
            ], $delivery);
            ActivityLog::record(
                'ride.cancellation_penalty_assessed',
                "Ride {$cancelled->order_number}: ₱50 cancellation penalty {$status} ({$seconds} s after acceptance) for rider #{$delivery->rider_id}.",
                $cancelled,
                ActivityLog::TYPE_FINANCIAL,
            );
            // The tourist is told right away: ₱50, why, and what happens next (2026-11-18).
            $this->notifyTourist($penalty);
        }

        return $penalty;
    }

    /**
     * Owner decision 2026-11-23: no Tourism Office review and no dispute. A
     * penalty still under review or disputed becomes owed (recorded in the
     * ledger and activity log; a held compensation is released). Run once by
     * the 2026_11_23 migration; repeat-safe. Returns how many changed.
     */
    public function oweReviewed(): int
    {
        $changed = 0;
        $ids = RideCancellationPenalty::whereIn('status', [RideCancellationPenalty::STATUS_UNDER_REVIEW, RideCancellationPenalty::STATUS_DISPUTED])->pluck('id');
        foreach ($ids as $id) {
            DB::transaction(function () use ($id, &$changed) {
                $locked = RideCancellationPenalty::lockForUpdate()->find($id);
                if (! $locked || ! in_array($locked->status, [RideCancellationPenalty::STATUS_UNDER_REVIEW, RideCancellationPenalty::STATUS_DISPUTED], true)) {
                    return;
                }
                $from = $locked->status;
                $locked->forceFill(['status' => RideCancellationPenalty::STATUS_OWED])->save();
                $order = Order::find($locked->cancelled_order_id);
                if ($order) {
                    $this->ledger->record($order, 'ride_cancellation_penalty_now_owed', [
                        'penalty_id' => $locked->id,
                        'amount' => (float) $locked->penalty_amount,
                        'from' => $from,
                        'rule' => 'owner decision 2026-11-23: no review or dispute; owed fees are added to the next ride or food order payment',
                    ], $locked);
                    ActivityLog::record(
                        'ride.cancellation_penalty_now_owed',
                        "Ride {$order->order_number}: ₱".number_format((float) $locked->penalty_amount, 2)." cancellation fee is now owed (was {$from}).",
                        $order,
                        ActivityLog::TYPE_FINANCIAL,
                    );
                }
                app(RideCompensationService::class)->onOwedAgain($locked);
                $changed++;
            });
        }

        return $changed;
    }

    /**
     * Stage C2 (2026-11-18): the Tourism Office waives a penalty, with a
     * reason. Recorded in the tamper-evident ledger and the activity log;
     * the tourist is notified. A penalty already paid is refunded separately,
     * never "waived". Repeat-safe.
     */
    public function waive(RideCancellationPenalty $penalty, User $admin, string $reason): RideCancellationPenalty
    {
        $reason = trim($reason);
        if (mb_strlen($reason) < 5) {
            throw new RidePenaltyException('Give a reason for waiving this fee (at least 5 characters).', 422);
        }

        return DB::transaction(function () use ($penalty, $admin, $reason) {
            $locked = RideCancellationPenalty::lockForUpdate()->findOrFail($penalty->id);
            if ($locked->status === RideCancellationPenalty::STATUS_WAIVED) {
                return $locked;
            }
            if (in_array($locked->status, [RideCancellationPenalty::STATUS_COLLECTED, RideCancellationPenalty::STATUS_REFUNDED], true)) {
                throw new RidePenaltyException('This fee was already paid, so it cannot be waived. A refund is handled separately.', 422);
            }
            $from = $locked->status;
            $locked->forceFill([
                'status' => RideCancellationPenalty::STATUS_WAIVED,
                'resolved_at' => now(),
                'resolved_by' => $admin->id,
                'resolution_note' => $reason,
            ])->save();

            $order = Order::find($locked->cancelled_order_id);
            if ($order) {
                $this->ledger->record($order, 'ride_cancellation_penalty_waived', [
                    'penalty_id' => $locked->id,
                    'amount' => (float) $locked->penalty_amount,
                    'from' => $from,
                    'waived_by' => $admin->id,
                    'reason' => $reason,
                    'tourist_id' => $locked->tourist_id,
                    'compensated_rider_id' => (int) $locked->compensated_rider_id,
                ], $locked);
                ActivityLog::record(
                    'ride.cancellation_penalty_waived',
                    "Ride {$order->order_number}: ₱".number_format((float) $locked->penalty_amount, 2)." cancellation penalty waived (was {$from}). Reason: {$reason}",
                    $order,
                    ActivityLog::TYPE_FINANCIAL,
                );
            }
            // Stage D1: unpaid compensation is voided; one already paid is written off.
            app(RideCompensationService::class)->onWaived($locked, $reason, $admin);
            $this->notifyTourist($locked);

            return $locked;
        });
    }

    /** Approved penalties the tourist still owes (collected by Stage C). */
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

        // Stage C2 (owner decision 2026-11-18): every qualifying tourist
        // cancellation is OWED. GPS and arrival are recorded for reference
        // only (disputes, office review) and never decide the status; review
        // is reserved for disputes and Tourism Office action.
        return [RideCancellationPenalty::STATUS_OWED, [], $evidence];
    }

    /* ── Stage C (owner decisions 2026-11-18): collecting an OWED penalty ──
     * Never added to any order's amounts. Cash: the passenger's next driver
     * collects it at the drop-off and confirms it separately; online: its own
     * PayMongo payment. Under review / disputed / waived are never collected.
     * If the ride it would be collected on is cancelled or ends unpaid, it
     * simply stays owed for the next one. Paying the compensated rider is
     * Stage D. */

    /** The passenger's owed penalty this driver can collect on this ride, if any. */
    public function dueOnRide(Delivery $delivery): ?RideCancellationPenalty
    {
        return $this->dueOnDelivery($delivery);
    }

    /**
     * The customer's owed fee the driver / rider can collect on this ride or
     * food delivery (2026-11-23: food orders too), if any. Never the fee of
     * the very ride that was cancelled.
     */
    public function dueOnDelivery(Delivery $delivery): ?RideCancellationPenalty
    {
        $order = $delivery->primaryOrder() ?? $delivery->order;
        if (! $order || ! $order->user_id) {
            return null;
        }

        return RideCancellationPenalty::with('cancelledOrder:id,order_number')
            ->where('tourist_id', $order->user_id)
            ->where('status', RideCancellationPenalty::STATUS_OWED)
            ->where('cancelled_order_id', '!=', $order->id)
            ->orderBy('id')
            ->first();
    }

    /** The driver collected the passenger's owed ₱50 in cash at the drop-off. Repeat-safe. */
    public function collectCash(Delivery $delivery, User $rider, int $penaltyId): RideCancellationPenalty
    {
        return DB::transaction(function () use ($delivery, $rider, $penaltyId) {
            $locked = Delivery::with('order')->lockForUpdate()->findOrFail($delivery->id);
            $order = $locked->primaryOrder() ?? $locked->order;
            if ((int) $locked->rider_id !== (int) $rider->id || ! $order) {
                throw new RidePenaltyException('This is not your trip.', 403);
            }
            $isRide = $order->order_type === 'transport';
            $status = $locked->status instanceof \BackedEnum ? $locked->status->value : (string) $locked->status;
            // A ride: at the destination. A food delivery: at the customer's door.
            $atDropOff = $isRide
                ? ['arrived_destination', 'delivered', 'completed']
                : ['in_transit', 'arrived_destination', 'delivered', 'completed'];
            if (! in_array($status, $atDropOff, true)) {
                throw new RidePenaltyException('Collect the cancellation fee at the drop-off.', 422);
            }

            $penalty = RideCancellationPenalty::lockForUpdate()->find($penaltyId);
            if (! $penalty || (int) $penalty->tourist_id !== (int) $order->user_id || (int) $penalty->cancelled_order_id === (int) $order->id) {
                throw new RidePenaltyException('This passenger has no such cancellation fee.', 404);
            }
            if ($penalty->status === RideCancellationPenalty::STATUS_COLLECTED) {
                if ((int) $penalty->collection_delivery_id === (int) $locked->id && $penalty->collection_method === 'cash') {
                    return $penalty; // already recorded by this driver on this ride
                }
                throw new RidePenaltyException('This cancellation fee was already paid. Do not collect it again.', 409);
            }
            if ($penalty->status !== RideCancellationPenalty::STATUS_OWED) {
                throw new RidePenaltyException('This cancellation fee is not owed (it was waived). Do not collect it.', 409);
            }

            $penalty->forceFill([
                'status' => RideCancellationPenalty::STATUS_COLLECTED,
                'collected_at' => now(),
                'collection_method' => 'cash',
                'collected_by' => $rider->id,
                'collection_order_id' => $order->id,
                'collection_delivery_id' => $locked->id,
            ])->save();
            $this->recordCollected($penalty, ['method' => 'cash', 'collected_by' => $rider->id, 'collection_order_id' => $order->id, 'collection_delivery_id' => $locked->id]);

            return $penalty;
        });
    }

    /**
     * A PayMongo payment for the penalty was confirmed (inside the payment's
     * transaction). Returns false when it was already collected another way:
     * the money is then escalated for a manual refund, never applied twice.
     */
    public function collectOnline(RideCancellationPenalty $penalty, Payment $payment): bool
    {
        $locked = RideCancellationPenalty::lockForUpdate()->find($penalty->id);
        if (! $locked) {
            return false;
        }
        if ($locked->status === RideCancellationPenalty::STATUS_COLLECTED && (int) $locked->collection_payment_id === (int) $payment->id) {
            return true;
        }
        if ($locked->status !== RideCancellationPenalty::STATUS_OWED) {
            \App\Services\SystemIncidentRecorder::record(
                'payment', 'penalty_double_payment', 'warning',
                "Cancellation fee paid online after it was {$locked->status}: refund ₱".number_format((float) $payment->amount, 2),
                "Payment {$payment->payment_number} for cancellation fee #{$locked->id} arrived when the fee was already {$locked->status}. Refund it manually.",
                ['penalty_id' => $locked->id, 'payment_id' => $payment->id, 'penalty_status' => $locked->status],
                $payment,
                fingerprintKey: 'penalty-payment-'.$payment->id,
            );
            ActivityLog::record('ride.cancellation_penalty_payment_unapplied', "Payment {$payment->payment_number} for cancellation fee #{$locked->id} was not applied: the fee is {$locked->status}. Needs a manual refund.", $payment, ActivityLog::TYPE_FINANCIAL);

            return false;
        }

        $locked->forceFill([
            'status' => RideCancellationPenalty::STATUS_COLLECTED,
            'collected_at' => now(),
            'collection_method' => 'online',
            'collection_payment_id' => $payment->id,
            // Stage D1: a PayMongo-verified payment is money received.
            'received_amount' => (float) $locked->penalty_amount,
            'received_at' => now(),
        ])->save();
        $this->recordCollected($locked, ['method' => 'online', 'payment_id' => $payment->id, 'payment_number' => $payment->payment_number, 'provider_reference' => $payment->provider_source_id]);
        // The original accepting rider's compensation (or the advance recovered), once.
        app(RideCompensationService::class)->onReceived($locked);

        return true;
    }

    /**
     * Owner decision 2026-11-23: the tourist's owed fees to add to an online
     * ride / food checkout. $exceptOrderId excludes the fee of that very ride.
     *
     * @return \Illuminate\Support\Collection<int, RideCancellationPenalty>
     */
    public function owedForCheckout(int $touristId, ?int $exceptOrderId = null)
    {
        return RideCancellationPenalty::with('cancelledOrder:id,order_number')
            ->where('tourist_id', $touristId)
            ->where('status', RideCancellationPenalty::STATUS_OWED)
            ->when($exceptOrderId, fn ($q) => $q->where('cancelled_order_id', '!=', $exceptOrderId))
            ->orderBy('id')
            ->get();
    }

    /**
     * An online ride / food payment that also carried owed fees was
     * confirmed: mark each fee collected by this payment (once; a fee already
     * paid another way is escalated for a manual refund by collectOnline).
     * Returns the fee portion of the payment, which is never order money.
     */
    public function applyOnlinePayment(Payment $payment): float
    {
        $items = \App\Models\PaymentPenaltyItem::where('payment_id', $payment->id)->with('penalty')->get();
        foreach ($items as $item) {
            if ($item->applied_at === null && $item->penalty && $this->collectOnline($item->penalty, $payment)) {
                $item->forceFill(['applied_at' => now()])->save();
            }
        }

        return $this->feePortion($payment);
    }

    /** How much of an online payment paid cancellation fees (not the order). */
    public function feePortion(Payment $payment): float
    {
        return round((float) \App\Models\PaymentPenaltyItem::where('payment_id', $payment->id)->sum('amount'), 2);
    }

    /**
     * Stage D1: a received penalty payment was refunded to the tourist (manual
     * PayMongo refund or cash returned), linked to its actual refund
     * reference. The original rider's compensation follows the waiver rules.
     */
    public function recordRefund(RideCancellationPenalty $penalty, User $staff, string $reference, string $reason): RideCancellationPenalty
    {
        $reference = trim($reference);
        $reason = trim($reason);
        if ($reference === '' || mb_strlen($reason) < 5) {
            throw new RidePenaltyException('Enter the refund reference and a reason (at least 5 characters).', 422);
        }

        return DB::transaction(function () use ($penalty, $staff, $reference, $reason) {
            $locked = RideCancellationPenalty::lockForUpdate()->findOrFail($penalty->id);
            if ($locked->status === RideCancellationPenalty::STATUS_REFUNDED) {
                return $locked;
            }
            if ($locked->status !== RideCancellationPenalty::STATUS_COLLECTED || $locked->received_at === null) {
                throw new RidePenaltyException('Only a cancellation fee the office has fully received can be refunded.', 422);
            }
            $locked->forceFill(['status' => RideCancellationPenalty::STATUS_REFUNDED, 'refunded_at' => now(), 'refund_reference' => $reference])->save();
            $order = Order::find($locked->cancelled_order_id);
            if ($order) {
                $this->ledger->record($order, 'ride_cancellation_penalty_refunded', [
                    'penalty_id' => $locked->id, 'amount' => (float) $locked->penalty_amount, 'refund_reference' => $reference,
                    'reason' => $reason, 'refunded_by' => $staff->id, 'collection_method' => $locked->collection_method,
                ], $locked);
                ActivityLog::record('ride.cancellation_penalty_refunded', "Ride {$order->order_number}: ₱".number_format((float) $locked->penalty_amount, 2)." cancellation fee refunded (reference {$reference}). Reason: {$reason}", $order, ActivityLog::TYPE_FINANCIAL);
            }
            app(RideCompensationService::class)->onRefunded($locked, $reason, $staff);

            return $locked;
        });
    }

    private function recordCollected(RideCancellationPenalty $penalty, array $details): void
    {
        $order = Order::find($penalty->cancelled_order_id);
        if ($order) {
            $this->ledger->record($order, 'ride_cancellation_penalty_collected', [
                'penalty_id' => $penalty->id,
                'amount' => (float) $penalty->penalty_amount,
                'compensated_rider_id' => (int) $penalty->compensated_rider_id,
            ] + $details, $penalty);
            ActivityLog::record(
                'ride.cancellation_penalty_collected',
                "Ride {$order->order_number}: ₱".number_format((float) $penalty->penalty_amount, 2)." cancellation fee collected ({$details['method']}), owed to rider #{$penalty->compensated_rider_id}.",
                $order,
                ActivityLog::TYPE_FINANCIAL,
            );
        }
        $this->notifyTourist($penalty);
    }

    /** In-app notification to the tourist (bell). Never breaks the money step. */
    private function notifyTourist(RideCancellationPenalty $penalty): void
    {
        if (! $penalty->tourist_id) {
            return;
        }
        try {
            $notice = $penalty->loadMissing('cancelledOrder:id,order_number')->notice();
            Notification::create([
                'user_id' => $penalty->tourist_id,
                'title' => $notice['title'],
                'message' => $notice['message'],
                'type' => 'ride_cancellation_penalty',
            ]);
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
