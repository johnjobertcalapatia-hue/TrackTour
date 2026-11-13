<?php

namespace App\Services;

use App\Exceptions\PayoutConflictException;
use App\Models\ActivityLog;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Rider cashout (decision 2026-11-11, secure cashout policy):
 *
 *   No verified transaction, no rider earnings.
 *   No verified earnings, no cashout.
 *   No Tourism Office approval, no payout.
 *
 * pending (= pending review) → under_review → approved → paid
 *                                    ↘ rejected       ↘ failed (earnings return)
 * The rider may cancel only while pending. TrackTour never sends money: staff
 * transfer through GCash and record the reference, amount, recipient, date and
 * proof. Only online-paid, provider-confirmed, completed earnings can be cashed
 * out (RiderEarningVerifier); cash / COD earnings are kept from the cash
 * collected. Each earning can be in one live/paid cashout only (UNIQUE pivot).
 * Every transition locks the payout row and writes an audit log entry.
 */
class RiderPayoutService
{
    public const LOCKING_STATUSES = [
        RiderPayout::STATUS_PENDING,
        RiderPayout::STATUS_UNDER_REVIEW,
        RiderPayout::STATUS_APPROVED,
        RiderPayout::STATUS_PAID,
    ];

    public const RELEASING_STATUSES = [
        RiderPayout::STATUS_REJECTED,
        RiderPayout::STATUS_CANCELLED,
        RiderPayout::STATUS_FAILED,
    ];

    public function __construct(
        private readonly RiderEarningVerifier $verifier,
        private readonly RiderEarningLedger $ledger,
        private readonly CashoutValidator $validator,
    ) {}

    /** At least this many characters document a FLAGGED approval's investigation decision. */
    public const DECISION_NOTE_MIN = 10;

    /** At or above this amount the payer must not be the approver (two-person rule). */
    public function twoPersonThreshold(): float
    {
        return (float) config('payouts.two_person_threshold', 5000);
    }

    /**
     * Earnings the rider may cash out now: earned, not locked in a cashout, and
     * passing every source check (online payment confirmed, trip completed…).
     * `cash_total` is what the rider already keeps from COD / cash trips.
     */
    public function getAvailableEarnings(int $riderId): array
    {
        $unlocked = RiderEarning::query()
            ->where('rider_id', $riderId)
            ->where('status', 'earned')
            ->whereDoesntHave('payouts', fn (Builder $q) => $q->whereIn('status', self::LOCKING_STATUSES))
            ->with('order.business')
            ->orderBy('earned_at')
            ->orderBy('id')
            ->get();

        // Stage 5: amounts come from the append-only ledger (available =
        // earned − reserved − paid); a fully adjusted-away earning is not payable.
        $eligible = $unlocked->filter(fn (RiderEarning $e) => $this->verifier->eligible($e) && $this->ledger->available($e->id) > 0)->values();
        $cash = $unlocked->filter(fn (RiderEarning $e) => in_array(strtolower((string) $e->order?->payment_method), ['cash', 'cod'], true));
        // Compare by earning id (diffKeys compared array positions, and
        // $eligible is re-indexed — an eligible earning could show as held).
        $held = $unlocked->reject(fn (RiderEarning $e) => $eligible->contains('id', $e->id) || $cash->contains('id', $e->id))->values();

        return [
            'earnings' => $eligible,
            'total' => $this->sum($eligible),
            'payable' => $eligible->isNotEmpty(),
            'cash_total' => $this->sum($cash),
            'held_total' => $this->sum($held),
        ];
    }

    /**
     * Rider requests a cashout of eligible online earnings, oldest first, up to
     * $maxAmount when given (whole earnings only: an earning is never split).
     */
    public function requestPayout(User $rider, ?float $maxAmount = null, ?string $gcashNumber = null, ?string $accountName = null): RiderPayout
    {
        try {
            return DB::transaction(function () use ($rider, $maxAmount, $gcashNumber, $accountName) {
                $lockedRider = User::where('id', $rider->id)->lockForUpdate()->first();
                if (! $lockedRider) {
                    throw new PayoutConflictException('Rider not found.');
                }

                if (RiderPayout::where('rider_id', $rider->id)->whereIn('status', RiderPayout::LIVE_STATUSES)->exists()) {
                    throw new PayoutConflictException('You already have a payout request being processed.');
                }

                $available = $this->getAvailableEarnings($rider->id);
                $selected = $available['earnings'];
                if ($maxAmount !== null) {
                    $running = 0.0;
                    $selected = $selected->filter(function (RiderEarning $e) use (&$running, $maxAmount) {
                        $amount = $this->ledger->available($e->id);
                        if (round($running + $amount, 2) > round($maxAmount, 2)) {
                            return false;
                        }
                        $running += $amount;

                        return true;
                    })->values();
                }

                if ($selected->isEmpty()) {
                    throw new PayoutConflictException($available['earnings']->isEmpty()
                        ? 'You have no verified online earnings to cash out right now.'
                        : 'The amount is smaller than your oldest earning. Enter a larger amount.');
                }

                $payout = RiderPayout::create([
                    'rider_id' => $rider->id,
                    'payout_number' => 'PYT-'.now()->format('Ymd').'-'.strtoupper(Str::random(8)),
                    'amount' => $this->sum($selected),
                    'destination_gcash_number' => $gcashNumber,
                    'destination_account_name' => $accountName,
                    'items_snapshot' => $selected->map(fn (RiderEarning $e) => $this->verifier->verify($e)['source'])->values()->all(),
                    'status' => RiderPayout::STATUS_PENDING,
                    'active_payout_key' => $rider->id,
                    'requested_at' => now(),
                ]);

                $payout->earnings()->syncWithoutDetaching(
                    $selected->pluck('id')->mapWithKeys(fn ($id) => [$id => ['created_at' => now(), 'updated_at' => now()]])
                );
                // Permanent record of the reservation (the pivot stays the lock).
                $this->ledger->reserve($payout, $selected);

                // Stage 6: validate the new request against the ledger.
                $validation = $this->validator->validate($payout, 'request', $rider);
                if ($validation['result'] === \App\Models\RiderPayoutValidation::BLOCK) {
                    throw new PayoutConflictException($validation['blocking_message']);
                }

                $this->audit('payout.requested', $payout, sprintf('Rider requested cashout %s of ₱%s (%d earnings).', $payout->payout_number, number_format((float) $payout->amount, 2), $selected->count()), $rider);

                return $payout->fresh()->load('earnings');
            });
        } catch (UniqueConstraintViolationException $e) {
            throw new PayoutConflictException('You already have a payout request being processed.', previous: $e);
        }
    }

    /** Staff opens an investigation: the request is held (rider can no longer cancel). */
    public function startReview(RiderPayout $payout, User $admin): RiderPayout
    {
        return $this->transition($payout, [RiderPayout::STATUS_PENDING], 'This request is not waiting for review.', function (RiderPayout $p) use ($admin) {
            $p->update([
                'status' => RiderPayout::STATUS_UNDER_REVIEW,
                'review_started_by' => $admin->id,
                'review_started_at' => now(),
            ]);
            $this->audit('payout.review_started', $p, "Review started for {$p->payout_number}.", $admin);
        });
    }

    /**
     * Approve after re-verifying EVERY earning in the request against its
     * source records. Any failing earning blocks the approval.
     */
    public function approve(RiderPayout $payout, User $admin, ?string $note = null): RiderPayout
    {
        $fresh = $payout->fresh();
        if (! in_array($fresh?->status, [RiderPayout::STATUS_PENDING, RiderPayout::STATUS_UNDER_REVIEW], true)) {
            throw new PayoutConflictException('Only a request waiting for review can be approved.');
        }
        if ((int) $fresh->rider_id === (int) $admin->id) {
            throw new PayoutConflictException('You cannot approve your own cashout.');
        }

        // Stage 6: validate against the ledger first (stored even when refused).
        // BLOCK stops the cashout; FLAG needs the staff member's documented
        // investigation decision.
        $validation = $this->validator->validate($fresh, 'approve', $admin, $note);
        if ($validation['result'] === \App\Models\RiderPayoutValidation::BLOCK) {
            throw new PayoutConflictException($validation['blocking_message']);
        }
        if ($validation['result'] === \App\Models\RiderPayoutValidation::FLAG && mb_strlen(trim((string) $note)) < self::DECISION_NOTE_MIN) {
            throw new PayoutConflictException('This cashout is flagged for investigation: '.implode(' ', $validation['flags']).' Record your investigation decision in the note to approve.');
        }

        return $this->transition($payout, [RiderPayout::STATUS_PENDING, RiderPayout::STATUS_UNDER_REVIEW], 'Only a request waiting for review can be approved.', function (RiderPayout $p) use ($admin, $note) {
            if ((int) $p->rider_id === (int) $admin->id) {
                throw new PayoutConflictException('You cannot approve your own cashout.');
            }

            $p->update([
                'status' => RiderPayout::STATUS_APPROVED,
                'approved_by' => $admin->id,
                'approved_at' => now(),
                'reviewed_by' => $admin->id,
                'reviewed_at' => now(),
                'review_note' => $note,
            ]);
            $this->audit('payout.approved', $p, sprintf('Approved %s for ₱%s.', $p->payout_number, number_format((float) $p->amount, 2)), $admin);
        });
    }

    /** Reject with a reason; the earnings return to the rider's balance. */
    public function reject(RiderPayout $payout, User $admin, ?string $reason = null): RiderPayout
    {
        if (trim((string) $reason) === '') {
            throw new PayoutConflictException('A reason is required to reject a cashout.');
        }

        return $this->transition($payout, [RiderPayout::STATUS_PENDING, RiderPayout::STATUS_UNDER_REVIEW, RiderPayout::STATUS_APPROVED], 'This request can no longer be rejected.', function (RiderPayout $p) use ($admin, $reason) {
            $this->ledger->release($p, $p->earnings, 'Rejected: '.$reason);
            $p->earnings()->detach();
            $p->update([
                'status' => RiderPayout::STATUS_REJECTED,
                'active_payout_key' => null,
                'reviewed_by' => $admin->id,
                'reviewed_at' => now(),
                'review_note' => $reason,
                'rejection_reason' => $reason,
            ]);
            $this->audit('payout.rejected', $p, "Rejected {$p->payout_number}: {$reason}", $admin);
        });
    }

    /**
     * Confirm the manual GCash transfer. Requires an approved request and the
     * evidence: unique reference, exact amount, recipient, date and proof.
     * Large amounts need a different staff member from the approver.
     *
     * @param  array{reference?: string, amount?: float|string, recipient_number?: string, recipient_name?: string, paid_at?: string, proof?: UploadedFile|null}  $evidence
     */
    public function markPaid(RiderPayout $payout, User $admin, ?string $note = null, array $evidence = []): RiderPayout
    {
        foreach (['reference', 'amount', 'recipient_number', 'recipient_name', 'paid_at'] as $field) {
            if (blank($evidence[$field] ?? null)) {
                throw new PayoutConflictException('Record the GCash reference, amount, recipient, date and proof before marking it paid.');
            }
        }
        if (empty($evidence['proof']) && empty($evidence['proof_path'])) {
            throw new PayoutConflictException('Attach the proof of the GCash transfer.');
        }

        // Stage 6: the approved request must still validate before money is recorded as sent.
        $fresh = $payout->fresh();
        if ($fresh?->status === RiderPayout::STATUS_APPROVED) {
            $validation = $this->validator->validate($fresh, 'pay', $admin);
            if ($validation['result'] === \App\Models\RiderPayoutValidation::BLOCK) {
                throw new PayoutConflictException($validation['blocking_message']);
            }
        }

        return $this->transition($payout, [RiderPayout::STATUS_APPROVED], 'Only an approved cashout can be marked paid.', function (RiderPayout $p) use ($admin, $note, $evidence) {
            if (round((float) $evidence['amount'], 2) !== round((float) $p->amount, 2)) {
                throw new PayoutConflictException('The transferred amount must equal the approved amount (₱'.number_format((float) $p->amount, 2).').');
            }
            if ((float) $p->amount >= $this->twoPersonThreshold() && (int) $p->approved_by === (int) $admin->id) {
                throw new PayoutConflictException('This cashout is ₱'.number_format($this->twoPersonThreshold(), 0).' or more: another staff member must confirm the payment.');
            }
            if (RiderPayout::where('payment_reference', $evidence['reference'])->where('id', '!=', $p->id)->exists()) {
                throw new PayoutConflictException('That GCash reference is already recorded on another cashout.');
            }

            $proofPath = $evidence['proof_path'] ?? $evidence['proof']->store('payout-proofs', 'local');

            $p->update([
                'status' => RiderPayout::STATUS_PAID,
                'active_payout_key' => null,
                'paid_at' => $evidence['paid_at'],
                'paid_by' => $admin->id,
                'payment_reference' => trim((string) $evidence['reference']),
                'paid_amount' => round((float) $evidence['amount'], 2),
                'paid_recipient_number' => $evidence['recipient_number'],
                'paid_recipient_name' => $evidence['recipient_name'],
                'payment_proof_path' => $proofPath,
                'review_note' => $note ?? $p->review_note,
            ]);
            $this->ledger->complete($p->fresh(), $p->earnings);
            $this->audit('payout.paid', $p, sprintf('Paid %s: ₱%s via GCash ref %s to %s.', $p->payout_number, number_format((float) $p->paid_amount, 2), $p->payment_reference, $p->paid_recipient_number), $admin);
        });
    }

    /** The GCash transfer did not go through: earnings return to the rider's balance. */
    public function markFailed(RiderPayout $payout, User $admin, ?string $reason = null): RiderPayout
    {
        if (trim((string) $reason) === '') {
            throw new PayoutConflictException('A reason is required when a payout fails.');
        }

        return $this->transition($payout, [RiderPayout::STATUS_APPROVED], 'Only an approved cashout can fail.', function (RiderPayout $p) use ($admin, $reason) {
            $this->ledger->release($p, $p->earnings, 'Transfer failed: '.$reason);
            $p->earnings()->detach();
            $p->update([
                'status' => RiderPayout::STATUS_FAILED,
                'active_payout_key' => null,
                'failed_by' => $admin->id,
                'failed_at' => now(),
                'failure_reason' => $reason,
            ]);
            $this->audit('payout.failed', $p, "Payout failed for {$p->payout_number}: {$reason}", $admin);
        });
    }

    /** Rider cancels while still pending (not once the Tourism Office is reviewing it). */
    public function cancel(RiderPayout $payout): RiderPayout
    {
        return $this->transition($payout, [RiderPayout::STATUS_PENDING], 'This cashout can no longer be cancelled: the Tourism Office is reviewing it.', function (RiderPayout $p) {
            $this->ledger->release($p, $p->earnings, 'Cancelled by the rider');
            $p->earnings()->detach();
            $p->update([
                'status' => RiderPayout::STATUS_CANCELLED,
                'active_payout_key' => null,
                'reviewed_at' => now(),
            ]);
            $this->audit('payout.cancelled', $p, "Rider cancelled {$p->payout_number}.", $p->rider);
        });
    }

    /** Lock the payout row, check its status, apply the change. */
    private function transition(RiderPayout $payout, array $from, string $refusal, callable $apply): RiderPayout
    {
        return DB::transaction(function () use ($payout, $from, $refusal, $apply) {
            $locked = RiderPayout::whereKey($payout->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, $from, true)) {
                throw new PayoutConflictException($refusal);
            }
            $locked->load('earnings.order');
            $apply($locked);

            return $locked->fresh()->load('earnings');
        });
    }

    private function audit(string $action, RiderPayout $payout, string $description, ?User $actor): void
    {
        ActivityLog::create([
            'user_id' => $actor?->id ?? auth()->id(),
            'action' => $action,
            'type' => ActivityLog::TYPE_FINANCIAL,
            'description' => $description,
            'model_type' => RiderPayout::class,
            'model_id' => $payout->id,
            'ip_address' => request()?->ip(),
            'user_agent' => request()?->userAgent(),
        ]);
    }

    /** @param Collection<int, RiderEarning> $earnings */
    private function sum(Collection $earnings): float
    {
        return round((float) $earnings->sum(fn (RiderEarning $e) => $this->ledger->available($e->id)), 2);
    }
}
