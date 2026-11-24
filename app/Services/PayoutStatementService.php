<?php

namespace App\Services;

use App\Exceptions\PayoutConflictException;
use App\Models\ActivityLog;
use App\Models\RideCancellationPenalty;
use App\Models\RiderCancellationCompensation as Comp;
use App\Models\RiderCompensationPayout as CompPayout;
use App\Models\RiderCompensationPayoutItem as Item;
use App\Models\RiderPayout;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Stage D2 (docs/secure-transaction-audit.md §P.5): ONE office action pays a
 * rider's payout — the existing earnings cashout (RiderPayoutService,
 * CashoutValidator: unchanged) and the linked cancellation-compensation payout
 * (CompensationPayoutValidator) — inside ONE database transaction. The
 * existing service's own transactions nest as savepoints, so if either part
 * refuses, neither changes. No asynchronous listeners move money.
 *
 * One manual GCash transfer pays both: staff enter the transferred total,
 * which must equal earnings + compensation; the earnings cashout keeps its
 * own amount rule; the two-person rule applies to the total. A rider may
 * request compensation alone.
 */
class PayoutStatementService
{
    public function __construct(
        private readonly RiderPayoutService $payouts,
        private readonly CompensationPayoutValidator $validator,
        private readonly RideCompensationLedger $ledger,
        private readonly CashoutValidator $cashoutValidator,
    ) {}

    /*
     * Without compensation, every action calls the existing RiderPayoutService
     * directly — byte-for-byte the previous behaviour (including the stored
     * record of a refused validation). With compensation, both parts run in
     * one transaction; if the EXISTING earnings check refuses, its validation
     * record (rolled back with the transaction) is stored again afterwards so
     * the audit trail is the same as before.
     */
    private function atomically(RiderPayout $payout, string $context, ?User $by, ?string $note, callable $work)
    {
        $stage = 'compensation';
        try {
            return DB::transaction(function () use ($work, &$stage) {
                return $work(function () use (&$stage) { $stage = 'earnings'; });
            });
        } catch (PayoutConflictException $e) {
            if ($stage === 'earnings' && $context !== '') {
                $fresh = RiderPayout::find($payout->id);
                $states = $context === 'pay' ? [RiderPayout::STATUS_APPROVED] : [RiderPayout::STATUS_PENDING, RiderPayout::STATUS_UNDER_REVIEW];
                if ($fresh && in_array($fresh->status, $states, true)) {
                    $this->cashoutValidator->validate($fresh, $context, $by, $note);
                }
            }
            throw $e;
        }
    }

    public function linkedTo(RiderPayout $payout): ?CompPayout
    {
        return CompPayout::where('rider_payout_id', $payout->id)->first();
    }

    /** Payable compensation of the rider (not held, not reserved). */
    public function payableCompensation(int $riderId)
    {
        return Comp::where('rider_id', $riderId)->where('status', Comp::STATUS_PAYABLE)->orderBy('earned_at')->orderBy('id')->get();
    }

    /* ── Rider ──────────────────────────────────────────────────────── */

    /**
     * @return array{payout: ?RiderPayout, compensation: ?CompPayout}
     */
    public function request(User $rider, ?float $maxAmount, ?string $gcashNumber, ?string $accountName): array
    {
        if (! Comp::where('rider_id', $rider->id)->where('status', Comp::STATUS_PAYABLE)->exists()) {
            if (CompPayout::where('rider_id', $rider->id)->whereIn('status', CompPayout::LIVE_STATUSES)->exists()) {
                throw new PayoutConflictException('You already have a payout request being processed.');
            }

            return ['payout' => $this->payouts->requestPayout($rider, $maxAmount, $gcashNumber, $accountName), 'compensation' => null];
        }

        try {
            return DB::transaction(function () use ($rider, $maxAmount, $gcashNumber, $accountName) {
                User::whereKey($rider->id)->lockForUpdate()->first();
                if (CompPayout::where('rider_id', $rider->id)->whereIn('status', CompPayout::LIVE_STATUSES)->exists()
                    || RiderPayout::where('rider_id', $rider->id)->whereIn('status', RiderPayout::LIVE_STATUSES)->exists()) {
                    throw new PayoutConflictException('You already have a payout request being processed.');
                }

                $comps = Comp::where('rider_id', $rider->id)->where('status', Comp::STATUS_PAYABLE)->orderBy('earned_at')->orderBy('id')->lockForUpdate()->get();
                $hasEarnings = $this->payouts->getAvailableEarnings($rider->id)['payable'];

                if (! $hasEarnings && $comps->isEmpty()) {
                    throw new PayoutConflictException('You have no verified online earnings or cancellation compensation to cash out right now.');
                }

                // The existing earnings cashout, unchanged (its own checks and limits).
                $payout = $hasEarnings ? $this->payouts->requestPayout($rider, $maxAmount, $gcashNumber, $accountName) : null;

                $comp = $comps->isNotEmpty() ? $this->reserve($rider, $comps, $payout, $gcashNumber, $accountName) : null;

                return ['payout' => $payout, 'compensation' => $comp];
            });
        } catch (UniqueConstraintViolationException $e) {
            throw new PayoutConflictException('You already have a payout request being processed.', previous: $e);
        }
    }

    public function cancel(RiderPayout $payout): RiderPayout
    {
        if (! $this->linkedTo($payout)) {
            return $this->payouts->cancel($payout);
        }

        return DB::transaction(function () use ($payout) {
            $result = $this->payouts->cancel($payout);
            if ($comp = $this->linkedTo($payout)) {
                $this->closeComp($comp, [CompPayout::STATUS_PENDING], CompPayout::STATUS_CANCELLED, 'Cancelled by the rider', $payout->rider);
            }

            return $result;
        });
    }

    public function cancelCompensationOnly(CompPayout $comp, User $rider): CompPayout
    {
        $this->assertStandalone($comp);
        if ((int) $comp->rider_id !== (int) $rider->id) {
            throw new PayoutConflictException('This payout is not yours.');
        }

        return DB::transaction(fn () => $this->closeComp($comp, [CompPayout::STATUS_PENDING], CompPayout::STATUS_CANCELLED, 'Cancelled by the rider', $rider,
            refusal: 'This payout can no longer be cancelled: the Tourism Office is reviewing it.'));
    }

    /* ── Office: one action for both parts ──────────────────────────── */

    public function startReview(RiderPayout $payout, User $admin): RiderPayout
    {
        if (! $this->linkedTo($payout)) {
            return $this->payouts->startReview($payout, $admin);
        }

        return DB::transaction(function () use ($payout, $admin) {
            $result = $this->payouts->startReview($payout, $admin);
            if ($comp = $this->linkedTo($payout)) {
                $this->startReviewComp($comp, $admin);
            }

            return $result;
        });
    }

    public function approve(RiderPayout $payout, User $admin, ?string $note = null): RiderPayout
    {
        $comp = $this->linkedTo($payout);
        if (! $comp) {
            return $this->payouts->approve($payout, $admin, $note);
        }

        return $this->atomically($payout, 'approve', $admin, $note, function (callable $earningsStage) use ($payout, $admin, $note, $comp) {
            $this->assertValid($comp); // compensation part first: nothing changes if it is refused
            $earningsStage();
            $result = $this->payouts->approve($payout, $admin, $note); // existing CashoutValidator
            $this->approveComp($comp, $admin, $note, validated: true);

            return $result;
        });
    }

    public function reject(RiderPayout $payout, User $admin, ?string $reason = null): RiderPayout
    {
        if (! $this->linkedTo($payout)) {
            return $this->payouts->reject($payout, $admin, $reason);
        }

        return DB::transaction(function () use ($payout, $admin, $reason) {
            $result = $this->payouts->reject($payout, $admin, $reason);
            if ($comp = $this->linkedTo($payout)) {
                $this->closeComp($comp, [CompPayout::STATUS_PENDING, CompPayout::STATUS_UNDER_REVIEW, CompPayout::STATUS_APPROVED], CompPayout::STATUS_REJECTED, 'Rejected: '.$reason, $admin, rejection: $reason);
            }

            return $result;
        });
    }

    public function markFailed(RiderPayout $payout, User $admin, ?string $reason = null): RiderPayout
    {
        if (! $this->linkedTo($payout)) {
            return $this->payouts->markFailed($payout, $admin, $reason);
        }

        return DB::transaction(function () use ($payout, $admin, $reason) {
            $result = $this->payouts->markFailed($payout, $admin, $reason);
            if ($comp = $this->linkedTo($payout)) {
                $this->closeComp($comp, [CompPayout::STATUS_APPROVED], CompPayout::STATUS_FAILED, 'Transfer failed: '.$reason, $admin, failure: $reason);
            }

            return $result;
        });
    }

    /**
     * One GCash transfer for earnings + compensation. evidence.amount is the
     * TRANSFERRED TOTAL; it must equal the statement total.
     *
     * @param  array<string, mixed>  $evidence
     */
    public function markPaid(RiderPayout $payout, User $admin, ?string $note, array $evidence): RiderPayout
    {
        $comp = $this->linkedTo($payout);
        if (! $comp) {
            return $this->payouts->markPaid($payout, $admin, $note, $evidence); // unchanged path
        }

        return $this->atomically($payout, 'pay', $admin, $note, function (callable $earningsStage) use ($payout, $admin, $note, $evidence, $comp) {
            $earnings = RiderPayout::whereKey($payout->id)->lockForUpdate()->firstOrFail();
            $lockedComp = CompPayout::whereKey($comp->id)->lockForUpdate()->firstOrFail();
            $total = round((float) $earnings->amount + (float) $lockedComp->amount, 2);
            $transferred = round((float) ($evidence['amount'] ?? 0), 2);
            if ($transferred !== $total) {
                throw new PayoutConflictException('The transferred amount must equal the total payout (₱'.number_format($total, 2).': earnings ₱'.number_format((float) $earnings->amount, 2).' + cancellation compensation ₱'.number_format((float) $lockedComp->amount, 2).').');
            }
            if ($total >= $this->payouts->twoPersonThreshold() && (int) $earnings->approved_by === (int) $admin->id) {
                throw new PayoutConflictException('This payout is ₱'.number_format($this->payouts->twoPersonThreshold(), 0).' or more: another staff member must confirm the payment.');
            }
            $this->assertReferenceFree((string) ($evidence['reference'] ?? ''), $earnings->id, $lockedComp->id);
            $this->assertValid($lockedComp);

            // The existing cashout records its own share of the one transfer.
            $earningsStage();
            $result = $this->payouts->markPaid($payout, $admin, $note, ['amount' => (float) $earnings->amount] + $evidence);
            $this->paidComp($lockedComp, $admin, $evidence, $result->payment_proof_path, $total);

            return $result;
        });
    }

    /* ── Office: compensation-only payouts ─────────────────────────── */

    public function startReviewCompensationOnly(CompPayout $comp, User $admin): CompPayout
    {
        $this->assertStandalone($comp);

        return DB::transaction(fn () => $this->startReviewComp($comp, $admin));
    }

    public function approveCompensationOnly(CompPayout $comp, User $admin, ?string $note = null): CompPayout
    {
        $this->assertStandalone($comp);
        if ((int) $comp->rider_id === (int) $admin->id) {
            throw new PayoutConflictException('You cannot approve your own payout.');
        }

        return DB::transaction(fn () => $this->approveComp($comp, $admin, $note, validated: false));
    }

    public function rejectCompensationOnly(CompPayout $comp, User $admin, string $reason): CompPayout
    {
        $this->assertStandalone($comp);

        return DB::transaction(fn () => $this->closeComp($comp, [CompPayout::STATUS_PENDING, CompPayout::STATUS_UNDER_REVIEW, CompPayout::STATUS_APPROVED], CompPayout::STATUS_REJECTED, 'Rejected: '.$reason, $admin, rejection: $reason));
    }

    public function markFailedCompensationOnly(CompPayout $comp, User $admin, string $reason): CompPayout
    {
        $this->assertStandalone($comp);

        return DB::transaction(fn () => $this->closeComp($comp, [CompPayout::STATUS_APPROVED], CompPayout::STATUS_FAILED, 'Transfer failed: '.$reason, $admin, failure: $reason));
    }

    /** @param  array<string, mixed>  $evidence */
    public function markPaidCompensationOnly(CompPayout $comp, User $admin, array $evidence): CompPayout
    {
        $this->assertStandalone($comp);
        foreach (['reference', 'amount', 'recipient_number', 'recipient_name', 'paid_at'] as $field) {
            if (blank($evidence[$field] ?? null)) {
                throw new PayoutConflictException('Record the GCash reference, amount, recipient, date and proof before marking it paid.');
            }
        }
        if (empty($evidence['proof']) && empty($evidence['proof_path'])) {
            throw new PayoutConflictException('Attach the proof of the GCash transfer.');
        }

        return DB::transaction(function () use ($comp, $admin, $evidence) {
            $locked = CompPayout::whereKey($comp->id)->lockForUpdate()->firstOrFail();
            if ($locked->status === CompPayout::STATUS_PAID) {
                return $locked; // repeat click
            }
            if ($locked->status !== CompPayout::STATUS_APPROVED) {
                throw new PayoutConflictException('Only an approved payout can be marked paid.');
            }
            if (round((float) $evidence['amount'], 2) !== round((float) $locked->amount, 2)) {
                throw new PayoutConflictException('The transferred amount must equal the approved amount (₱'.number_format((float) $locked->amount, 2).').');
            }
            if ((float) $locked->amount >= $this->payouts->twoPersonThreshold() && (int) $locked->approved_by === (int) $admin->id) {
                throw new PayoutConflictException('This payout is ₱'.number_format($this->payouts->twoPersonThreshold(), 0).' or more: another staff member must confirm the payment.');
            }
            $this->assertReferenceFree((string) $evidence['reference'], null, $locked->id);
            $this->assertValid($locked);
            $proofPath = $evidence['proof_path'] ?? $evidence['proof']->store('payout-proofs', 'local');

            return $this->paidComp($locked, $admin, $evidence, $proofPath, (float) $locked->amount);
        });
    }

    public function validate(CompPayout $comp): array
    {
        return $this->validator->validate($comp);
    }

    /* ── Internals ──────────────────────────────────────────────────── */

    private function reserve(User $rider, $comps, ?RiderPayout $payout, ?string $gcashNumber, ?string $accountName): CompPayout
    {
        $comp = CompPayout::create([
            'payout_number' => 'CPY-'.now()->format('Ymd').'-'.strtoupper(Str::random(8)),
            'rider_id' => $rider->id,
            'rider_payout_id' => $payout?->id,
            'amount' => round((float) $comps->sum('amount'), 2),
            'status' => CompPayout::STATUS_PENDING,
            'active_key' => $rider->id,
            'destination_gcash_number' => $gcashNumber,
            'destination_account_name' => $accountName,
            'requested_at' => now(),
        ]);
        foreach ($comps as $c) {
            Item::create(['payout_id' => $comp->id, 'compensation_id' => $c->id, 'amount' => (float) $c->amount, 'live_key' => $c->id]);
            $c->forceFill(['status' => Comp::STATUS_RESERVED])->save();
            $this->ledger->write($c, 'reserved', 'reserved', (float) $c->amount, "comp:{$c->id}:reserved:p{$comp->id}", $rider->id, 'Reserved for payout '.$comp->payout_number, payoutId: $comp->id);
        }
        $this->assertValid($comp->fresh());
        $this->audit('compensation_payout.requested', $comp, sprintf('Rider requested %s: ₱%s cancellation compensation (%d)%s.', $comp->payout_number, number_format((float) $comp->amount, 2), $comps->count(), $payout ? ' with '.$payout->payout_number : ''), $rider);

        return $comp;
    }

    private function startReviewComp(CompPayout $comp, User $admin): CompPayout
    {
        $locked = CompPayout::whereKey($comp->id)->lockForUpdate()->firstOrFail();
        if ($locked->status !== CompPayout::STATUS_PENDING) {
            throw new PayoutConflictException('This request is not waiting for review.');
        }
        $locked->update(['status' => CompPayout::STATUS_UNDER_REVIEW, 'review_started_by' => $admin->id, 'review_started_at' => now()]);
        $this->audit('compensation_payout.review_started', $locked, "Review started for {$locked->payout_number}.", $admin);

        return $locked;
    }

    private function approveComp(CompPayout $comp, User $admin, ?string $note, bool $validated): CompPayout
    {
        $locked = CompPayout::whereKey($comp->id)->lockForUpdate()->firstOrFail();
        if (! in_array($locked->status, [CompPayout::STATUS_PENDING, CompPayout::STATUS_UNDER_REVIEW], true)) {
            throw new PayoutConflictException('Only a request waiting for review can be approved.');
        }
        if (! $validated) {
            $this->assertValid($locked);
        }
        $locked->update(['status' => CompPayout::STATUS_APPROVED, 'approved_by' => $admin->id, 'approved_at' => now(), 'review_note' => $note]);
        $this->audit('compensation_payout.approved', $locked, sprintf('Approved %s for ₱%s.', $locked->payout_number, number_format((float) $locked->amount, 2)), $admin);

        return $locked;
    }

    /** Reject / cancel / failed: release every still-reserved compensation (voided ones stay voided). */
    private function closeComp(CompPayout $comp, array $from, string $to, string $why, ?User $actor, ?string $rejection = null, ?string $failure = null, ?string $refusal = null): CompPayout
    {
        $locked = CompPayout::whereKey($comp->id)->lockForUpdate()->firstOrFail();
        if ($locked->status === $to) {
            return $locked;
        }
        if (! in_array($locked->status, $from, true)) {
            throw new PayoutConflictException($refusal ?? 'This payout can no longer be changed.');
        }
        foreach ($locked->items()->get() as $item) {
            $c = Comp::whereKey($item->compensation_id)->lockForUpdate()->first();
            if ($c && $c->status === Comp::STATUS_RESERVED) {
                $this->ledger->write($c, 'reservation_released', 'reserved', -(float) $item->amount, "comp:{$c->id}:released:p{$locked->id}", $actor?->id, $why, payoutId: $locked->id);
                $penalty = RideCancellationPenalty::find($c->penalty_id);
                $c->forceFill(['status' => $penalty?->status === RideCancellationPenalty::STATUS_DISPUTED ? Comp::STATUS_HELD : Comp::STATUS_PAYABLE])->save();
            }
            $item->update(['live_key' => null]);
        }
        $locked->update(array_filter([
            'status' => $to,
            'active_key' => null,
            'rejection_reason' => $rejection,
            'failure_reason' => $failure,
            'failed_by' => $failure !== null ? $actor?->id : null,
            'failed_at' => $failure !== null ? now() : null,
        ], fn ($v) => $v !== null) + ['active_key' => null]);
        $this->audit('compensation_payout.'.$to, $locked, "{$locked->payout_number}: {$why}", $actor);

        return $locked;
    }

    private function paidComp(CompPayout $locked, User $admin, array $evidence, ?string $proofPath, float $transferredTotal): CompPayout
    {
        foreach ($locked->items()->get() as $item) {
            $c = Comp::whereKey($item->compensation_id)->lockForUpdate()->firstOrFail();
            $this->ledger->write($c, 'reservation_released', 'reserved', -(float) $item->amount, "comp:{$c->id}:unreserved:p{$locked->id}", $admin->id, 'Paid', payoutId: $locked->id);
            $this->ledger->write($c, 'paid', 'paid', (float) $item->amount, "comp:{$c->id}:paid:p{$locked->id}", $admin->id, 'Paid in '.$locked->payout_number, ['reference' => $evidence['reference'] ?? null], $locked->id);
            $c->forceFill(['status' => Comp::STATUS_PAID])->save();
            $item->update(['live_key' => null]);
        }
        $locked->update([
            'status' => CompPayout::STATUS_PAID,
            'active_key' => null,
            'paid_by' => $admin->id,
            'paid_at' => $evidence['paid_at'] ?? now(),
            'payment_reference' => trim((string) ($evidence['reference'] ?? '')),
            'paid_amount' => (float) $locked->amount,
            'transferred_total' => round($transferredTotal, 2),
            'paid_recipient_number' => $evidence['recipient_number'] ?? null,
            'paid_recipient_name' => $evidence['recipient_name'] ?? null,
            'payment_proof_path' => $proofPath,
        ]);
        $this->audit('compensation_payout.paid', $locked, sprintf('Paid %s: ₱%s cancellation compensation via GCash ref %s (transfer total ₱%s).', $locked->payout_number, number_format((float) $locked->amount, 2), $locked->payment_reference, number_format($transferredTotal, 2)), $admin);

        return $locked;
    }

    private function assertValid(CompPayout $comp): void
    {
        $result = $this->validator->validate($comp->fresh());
        if ($result['result'] !== CompensationPayoutValidator::PASS) {
            throw new PayoutConflictException($result['blocking_message']);
        }
    }

    private function assertStandalone(CompPayout $comp): void
    {
        if ($comp->rider_payout_id !== null) {
            throw new PayoutConflictException('This compensation is paid together with cashout #'.$comp->rider_payout_id.'. Use that cashout.');
        }
    }

    private function assertReferenceFree(string $reference, ?int $earningsPayoutId, int $compPayoutId): void
    {
        $reference = trim($reference);
        if ($reference === '') {
            return;
        }
        $usedByEarnings = RiderPayout::where('payment_reference', $reference)->when($earningsPayoutId, fn ($q) => $q->where('id', '!=', $earningsPayoutId))->exists();
        $usedByComp = CompPayout::where('payment_reference', $reference)->where('id', '!=', $compPayoutId)->exists();
        if ($usedByEarnings || $usedByComp) {
            throw new PayoutConflictException('That GCash reference is already recorded on another payout.');
        }
    }

    private function audit(string $action, CompPayout $payout, string $description, ?User $actor): void
    {
        ActivityLog::create([
            'user_id' => $actor?->id ?? auth()->id(),
            'action' => $action,
            'type' => ActivityLog::TYPE_FINANCIAL,
            'description' => $description,
            'model_type' => CompPayout::class,
            'model_id' => $payout->id,
            'ip_address' => request()?->ip(),
            'user_agent' => request()?->userAgent(),
        ]);
    }
}
