<?php

namespace App\Services;

use App\Exceptions\RidePenaltyException;
use App\Models\ActivityLog;
use App\Models\Order;
use App\Models\RideCancellationPenalty;
use App\Models\RiderCancellationCompensation as Comp;
use App\Models\RiderCompensationEntry as Entry;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Stage D1 (docs/secure-transaction-audit.md §P): the ₱50 compensation owed
 * to the rider who ACCEPTED a cancelled booking (penalty.compensated_rider_id;
 * never the rider who later collects cash). Exactly one per penalty:
 *
 *   onReceived  the full penalty was received (PayMongo-verified, or staff
 *               confirmed the cash receipt): create it (funding collection),
 *               or — when it was advanced — record the advance as recovered
 *               (the rider is never credited twice).
 *   advance     explicit, approved, exceptional: create it before collection.
 *   onWaived / onRefunded   void it while unpaid; write it off once paid.
 *   onDisputed  hold an advanced, still unpaid compensation.
 *
 * Callers hold the penalty row lock (inside their transaction).
 */
class RideCompensationService
{
    public function __construct(
        private readonly RideCompensationLedger $ledger,
        private readonly TransactionLedger $orderLedger,
    ) {}

    public function forPenalty(int $penaltyId): ?Comp
    {
        return Comp::where('penalty_id', $penaltyId)->first();
    }

    /** The full penalty was received. Call inside the transaction that holds the penalty lock. */
    public function onReceived(RideCancellationPenalty $penalty, ?User $actor = null): ?Comp
    {
        if (! $penalty->compensated_rider_id || $penalty->received_at === null) {
            return null;
        }
        $comp = Comp::where('penalty_id', $penalty->id)->lockForUpdate()->first();

        if (! $comp) {
            try {
                $comp = Comp::create([
                    'penalty_id' => $penalty->id,
                    'rider_id' => $penalty->compensated_rider_id,
                    'cancelled_order_id' => $penalty->cancelled_order_id,
                    'amount' => (float) $penalty->penalty_amount,
                    'funding' => Comp::FUNDING_COLLECTION,
                    'status' => Comp::STATUS_PAYABLE,
                    'earned_at' => now(),
                ]);
            } catch (UniqueConstraintViolationException) {
                return Comp::where('penalty_id', $penalty->id)->first();
            }
            $this->ledger->write($comp, Entry::COMPENSATION_EARNED, 'earned', (float) $comp->amount, "comp:{$comp->id}:earned", $actor?->id,
                'Tourist paid the cancellation fee', ['received_at' => $penalty->received_at?->toIso8601String(), 'collection_method' => $penalty->collection_method]);
            $this->record($penalty, 'ride_compensation_earned', $comp, ['funding' => Comp::FUNDING_COLLECTION, 'collection_method' => $penalty->collection_method], $actor,
                'compensation of ₱%s earned by rider #%d (tourist paid)');

            return $comp;
        }

        if ($comp->status === Comp::STATUS_PENDING_APPROVAL) {
            // An advance still waiting for its second approver was never
            // credited: the tourist's payment funds it instead, credited once.
            $comp->forceFill(['funding' => Comp::FUNDING_COLLECTION, 'status' => Comp::STATUS_PAYABLE, 'earned_at' => now()])->save();
            $this->ledger->write($comp, Entry::COMPENSATION_EARNED, 'earned', (float) $comp->amount, "comp:{$comp->id}:earned", $actor?->id,
                'Tourist paid the cancellation fee (the pending advance was not needed)', ['collection_method' => $penalty->collection_method]);
            $this->record($penalty, 'ride_compensation_earned', $comp, ['funding' => Comp::FUNDING_COLLECTION, 'replaced_pending_advance' => true], $actor,
                'compensation of ₱%s earned by rider #%d (tourist paid before the advance was approved)');

            return $comp;
        }

        if ($comp->funding === Comp::FUNDING_ADVANCE && $comp->recovered_at === null) {
            $comp->forceFill(['recovered_at' => now()])->save();
            // Office record only: the rider's balance does not change.
            $this->ledger->write($comp, Entry::ADVANCE_RECOVERED, 'office', (float) $comp->amount, "comp:{$comp->id}:recovered", $actor?->id,
                'Advance recovered: the tourist\'s penalty was received', ['collection_method' => $penalty->collection_method]);
            $this->record($penalty, 'ride_compensation_advance_recovered', $comp, ['collection_method' => $penalty->collection_method], $actor,
                'advance of ₱%s to rider #%d recovered (no second credit)');
        }

        return $comp;
    }

    /**
     * Explicit, exceptional advance before the tourist pays. Needs a reason, a
     * reference and an authorised staff member. At or above the payout
     * two-person threshold it waits for a DIFFERENT signed-in staff member
     * (approveAdvance) before the rider is credited — the same rule as payouts.
     */
    public function advance(RideCancellationPenalty $penalty, User $staff, string $reason, string $reference): Comp
    {
        $reason = trim($reason);
        $reference = trim($reference);
        if (mb_strlen($reason) < 5) {
            throw new RidePenaltyException('Give a reason for the advance (at least 5 characters).', 422);
        }
        if ($reference === '') {
            throw new RidePenaltyException('Enter the advance reference.', 422);
        }

        return DB::transaction(function () use ($penalty, $staff, $reason, $reference) {
            $locked = RideCancellationPenalty::lockForUpdate()->findOrFail($penalty->id);
            if ($locked->status !== RideCancellationPenalty::STATUS_OWED) {
                throw new RidePenaltyException('Only an owed cancellation fee can be advanced (not one that is paid, disputed, waived or under review).', 422);
            }
            if (Comp::where('penalty_id', $locked->id)->lockForUpdate()->exists()) {
                throw new RidePenaltyException('This rider already has a compensation for this cancellation.', 409);
            }
            $needsSecond = (float) $locked->penalty_amount >= app(RiderPayoutService::class)->twoPersonThreshold();

            $comp = Comp::create([
                'penalty_id' => $locked->id,
                'rider_id' => $locked->compensated_rider_id,
                'cancelled_order_id' => $locked->cancelled_order_id,
                'amount' => (float) $locked->penalty_amount,
                'funding' => Comp::FUNDING_ADVANCE,
                'status' => $needsSecond ? Comp::STATUS_PENDING_APPROVAL : Comp::STATUS_PAYABLE,
                'earned_at' => now(),
                'advance_reason' => $reason,
                'advance_reference' => $reference,
                'advanced_by' => $staff->id,
            ]);
            if ($needsSecond) {
                $this->record($locked, 'ride_compensation_advance_requested', $comp, ['reason' => $reason, 'reference' => $reference, 'advanced_by' => $staff->id], $staff,
                    'advance of ₱%s to rider #%d requested; a second staff member must approve');

                return $comp;
            }
            $this->grantAdvance($locked, $comp, $staff);

            return $comp;
        });
    }

    /** Two-person rule: a different signed-in staff member approves a large advance. */
    public function approveAdvance(Comp $compensation, User $approver): Comp
    {
        return DB::transaction(function () use ($compensation, $approver) {
            $penalty = RideCancellationPenalty::lockForUpdate()->findOrFail($compensation->penalty_id);
            $comp = Comp::lockForUpdate()->findOrFail($compensation->id);
            if ($comp->status !== Comp::STATUS_PENDING_APPROVAL) {
                return $comp; // already approved, voided…
            }
            if ((int) $comp->advanced_by === (int) $approver->id) {
                throw new RidePenaltyException('Another Tourism Office staff member must approve this advance.', 422);
            }
            if ($penalty->status !== RideCancellationPenalty::STATUS_OWED) {
                throw new RidePenaltyException('The cancellation fee is no longer owed; the advance cannot be approved.', 422);
            }
            $comp->forceFill(['status' => Comp::STATUS_PAYABLE, 'advance_approved_by' => $approver->id])->save();
            $this->grantAdvance($penalty, $comp, $approver);

            return $comp;
        });
    }

    private function grantAdvance(RideCancellationPenalty $penalty, Comp $comp, User $actor): void
    {
        $this->ledger->write($comp, Entry::ADVANCE_GRANTED, 'earned', (float) $comp->amount, "comp:{$comp->id}:earned", $actor->id, $comp->advance_reason,
            ['reference' => $comp->advance_reference, 'advanced_by' => $comp->advanced_by, 'approved_by' => $comp->advance_approved_by]);
        $this->record($penalty, 'ride_compensation_advanced', $comp, ['reason' => $comp->advance_reason, 'reference' => $comp->advance_reference, 'advanced_by' => $comp->advanced_by, 'approved_by' => $comp->advance_approved_by], $actor,
            'compensation of ₱%s advanced to rider #%d before the tourist paid');
    }

    /** The penalty was waived. Call while holding the penalty lock. */
    public function onWaived(RideCancellationPenalty $penalty, string $reason, ?User $actor = null): ?Comp
    {
        return $this->unwind($penalty, 'waived', $reason, $actor);
    }

    /** A received penalty payment was refunded to the tourist. Call while holding the penalty lock. */
    public function onRefunded(RideCancellationPenalty $penalty, string $reason, ?User $actor = null): ?Comp
    {
        return $this->unwind($penalty, 'refunded', $reason, $actor);
    }

    /** 2026-11-23: a disputed fee became owed again — a held compensation is payable again. */
    public function onOwedAgain(RideCancellationPenalty $penalty, ?User $actor = null): ?Comp
    {
        $comp = Comp::where('penalty_id', $penalty->id)->lockForUpdate()->first();
        if ($comp && $comp->status === Comp::STATUS_HELD) {
            $comp->forceFill(['status' => Comp::STATUS_PAYABLE])->save();
            $this->record($penalty, 'ride_compensation_released', $comp, ['cause' => 'fee owed again (no dispute review)'], $actor, 'compensation of ₱%s to rider #%d released (fee owed again)');
        }

        return $comp;
    }

    /** Void while unpaid (releasing a reservation first); write off once paid. */
    private function unwind(RideCancellationPenalty $penalty, string $cause, string $reason, ?User $actor): ?Comp
    {
        $comp = Comp::where('penalty_id', $penalty->id)->lockForUpdate()->first();
        if (! $comp || in_array($comp->status, [Comp::STATUS_VOIDED, Comp::STATUS_WRITTEN_OFF], true)) {
            return $comp;
        }

        if ($comp->status === Comp::STATUS_PAID) {
            $comp->forceFill(['status' => Comp::STATUS_WRITTEN_OFF, 'written_off_at' => now(), 'resolution_reason' => $reason])->save();
            // Office record: the rider keeps what was paid.
            $this->ledger->write($comp, Entry::WRITTEN_OFF, 'office', (float) $comp->amount, "comp:{$comp->id}:written_off", $actor?->id, $reason, ['cause' => $cause]);
            $this->record($penalty, 'ride_compensation_written_off', $comp, ['cause' => $cause, 'reason' => $reason], $actor,
                'compensation of ₱%s already paid to rider #%d written off (the rider keeps it)');

            return $comp;
        }

        if ($comp->status === Comp::STATUS_PENDING_APPROVAL) {
            // Never credited: close it without a ledger reversal.
            $comp->forceFill(['status' => Comp::STATUS_VOIDED, 'voided_at' => now(), 'resolution_reason' => $reason])->save();
            $this->record($penalty, 'ride_compensation_voided', $comp, ['cause' => $cause, 'reason' => $reason, 'never_credited' => true], $actor,
                'requested advance of ₱%s to rider #%d voided before approval');

            return $comp;
        }
        if ($comp->status === Comp::STATUS_RESERVED) {
            // D2: the payout reservation is released before voiding.
            $this->ledger->write($comp, 'reservation_released', 'reserved', -(float) $comp->amount, "comp:{$comp->id}:released:{$cause}", $actor?->id, $reason);
        }
        $comp->forceFill(['status' => Comp::STATUS_VOIDED, 'voided_at' => now(), 'resolution_reason' => $reason])->save();
        $this->ledger->write($comp, Entry::VOIDED, 'earned', -(float) $comp->amount, "comp:{$comp->id}:voided", $actor?->id, $reason, ['cause' => $cause]);
        $this->record($penalty, 'ride_compensation_voided', $comp, ['cause' => $cause, 'reason' => $reason], $actor,
            'unpaid compensation of ₱%s to rider #%d voided');

        return $comp;
    }

    /** Tamper-evident event on the cancelled booking + activity log. */
    private function record(RideCancellationPenalty $penalty, string $event, Comp $comp, array $details, ?User $actor, string $sentence): void
    {
        $order = Order::find($penalty->cancelled_order_id);
        if (! $order) {
            return;
        }
        $this->orderLedger->record($order, $event, [
            'penalty_id' => $penalty->id,
            'compensation_id' => $comp->id,
            'rider_id' => (int) $comp->rider_id,
            'amount' => (float) $comp->amount,
            'funding' => $comp->funding,
            'status' => $comp->status,
            'actor_id' => $actor?->id,
        ] + $details, $comp);
        ActivityLog::record(
            'ride.'.$event,
            "Ride {$order->order_number}: ".sprintf($sentence, number_format((float) $comp->amount, 2), (int) $comp->rider_id).'.',
            $order,
            ActivityLog::TYPE_FINANCIAL,
        );
    }
}
