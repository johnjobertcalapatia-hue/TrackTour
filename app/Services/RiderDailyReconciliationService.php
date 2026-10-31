<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\RiderDailyCashMovement;
use App\Models\RiderDailyReconciliation;
use App\Models\RiderDailyReconciliationCorrection;
use App\Models\RiderDailyReconciliationEvent;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

class RiderDailyReconciliationService
{
    public function __construct(private RiderCashFundService $cashFund) {}

    public function submit(
        User $rider,
        string $date,
        float $codRemitted,
        float $officeCashReturned,
        string $reference,
        ?string $note,
        string $idempotencyKey
    ): RiderDailyReconciliation {
        $this->assertRider($rider);
        $this->assertPolicyAllowsMutation($date);

        return DB::transaction(function () use ($rider, $date, $codRemitted, $officeCashReturned, $reference, $note, $idempotencyKey) {
            $lockedRider = User::query()->lockForUpdate()->findOrFail($rider->id);
            $this->assertRider($lockedRider);

            $existing = RiderDailyReconciliation::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existing) {
                if ((int) $existing->rider_id !== (int) $lockedRider->id
                    || $existing->working_date->toDateString() !== $date
                    || $this->cents($existing->submitted_cod_remittance) !== $this->cents($codRemitted)
                    || $this->cents($existing->submitted_office_cash_return) !== $this->cents($officeCashReturned)
                    || $existing->remittance_reference !== $reference) {
                    throw new ConflictHttpException('This idempotency key was already used for a different cash submission.');
                }

                return $existing->load('events.actor:id,name');
            }

            $latest = RiderDailyReconciliation::query()
                ->where('rider_id', $lockedRider->id)
                ->whereDate('working_date', $date)
                ->orderByDesc('revision')
                ->lockForUpdate()
                ->first();
            if ($latest && $latest->status !== RiderDailyReconciliation::STATUS_DISPUTED) {
                throw new ConflictHttpException('A cash reconciliation for this date is already submitted or locked.');
            }

            $balances = $this->calculateBalances($lockedRider, $date);
            if ($balances['eligible_delivery_count'] === 0) {
                throw new ConflictHttpException('There are no eligible COD deliveries for this date.');
            }
            $this->assertWithinOutstanding(
                $codRemitted,
                $balances['cod_remittance_outstanding_cents'],
                'COD remittance cannot exceed the server-calculated amount still due.'
            );
            $this->assertWithinOutstanding(
                $officeCashReturned,
                $balances['office_cash_return_outstanding_cents'],
                'Returned Tourism Office cash cannot exceed the outstanding cash-fund balance.'
            );

            $reconciliation = RiderDailyReconciliation::create([
                'rider_id' => $lockedRider->id,
                'municipality_id' => $lockedRider->municipality_id,
                'working_date' => $date,
                'revision' => ($latest?->revision ?? 0) + 1,
                'status' => RiderDailyReconciliation::STATUS_SUBMITTED,
                'idempotency_key' => $idempotencyKey,
                'expected_cod_remittance' => $this->money($balances['cod_remittance_outstanding_cents']),
                'expected_office_cash_return' => $this->money($balances['office_cash_return_outstanding_cents']),
                'expected_rider_payable' => $this->money($balances['rider_reimbursement_outstanding_cents']),
                'submitted_cod_remittance' => $this->money($this->cents($codRemitted)),
                'submitted_office_cash_return' => $this->money($this->cents($officeCashReturned)),
                'remittance_reference' => $reference,
                'rider_note' => $note,
                'receipt_snapshot' => $balances['receipt'],
                'submitted_at' => now(),
            ]);

            $this->recordEvent(
                $reconciliation,
                $lockedRider,
                'submitted',
                $latest?->status,
                $reconciliation->status,
                $idempotencyKey,
                [
                    'cod_remitted_claim' => $this->money($this->cents($codRemitted)),
                    'cash_return_claim' => $this->money($this->cents($officeCashReturned)),
                    'cod_remittance_outstanding' => $this->money($balances['cod_remittance_outstanding_cents']),
                    'cash_return_outstanding' => $this->money($balances['office_cash_return_outstanding_cents']),
                    'rider_reimbursement_outstanding' => $this->money($balances['rider_reimbursement_outstanding_cents']),
                    'remittance_reference' => $reference,
                    'note' => $note,
                ]
            );

            return $reconciliation->load('events.actor:id,name');
        });
    }

    public function verify(
        User $officer,
        RiderDailyReconciliation $reconciliation,
        float $codReceived,
        float $officeCashReturned,
        float $riderReimbursement,
        ?string $note,
        string $idempotencyKey
    ): RiderDailyReconciliation {
        $date = $reconciliation->working_date->toDateString();
        $this->assertPolicyAllowsMutation($date);

        return DB::transaction(function () use ($officer, $reconciliation, $codReceived, $officeCashReturned, $riderReimbursement, $note, $idempotencyKey, $date) {
            $riderId = (int) $reconciliation->rider_id;
            $rider = User::query()->lockForUpdate()->findOrFail($riderId);
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $locked = RiderDailyReconciliation::query()
                ->whereKey($reconciliation->id)
                ->lockForUpdate()
                ->firstOrFail();

            $existingEvent = RiderDailyReconciliationEvent::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existingEvent) {
                $this->assertSameIdempotentVerification(
                    $existingEvent,
                    $locked,
                    $codReceived,
                    $officeCashReturned,
                    $riderReimbursement
                );

                return $locked->load('events.actor:id,name');
            }

            if ($locked->status !== RiderDailyReconciliation::STATUS_SUBMITTED) {
                throw new ConflictHttpException('Only a submitted cash reconciliation can be verified.');
            }

            $balances = $this->calculateBalances($rider, $date, (int) $locked->id);
            $codCents = $this->cents($codReceived);
            $cashReturnCents = $this->cents($officeCashReturned);
            $reimbursementCents = $this->cents($riderReimbursement);
            $this->assertWithinOutstanding(
                $codReceived,
                $balances['cod_remittance_outstanding_cents'],
                'COD cash received cannot exceed the remaining amount due.'
            );
            $this->assertWithinOutstanding(
                $officeCashReturned,
                $balances['office_cash_return_outstanding_cents'],
                'Cash returned cannot exceed the cumulative outstanding cash advance.'
            );
            $this->assertWithinOutstanding(
                $riderReimbursement,
                $balances['rider_reimbursement_outstanding_cents'],
                'Reimbursement cannot exceed verified rider-funded purchase contributions still payable.'
            );

            $movementAmounts = $this->movementAmountsForReconciliation($locked);
            $movementIds = RiderDailyCashMovement::query()
                ->where('rider_daily_reconciliation_id', $locked->id)
                ->pluck('id')
                ->all();

            $matchesExpected = $codCents === $balances['cod_remittance_outstanding_cents']
                && $codCents === $this->cents($locked->submitted_cod_remittance)
                && $codCents === $movementAmounts[RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED]
                && $cashReturnCents === $balances['office_cash_return_outstanding_cents']
                && $cashReturnCents === $this->cents($locked->submitted_office_cash_return)
                && $cashReturnCents === $movementAmounts[RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED]
                && $reimbursementCents === $balances['rider_reimbursement_outstanding_cents'];
            $matchesExpected = $matchesExpected
                && $reimbursementCents === $movementAmounts[RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID];
            $status = $matchesExpected
                ? RiderDailyReconciliation::STATUS_VERIFIED
                : RiderDailyReconciliation::STATUS_DISPUTED;
            $fromStatus = $locked->status;
            $locked->update([
                'status' => $status,
                'verified_cod_received' => $this->money($codCents),
                'verified_office_cash_return' => $this->money($cashReturnCents),
                'verified_rider_reimbursement' => $this->money($reimbursementCents),
                'verification_note' => $note,
                'verified_by' => $officer->id,
                'verified_at' => now(),
            ]);

            $this->recordEvent(
                $locked,
                $officer,
                'verified',
                $fromStatus,
                $status,
                $idempotencyKey,
                [
                    'cod_received' => $this->money($codCents),
                    'cash_returned' => $this->money($cashReturnCents),
                    'rider_reimbursement_paid' => $this->money($reimbursementCents),
                    'expected_cod_remittance_before_receipt' => $this->money($balances['cod_remittance_outstanding_cents']),
                    'expected_cash_return_before_receipt' => $this->money($balances['office_cash_return_outstanding_cents']),
                    'expected_rider_reimbursement_before_payment' => $this->money($balances['rider_reimbursement_outstanding_cents']),
                    'ledger_cod_received' => $this->money($movementAmounts[RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED]),
                    'ledger_cash_returned' => $this->money($movementAmounts[RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED]),
                    'ledger_rider_reimbursement_paid' => $this->money($movementAmounts[RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID]),
                    'discrepancy' => ! $matchesExpected,
                    'movement_ids' => $movementIds,
                    'note' => $note,
                ]
            );

            return $locked->load('events.actor:id,name');
        });
    }

    public function recordMovement(
        User $officer,
        RiderDailyReconciliation $reconciliation,
        string $movementType,
        float $amount,
        string $reference,
        ?string $evidenceDetails,
        string $referenceNamespace,
        string $idempotencyKey
    ): RiderDailyCashMovement {
        $date = $reconciliation->working_date->toDateString();
        $this->assertPolicyAllowsMutation($date);

        if (! in_array($movementType, RiderDailyCashMovement::BALANCE_TYPES, true)) {
            throw new ConflictHttpException('Unsupported physical cash movement type.');
        }

        $reference = trim($reference);
        if ($reference === '') {
            throw new ConflictHttpException('A unique physical transaction reference is required.');
        }

        return DB::transaction(function () use ($officer, $reconciliation, $movementType, $amount, $reference, $evidenceDetails, $referenceNamespace, $idempotencyKey, $date) {
            $rider = User::query()->lockForUpdate()->findOrFail($reconciliation->rider_id);
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $locked = RiderDailyReconciliation::query()
                ->whereKey($reconciliation->id)
                ->lockForUpdate()
                ->firstOrFail();

            $existing = RiderDailyCashMovement::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                if ((int) $existing->rider_daily_reconciliation_id !== (int) $locked->id
                    || $existing->movement_type !== $movementType
                    || $this->cents($existing->amount) !== $this->cents($amount)
                    || $existing->normalized_reference !== $this->normalizeReference($reference)
                    || $existing->reference_namespace !== $referenceNamespace
                    || $existing->evidence_details !== $evidenceDetails) {
                    throw new ConflictHttpException('This idempotency key was already used for a different financial movement.');
                }

                return $existing;
            }
            if (RiderDailyReconciliationEvent::query()->where('idempotency_key', $idempotencyKey)->exists()) {
                throw new ConflictHttpException('This idempotency key was already used for a reconciliation action.');
            }

            if ($locked->status !== RiderDailyReconciliation::STATUS_SUBMITTED) {
                throw new ConflictHttpException('Physical movements can be recorded only for a submitted reconciliation.');
            }

            $referenceDetails = $this->referenceDetails($referenceNamespace, $reference, $evidenceDetails);
            $this->assertReferenceAvailable($referenceDetails);

            $balances = $this->calculateBalances($rider, $date);
            $amountCents = $this->cents($amount);
            $balanceKey = match ($movementType) {
                RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED => 'cod_remittance_outstanding_cents',
                RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED => 'office_cash_return_outstanding_cents',
                RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID => 'rider_reimbursement_outstanding_cents',
            };
            $this->assertWithinOutstanding(
                $amount,
                $balances[$balanceKey],
                'The physical cash movement cannot exceed the remaining authoritative balance.'
            );
            if ($amountCents <= 0) {
                throw new ConflictHttpException('A physical cash movement must be greater than zero.');
            }

            try {
                $movement = $this->createMovement(
                    $rider,
                    $officer,
                    $locked,
                    $movementType,
                    $movementType,
                    $amountCents,
                    $idempotencyKey,
                    $reference,
                    $evidenceDetails,
                    null,
                    null,
                    $referenceDetails
                );
            } catch (QueryException $exception) {
                if (RiderDailyCashMovement::query()->where('reference_fingerprint', $referenceDetails['reference_fingerprint'])->exists()) {
                    throw new ConflictHttpException('This physical transaction reference has already been recorded.');
                }

                throw $exception;
            }
            $this->recordEvent(
                $locked,
                $officer,
                'movement_recorded',
                $locked->status,
                $locked->status,
                $idempotencyKey,
                [
                    'movement_id' => $movement->id,
                    'movement_type' => $movementType,
                    'amount' => $this->money($amountCents),
                    'reference' => $reference,
                    'reference_namespace' => $referenceNamespace,
                    'evidence_details' => $evidenceDetails,
                ]
            );

            return $movement;
        });
    }

    public function recordCashFundReturn(
        User $officer,
        User $rider,
        float $amount,
        string $transactionAt,
        string $reference,
        string $referenceNamespace,
        ?string $evidenceDetails,
        string $idempotencyKey
    ): RiderDailyCashMovement {
        $actualTime = CarbonImmutable::parse($transactionAt, 'Asia/Manila');
        if ($actualTime->isFuture()) {
            throw new ConflictHttpException('A cash-fund return cannot be recorded with a future transaction time.');
        }
        $actualTime = $actualTime->setTimezone(config('app.timezone'));
        $date = $actualTime->setTimezone('Asia/Manila')->toDateString();
        $this->assertPolicyAllowsMutation($date);

        return DB::transaction(function () use (
            $officer,
            $rider,
            $amount,
            $actualTime,
            $date,
            $reference,
            $referenceNamespace,
            $evidenceDetails,
            $idempotencyKey
        ) {
            $lockedRider = User::query()->lockForUpdate()->findOrFail($rider->id);
            $this->cashFund->assertMunicipalityAccess($officer, $lockedRider);
            $existing = RiderDailyCashMovement::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                if ((int) $existing->rider_id !== (int) $lockedRider->id
                    || $existing->movement_type !== RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED
                    || $existing->business_date->toDateString() !== $date
                    || $this->cents($existing->amount) !== $this->cents($amount)
                    || $existing->normalized_reference !== $this->normalizeReference($reference)
                    || $existing->reference_namespace !== $referenceNamespace
                    || $existing->evidence_details !== $evidenceDetails
                    || $existing->transaction_at->timestamp !== $actualTime->timestamp) {
                    throw new ConflictHttpException('This idempotency key was already used for a different cash-fund return.');
                }

                return $existing;
            }

            $referenceDetails = $this->referenceDetails($referenceNamespace, $reference, $evidenceDetails);
            $this->assertReferenceAvailable($referenceDetails);
            $receipt = $this->cashFund->adminDailyReceipt($officer, $lockedRider, $date);
            $outstandingCents = $this->cents($receipt['totals']['unreturned_tourism_office_cash_balance']);
            $amountCents = $this->cents($amount);
            if ($amountCents <= 0 || $amountCents > $outstandingCents) {
                throw new ConflictHttpException('Cash returned cannot exceed the cumulative outstanding Tourism Office cash-fund balance.');
            }

            try {
                $movement = $this->createMovement(
                    $lockedRider,
                    $officer,
                    null,
                    RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED,
                    RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED,
                    $amountCents,
                    $idempotencyKey,
                    $reference,
                    $evidenceDetails,
                    null,
                    null,
                    $referenceDetails,
                    $date,
                    null,
                    $actualTime
                );
            } catch (QueryException $exception) {
                if (RiderDailyCashMovement::query()->where('reference_fingerprint', $referenceDetails['reference_fingerprint'])->exists()) {
                    throw new ConflictHttpException('This physical transaction reference has already been recorded.');
                }

                throw $exception;
            }

            ActivityLog::record(
                'cash_fund.return_recorded',
                'Tourism Office cash-fund return recorded for rider #'.$lockedRider->id.'.',
                $movement,
                ActivityLog::TYPE_FINANCIAL
            );

            return $movement;
        });
    }

    public function reverseCashFundReturn(
        User $officer,
        RiderDailyCashMovement $movement,
        string $reference,
        string $referenceNamespace,
        string $evidenceDetails,
        string $idempotencyKey
    ): RiderDailyCashMovement {
        $this->assertPolicyAllowsMutation($movement->business_date->toDateString());

        return DB::transaction(function () use ($officer, $movement, $reference, $referenceNamespace, $evidenceDetails, $idempotencyKey) {
            $rider = User::query()->lockForUpdate()->findOrFail($movement->rider_id);
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $lockedMovement = RiderDailyCashMovement::query()
                ->whereKey($movement->id)
                ->lockForUpdate()
                ->firstOrFail();
            if ($lockedMovement->rider_daily_reconciliation_id !== null
                || $lockedMovement->movement_type !== RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED
                || $lockedMovement->reverses_movement_id !== null) {
                throw new ConflictHttpException('Only an unreversed standalone Tourism Office cash-fund return can use this correction path.');
            }

            $existing = RiderDailyCashMovement::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                if ($existing->movement_type !== RiderDailyCashMovement::TYPE_REVERSAL
                    || (int) $existing->reverses_movement_id !== (int) $lockedMovement->id
                    || $existing->normalized_reference !== $this->normalizeReference($reference)
                    || $existing->reference_namespace !== $referenceNamespace
                    || $existing->evidence_details !== $evidenceDetails) {
                    throw new ConflictHttpException('This idempotency key was already used for a different cash-fund correction.');
                }

                return $existing;
            }
            if ($lockedMovement->reversal()->exists()) {
                throw new ConflictHttpException('This Tourism Office cash-fund return has already been reversed.');
            }

            $referenceDetails = $this->referenceDetails($referenceNamespace, $reference, $evidenceDetails);
            $this->assertReferenceAvailable($referenceDetails);
            $amountCents = -$this->cents($lockedMovement->amount);
            $this->assertCorrectionWithinBalance(
                $rider,
                $lockedMovement->business_date->toDateString(),
                RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED,
                $amountCents
            );
            $affectedReconciliations = RiderDailyReconciliation::query()
                ->where('rider_id', $rider->id)
                ->where('status', RiderDailyReconciliation::STATUS_CLOSED)
                ->whereDate('working_date', '>=', $lockedMovement->business_date->toDateString())
                ->orderBy('working_date')
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            try {
                $reversal = $this->createMovement(
                    $rider,
                    $officer,
                    null,
                    RiderDailyCashMovement::TYPE_REVERSAL,
                    RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED,
                    $amountCents,
                    $idempotencyKey,
                    $reference,
                    $evidenceDetails,
                    $lockedMovement->id,
                    null,
                    $referenceDetails,
                    $lockedMovement->business_date->toDateString(),
                    null,
                    CarbonImmutable::now(),
                    $lockedMovement->municipality_id
                );
            } catch (QueryException $exception) {
                if (RiderDailyCashMovement::query()->where('reference_fingerprint', $referenceDetails['reference_fingerprint'])->exists()) {
                    throw new ConflictHttpException('This physical transaction reference has already been recorded.');
                }

                throw $exception;
            }

            foreach ($affectedReconciliations as $affectedReconciliation) {
                $correctionCycle = $this->beginCorrectionReview($affectedReconciliation, $officer);
                $reversal->correctionCycles()->attach($correctionCycle->id);
                $this->recordEvent(
                    $affectedReconciliation,
                    $officer,
                    'cash_fund_return_reversal_correction_created',
                    RiderDailyReconciliation::STATUS_CLOSED,
                    RiderDailyReconciliation::STATUS_CLOSED,
                    null,
                    [
                        'movement_id' => $reversal->id,
                        'reversed_movement_id' => $lockedMovement->id,
                        'correction_cycle_id' => $correctionCycle->id,
                        'cycle_number' => $correctionCycle->cycle_number,
                        'return_business_date' => $lockedMovement->business_date->toDateString(),
                    ]
                );
            }

            ActivityLog::record(
                'cash_fund.return_reversed',
                'Tourism Office cash-fund return #'.$lockedMovement->id.' was reversed.',
                $reversal,
                ActivityLog::TYPE_FINANCIAL
            );

            return $reversal;
        });
    }

    public function close(
        User $officer,
        RiderDailyReconciliation $reconciliation,
        string $idempotencyKey
    ): RiderDailyReconciliation {
        $date = $reconciliation->working_date->toDateString();
        $this->assertPolicyAllowsMutation($date);

        return DB::transaction(function () use ($officer, $reconciliation, $idempotencyKey) {
            $rider = User::query()->lockForUpdate()->findOrFail($reconciliation->rider_id);
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $locked = RiderDailyReconciliation::query()
                ->whereKey($reconciliation->id)
                ->lockForUpdate()
                ->firstOrFail();
            $existingEvent = RiderDailyReconciliationEvent::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existingEvent) {
                if ((int) $existingEvent->rider_daily_reconciliation_id !== (int) $locked->id
                    || $existingEvent->action !== 'closed') {
                    throw new ConflictHttpException('This idempotency key was already used for a different reconciliation action.');
                }

                return $locked->load('events.actor:id,name');
            }

            if ($locked->status !== RiderDailyReconciliation::STATUS_VERIFIED) {
                throw new ConflictHttpException('Only a verified reconciliation without unresolved discrepancies can be closed.');
            }

            $fromStatus = $locked->status;
            $locked->update([
                'status' => RiderDailyReconciliation::STATUS_CLOSED,
                'closed_by' => $officer->id,
                'closed_at' => now(),
            ]);
            $this->recordEvent($locked, $officer, 'closed', $fromStatus, $locked->status, $idempotencyKey, []);

            return $locked->load('events.actor:id,name');
        });
    }

    public function reviewCorrection(
        User $officer,
        RiderDailyReconciliationCorrection $correction,
        string $decision,
        ?string $note,
        string $idempotencyKey
    ): RiderDailyReconciliationCorrection {
        return DB::transaction(function () use ($officer, $correction, $decision, $note, $idempotencyKey) {
            $reconciliationId = (int) RiderDailyReconciliationCorrection::query()
                ->whereKey($correction->id)
                ->value('rider_daily_reconciliation_id');
            $riderId = (int) RiderDailyReconciliation::query()
                ->whereKey($reconciliationId)
                ->value('rider_id');
            $rider = User::query()->lockForUpdate()->findOrFail($riderId);
            $reconciliation = RiderDailyReconciliation::query()
                ->whereKey($reconciliationId)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedCorrection = RiderDailyReconciliationCorrection::query()
                ->whereKey($correction->id)
                ->lockForUpdate()
                ->firstOrFail();
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $this->assertPolicyAllowsMutation($reconciliation->working_date->toDateString());

            $existingEvent = RiderDailyReconciliationEvent::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existingEvent) {
                if ((int) $existingEvent->rider_daily_reconciliation_id !== (int) $reconciliation->id
                    || ! in_array($existingEvent->action, ['correction_reviewed', 'correction_rejected'], true)
                    || (int) ($existingEvent->details['correction_cycle_id'] ?? 0) !== (int) $lockedCorrection->id) {
                    throw new ConflictHttpException('This idempotency key was already used for a different correction action.');
                }

                return $lockedCorrection;
            }

            $latest = $reconciliation->corrections()->orderByDesc('cycle_number')->first();
            if ((int) $latest?->id !== (int) $lockedCorrection->id
                || $lockedCorrection->status !== RiderDailyReconciliationCorrection::STATUS_PENDING_REVIEW) {
                throw new ConflictHttpException('Only the latest pending correction can be reviewed.');
            }
            if (! in_array($decision, ['approve', 'reject'], true)) {
                throw new ConflictHttpException('Choose approve or reject for the correction review.');
            }

            $snapshot = $this->correctionBalanceSnapshot($rider, $reconciliation->working_date->toDateString());
            $status = $decision === 'approve'
                ? RiderDailyReconciliationCorrection::STATUS_REVIEWED
                : RiderDailyReconciliationCorrection::STATUS_REJECTED;
            $lockedCorrection->update([
                'status' => $status,
                'balance_snapshot' => $snapshot,
                'reviewed_by' => $officer->id,
                'reviewed_at' => now(),
                'review_decision' => $decision,
                'review_note' => $note,
            ]);
            $this->recordEvent(
                $reconciliation,
                $officer,
                $decision === 'approve' ? 'correction_reviewed' : 'correction_rejected',
                RiderDailyReconciliation::STATUS_CLOSED,
                RiderDailyReconciliation::STATUS_CLOSED,
                $idempotencyKey,
                [
                    'correction_cycle_id' => $lockedCorrection->id,
                    'cycle_number' => $lockedCorrection->cycle_number,
                    'decision' => $decision,
                    'balance_snapshot' => $snapshot,
                    'note' => $note,
                ]
            );

            return $lockedCorrection->fresh();
        });
    }

    public function closeCorrection(
        User $officer,
        RiderDailyReconciliationCorrection $correction,
        string $idempotencyKey
    ): RiderDailyReconciliationCorrection {
        $result = DB::transaction(function () use ($officer, $correction, $idempotencyKey) {
            $reconciliationId = (int) RiderDailyReconciliationCorrection::query()
                ->whereKey($correction->id)
                ->value('rider_daily_reconciliation_id');
            $riderId = (int) RiderDailyReconciliation::query()
                ->whereKey($reconciliationId)
                ->value('rider_id');
            $rider = User::query()->lockForUpdate()->findOrFail($riderId);
            $reconciliation = RiderDailyReconciliation::query()
                ->whereKey($reconciliationId)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedCorrection = RiderDailyReconciliationCorrection::query()
                ->whereKey($correction->id)
                ->lockForUpdate()
                ->firstOrFail();
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $this->assertPolicyAllowsMutation($reconciliation->working_date->toDateString());

            $existingEvent = RiderDailyReconciliationEvent::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existingEvent) {
                if ((int) $existingEvent->rider_daily_reconciliation_id !== (int) $reconciliation->id
                    || ! in_array($existingEvent->action, ['correction_closed', 'correction_review_stale'], true)
                    || (int) ($existingEvent->details['correction_cycle_id'] ?? 0) !== (int) $lockedCorrection->id) {
                    throw new ConflictHttpException('This idempotency key was already used for a different correction action.');
                }

                return [
                    'correction' => $lockedCorrection,
                    'stale' => $existingEvent->action === 'correction_review_stale',
                ];
            }

            $latest = $reconciliation->corrections()->orderByDesc('cycle_number')->first();
            if ((int) $latest?->id !== (int) $lockedCorrection->id
                || $lockedCorrection->status !== RiderDailyReconciliationCorrection::STATUS_REVIEWED) {
                throw new ConflictHttpException('Only the latest reviewed correction can be closed.');
            }

            $currentSnapshot = $this->correctionBalanceSnapshot($rider, $reconciliation->working_date->toDateString());
            if ($currentSnapshot !== $lockedCorrection->balance_snapshot) {
                $lockedCorrection->update([
                    'status' => RiderDailyReconciliationCorrection::STATUS_PENDING_REVIEW,
                ]);
                $this->recordEvent(
                    $reconciliation,
                    $officer,
                    'correction_review_stale',
                    RiderDailyReconciliation::STATUS_CLOSED,
                    RiderDailyReconciliation::STATUS_CLOSED,
                    $idempotencyKey,
                    [
                        'correction_cycle_id' => $lockedCorrection->id,
                        'cycle_number' => $lockedCorrection->cycle_number,
                        'reviewed_balance_snapshot' => $lockedCorrection->balance_snapshot,
                        'current_balance_snapshot' => $currentSnapshot,
                    ]
                );

                return [
                    'correction' => $lockedCorrection->fresh(),
                    'stale' => true,
                ];
            }

            $lockedCorrection->update([
                'status' => RiderDailyReconciliationCorrection::STATUS_CLOSED,
                'closed_by' => $officer->id,
                'closed_at' => now(),
            ]);
            $this->recordEvent(
                $reconciliation,
                $officer,
                'correction_closed',
                RiderDailyReconciliation::STATUS_CLOSED,
                RiderDailyReconciliation::STATUS_CLOSED,
                $idempotencyKey,
                [
                    'correction_cycle_id' => $lockedCorrection->id,
                    'cycle_number' => $lockedCorrection->cycle_number,
                    'balance_snapshot' => $lockedCorrection->balance_snapshot,
                ]
            );

            return [
                'correction' => $lockedCorrection->fresh(),
                'stale' => false,
            ];
        });

        if ($result['stale']) {
            throw new ConflictHttpException('The reviewed financial snapshot is stale. The correction is pending review again; review the current balances before closing.');
        }

        return $result['correction'];
    }

    public function reverseMovement(
        User $officer,
        RiderDailyCashMovement $movement,
        string $idempotencyKey,
        string $reference,
        string $referenceNamespace,
        string $evidenceDetails
    ): RiderDailyCashMovement {
        $this->assertPolicyAllowsMutation($movement->business_date->toDateString());

        return DB::transaction(function () use ($officer, $movement, $idempotencyKey, $reference, $referenceNamespace, $evidenceDetails) {
            $rider = User::query()->lockForUpdate()->findOrFail($movement->rider_id);
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $lockedMovement = RiderDailyCashMovement::query()
                ->whereKey($movement->id)
                ->lockForUpdate()
                ->firstOrFail();

            $existing = RiderDailyCashMovement::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                if ($existing->movement_type !== RiderDailyCashMovement::TYPE_REVERSAL
                    || (int) $existing->reverses_movement_id !== (int) $lockedMovement->id
                    || $existing->normalized_reference !== $this->normalizeReference($reference)
                    || $existing->reference_namespace !== $referenceNamespace
                    || $existing->evidence_details !== $evidenceDetails) {
                    throw new ConflictHttpException('This idempotency key was already used for a different financial movement.');
                }

                return $existing;
            }
            if ($lockedMovement->movement_type === RiderDailyCashMovement::TYPE_REVERSAL
                || ! in_array($this->balanceType($lockedMovement), RiderDailyCashMovement::BALANCE_TYPES, true)
                || $lockedMovement->reversal()->exists()) {
                throw new ConflictHttpException('This financial movement cannot be reversed again.');
            }

            $reconciliation = $lockedMovement->reconciliation()->lockForUpdate()->firstOrFail();
            if ($reconciliation->status !== RiderDailyReconciliation::STATUS_CLOSED) {
                throw new ConflictHttpException('Only a closed reconciliation can be corrected through a reversal.');
            }
            $referenceDetails = $this->referenceDetails($referenceNamespace, $reference, $evidenceDetails);
            $this->assertReferenceAvailable($referenceDetails);
            $affectsType = $this->balanceType($lockedMovement);
            $amountCents = -$this->cents($lockedMovement->amount);
            $this->assertCorrectionWithinBalance($rider, $lockedMovement->business_date->toDateString(), $affectsType, $amountCents);
            $correctionCycle = $this->beginCorrectionReview($reconciliation, $officer);
            try {
                $reversal = $this->createMovement(
                    $rider,
                    $officer,
                    $reconciliation,
                    RiderDailyCashMovement::TYPE_REVERSAL,
                    $affectsType,
                    $amountCents,
                    $idempotencyKey,
                    $reference,
                    $evidenceDetails,
                    $lockedMovement->id,
                    null,
                    $referenceDetails,
                    null,
                    $correctionCycle->id
                );
            } catch (QueryException $exception) {
                if (RiderDailyCashMovement::query()->where('reference_fingerprint', $referenceDetails['reference_fingerprint'])->exists()) {
                    throw new ConflictHttpException('This physical transaction reference has already been recorded.');
                }

                throw $exception;
            }
            $this->recordEvent(
                $reconciliation,
                $officer,
                'movement_reversed',
                $reconciliation->status,
                $reconciliation->status,
                $idempotencyKey,
                [
                    'movement_id' => $lockedMovement->id,
                    'reversal_id' => $reversal->id,
                    'affects_type' => $affectsType,
                    'amount' => $this->money($amountCents),
                    'reference' => $reference,
                    'reference_namespace' => $referenceNamespace,
                    'evidence_details' => $evidenceDetails,
                    'correction_cycle_id' => $correctionCycle->id,
                ]
            );

            return $reversal;
        });
    }

    public function adjustMovement(
        User $officer,
        RiderDailyReconciliation $reconciliation,
        RiderDailyCashMovement $relatedMovement,
        float $amount,
        string $reference,
        string $referenceNamespace,
        string $evidenceDetails,
        string $idempotencyKey
    ): RiderDailyCashMovement {
        $date = $reconciliation->working_date->toDateString();
        $this->assertPolicyAllowsMutation($date);

        return DB::transaction(function () use ($officer, $reconciliation, $relatedMovement, $amount, $reference, $referenceNamespace, $evidenceDetails, $idempotencyKey, $date) {
            $rider = User::query()->lockForUpdate()->findOrFail($reconciliation->rider_id);
            $this->cashFund->assertMunicipalityAccess($officer, $rider);
            $lockedReconciliation = RiderDailyReconciliation::query()
                ->whereKey($reconciliation->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedMovement = RiderDailyCashMovement::query()
                ->whereKey($relatedMovement->id)
                ->lockForUpdate()
                ->firstOrFail();
            if ((int) $lockedMovement->rider_daily_reconciliation_id !== (int) $lockedReconciliation->id
                || $lockedMovement->business_date->toDateString() !== $date) {
                throw new ConflictHttpException('The adjusted movement must belong to this rider and business date.');
            }
            if ($lockedReconciliation->status !== RiderDailyReconciliation::STATUS_CLOSED) {
                throw new ConflictHttpException('Only a closed reconciliation can be corrected through an adjustment.');
            }
            $existing = RiderDailyCashMovement::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                if ($existing->movement_type !== RiderDailyCashMovement::TYPE_ADJUSTMENT
                    || (int) $existing->adjusts_movement_id !== (int) $lockedMovement->id
                    || $this->cents($existing->amount) !== $this->cents($amount)
                    || $existing->normalized_reference !== $this->normalizeReference($reference)
                    || $existing->reference_namespace !== $referenceNamespace
                    || $existing->evidence_details !== $evidenceDetails) {
                    throw new ConflictHttpException('This idempotency key was already used for a different financial adjustment.');
                }

                return $existing;
            }
            $affectsType = $this->balanceType($lockedMovement);
            if (! in_array($affectsType, RiderDailyCashMovement::BALANCE_TYPES, true)) {
                throw new ConflictHttpException('The related movement does not identify a supported financial balance.');
            }
            $amountCents = $this->cents($amount);
            if ($amountCents === 0) {
                throw new ConflictHttpException('A financial adjustment must be nonzero.');
            }
            $referenceDetails = $this->referenceDetails($referenceNamespace, $reference, $evidenceDetails);
            $this->assertReferenceAvailable($referenceDetails);
            $this->assertCorrectionWithinBalance($rider, $date, $affectsType, $amountCents);
            $correctionCycle = $this->beginCorrectionReview($lockedReconciliation, $officer);
            try {
                $adjustment = $this->createMovement(
                    $rider,
                    $officer,
                    $lockedReconciliation,
                    RiderDailyCashMovement::TYPE_ADJUSTMENT,
                    $affectsType,
                    $amountCents,
                    $idempotencyKey,
                    $reference,
                    $evidenceDetails,
                    null,
                    $lockedMovement->id,
                    $referenceDetails,
                    null,
                    $correctionCycle->id
                );
            } catch (QueryException $exception) {
                if (RiderDailyCashMovement::query()->where('reference_fingerprint', $referenceDetails['reference_fingerprint'])->exists()) {
                    throw new ConflictHttpException('This physical transaction reference has already been recorded.');
                }

                throw $exception;
            }
            $this->recordEvent(
                $lockedReconciliation,
                $officer,
                'movement_adjusted',
                $lockedReconciliation->status,
                $lockedReconciliation->status,
                $idempotencyKey,
                [
                    'related_movement_id' => $lockedMovement->id,
                    'adjustment_id' => $adjustment->id,
                    'affects_type' => $affectsType,
                    'amount' => $this->money($amountCents),
                    'reference' => $reference,
                    'reference_namespace' => $referenceNamespace,
                    'evidence_details' => $evidenceDetails,
                    'correction_cycle_id' => $correctionCycle->id,
                ]
            );

            return $adjustment;
        });
    }

    public function policyStatus(?string $date = null): array
    {
        $effectiveDate = config('cod_cash.effective_date');
        $enabled = (bool) config('cod_cash.reconciliation_enabled', false)
            && is_string($effectiveDate)
            && $effectiveDate !== '';
        $validEffectiveDate = false;
        if ($enabled) {
            try {
                $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $effectiveDate);
                $validEffectiveDate = $parsed !== false && $parsed->format('Y-m-d') === $effectiveDate;
            } catch (\InvalidArgumentException) {
                $validEffectiveDate = false;
            }
        }
        $enabled = $enabled && $validEffectiveDate;
        $dateEligible = $date === null || ! $enabled || $date >= $effectiveDate;

        return [
            'enabled' => $enabled,
            'mutations_enabled' => $enabled && $dateEligible,
            'effective_date' => $effectiveDate,
            'status' => ! $validEffectiveDate && (bool) config('cod_cash.reconciliation_enabled', false)
                ? 'invalid_effective_date'
                : (! $enabled ? 'inactive_pending_activation' : ($dateEligible ? 'active' : 'legacy_policy')),
        ];
    }

    private function beginCorrectionReview(
        RiderDailyReconciliation $reconciliation,
        User $officer
    ): RiderDailyReconciliationCorrection {
        $latest = $reconciliation->corrections()
            ->orderByDesc('cycle_number')
            ->lockForUpdate()
            ->first();

        if ($latest && $latest->status !== 'closed' && $latest->status !== 'superseded') {
            $latest->update(['status' => 'superseded']);
            $this->recordEvent(
                $reconciliation,
                $officer,
                'correction_superseded',
                RiderDailyReconciliation::STATUS_CLOSED,
                RiderDailyReconciliation::STATUS_CLOSED,
                null,
                [
                    'correction_cycle_id' => $latest->id,
                    'cycle_number' => $latest->cycle_number,
                ]
            );
        }

        return RiderDailyReconciliationCorrection::create([
            'rider_daily_reconciliation_id' => $reconciliation->id,
            'cycle_number' => ($latest?->cycle_number ?? 0) + 1,
            'status' => RiderDailyReconciliationCorrection::STATUS_PENDING_REVIEW,
            'created_by' => $officer->id,
        ]);
    }

    private function correctionBalanceSnapshot(User $rider, string $date): array
    {
        $balances = $this->calculateBalances($rider, $date);
        $totals = $balances['receipt']['totals'];

        return [
            'eligible_cod_collections' => $this->canonicalMoney($totals['cash_collected']),
            'rider_delivery_fee_entitlement' => $this->canonicalMoney($totals['rider_delivery_fee_entitlement']),
            'rider_tip_entitlement' => $this->canonicalMoney($totals['rider_tip_entitlement']),
            'verified_rider_funded_purchase_contributions' => $this->canonicalMoney($totals['verified_personal_purchase_reimbursement']),
            'verified_office_funded_purchases' => $this->canonicalMoney($totals['tourism_office_cash_used_to_date']),
            'authorized_cash_fund_issuance' => $this->canonicalMoney($totals['tourism_office_cash_issued_to_date']),
            'cod_receipts_recorded' => $this->movementComponent($rider, RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, $date),
            'purchasing_cash_returns_recorded' => $this->movementComponent(
                $rider,
                RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED,
                $date,
                true
            ),
            'rider_reimbursements_paid' => $this->movementComponent($rider, RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, $date),
            'signed_reversals' => [
                'cod_remittance' => $this->signedMovementComponent($rider, RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, $date, RiderDailyCashMovement::TYPE_REVERSAL),
                'purchasing_cash_return' => $this->signedMovementComponent($rider, RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED, $date, RiderDailyCashMovement::TYPE_REVERSAL, true),
                'rider_reimbursement' => $this->signedMovementComponent($rider, RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, $date, RiderDailyCashMovement::TYPE_REVERSAL),
            ],
            'signed_adjustments' => [
                'cod_remittance' => $this->signedMovementComponent($rider, RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, $date, RiderDailyCashMovement::TYPE_ADJUSTMENT),
                'purchasing_cash_return' => $this->signedMovementComponent($rider, RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED, $date, RiderDailyCashMovement::TYPE_ADJUSTMENT, true),
                'rider_reimbursement' => $this->signedMovementComponent($rider, RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, $date, RiderDailyCashMovement::TYPE_ADJUSTMENT),
            ],
            'outstanding_cod_remittance' => $this->money($balances['cod_remittance_outstanding_cents']),
            'outstanding_purchasing_cash_return' => $this->money($balances['office_cash_return_outstanding_cents']),
            'outstanding_rider_reimbursement' => $this->money($balances['rider_reimbursement_outstanding_cents']),
        ];
    }

    private function movementComponent(
        User $rider,
        string $balanceType,
        string $date,
        bool $throughDate = false
    ): string {
        $query = RiderDailyCashMovement::query()
            ->where('rider_id', $rider->id)
            ->where('movement_type', $balanceType);
        if ($throughDate) {
            $query->whereDate('business_date', '<=', $date);
        } else {
            $query->whereDate('business_date', $date);
        }

        return $this->money($this->cents((string) $query->sum('amount')));
    }

    private function signedMovementComponent(
        User $rider,
        string $balanceType,
        string $date,
        string $movementType,
        bool $throughDate = false
    ): string {
        $query = RiderDailyCashMovement::query()
            ->where('rider_id', $rider->id)
            ->where('movement_type', $movementType)
            ->where('affects_type', $balanceType);
        if ($throughDate) {
            $query->whereDate('business_date', '<=', $date);
        } else {
            $query->whereDate('business_date', $date);
        }

        return $this->money($this->cents((string) $query->sum('amount')));
    }

    private function canonicalMoney(string|float|int|null $amount): string
    {
        return $this->money($this->cents($amount));
    }

    private function calculateBalances(User $rider, string $date, ?int $excludeReconciliationId = null): array
    {
        $receipt = $this->cashFund->dailyReceipt($rider, $date);
        $totals = $receipt['totals'];
        $codBase = $this->cents($totals['net_cod_remittance_expected']);
        $officeCashBase = $this->cents($totals['tourism_office_cash_issued_less_verified_spending']);
        $reimbursementBase = $this->cents($totals['verified_personal_purchase_reimbursement']);
        $codReceived = $this->movementTotal($rider, RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, $date, false, $excludeReconciliationId);
        $cashReturned = $this->movementTotal($rider, RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED, $date, true, $excludeReconciliationId);
        $reimbursementPaid = $this->movementTotal($rider, RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, $date, false, $excludeReconciliationId);

        return [
            'receipt' => $receipt,
            'eligible_delivery_count' => (int) $totals['eligible_delivery_count'],
            'cod_base_cents' => $codBase,
            'office_cash_base_cents' => $officeCashBase,
            'reimbursement_base_cents' => $reimbursementBase,
            'cod_remittance_outstanding_cents' => $this->remaining($codBase, $codReceived, 'COD remittance'),
            'office_cash_return_outstanding_cents' => $this->remaining($officeCashBase, $cashReturned, 'Tourism Office cash return'),
            'rider_reimbursement_outstanding_cents' => $this->remaining($reimbursementBase, $reimbursementPaid, 'Rider reimbursement'),
        ];
    }

    private function movementTotal(
        User $rider,
        string $balanceType,
        string $date,
        bool $throughDate = false,
        ?int $excludeReconciliationId = null
    ): int {
        $query = RiderDailyCashMovement::query()
            ->where('rider_id', $rider->id)
            ->whereRaw('COALESCE(affects_type, movement_type) = ?', [$balanceType]);
        if ($excludeReconciliationId !== null) {
            $query->where(function ($query) use ($excludeReconciliationId) {
                $query->whereNull('rider_daily_reconciliation_id')
                    ->orWhere('rider_daily_reconciliation_id', '!=', $excludeReconciliationId);
            });
        }
        if ($throughDate) {
            $query->whereDate('business_date', '<=', $date);
        } else {
            $query->whereDate('business_date', $date);
        }

        return $this->cents((string) $query->sum('amount'));
    }

    private function movementAmountsForReconciliation(RiderDailyReconciliation $reconciliation): array
    {
        $amounts = [];
        foreach (RiderDailyCashMovement::BALANCE_TYPES as $movementType) {
            $amounts[$movementType] = $this->cents((string) RiderDailyCashMovement::query()
                ->where('rider_daily_reconciliation_id', $reconciliation->id)
                ->whereRaw('COALESCE(affects_type, movement_type) = ?', [$movementType])
                ->sum('amount'));
        }

        return $amounts;
    }

    private function assertCorrectionWithinBalance(User $rider, string $date, string $balanceType, int $amountCents): void
    {
        $balances = $this->calculateBalances($rider, $date);
        $keys = [
            RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED => ['cod_base_cents', 'cod_remittance_outstanding_cents'],
            RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED => ['office_cash_base_cents', 'office_cash_return_outstanding_cents'],
            RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID => ['reimbursement_base_cents', 'rider_reimbursement_outstanding_cents'],
        ];
        [$baseKey, $outstandingKey] = $keys[$balanceType];
        $newOutstanding = $balances[$outstandingKey] - $amountCents;
        if ($newOutstanding < 0 || $newOutstanding > $balances[$baseKey]) {
            throw new ConflictHttpException('The reversal or adjustment would exceed the authoritative financial balance.');
        }
    }

    private function remaining(int $baseCents, int $movementCents, string $label): int
    {
        $remaining = $baseCents - $movementCents;
        if ($remaining < 0 || $remaining > $baseCents) {
            throw new ConflictHttpException("Recorded {$label} movements exceed the authoritative obligation; review the movement ledger.");
        }

        return $remaining;
    }

    private function assertWithinOutstanding(float $amount, int $outstandingCents, string $message): void
    {
        if ($this->cents($amount) > $outstandingCents) {
            throw new ConflictHttpException($message);
        }
    }

    private function createMovement(
        User $rider,
        User $officer,
        ?RiderDailyReconciliation $reconciliation,
        string $movementType,
        string $affectsType,
        int $amountCents,
        string $idempotencyKey,
        ?string $reference,
        ?string $evidenceDetails,
        ?int $reversesMovementId = null,
        ?int $adjustsMovementId = null,
        ?array $referenceDetails = null,
        ?string $businessDate = null,
        ?int $correctionCycleId = null,
        ?CarbonImmutable $transactionAt = null,
        ?int $municipalityId = null
    ): RiderDailyCashMovement {
        return RiderDailyCashMovement::create([
            'rider_id' => $rider->id,
            'municipality_id' => $municipalityId ?? $reconciliation?->municipality_id ?? $rider->municipality_id,
            'business_date' => $businessDate ?? $reconciliation?->working_date->toDateString(),
            'rider_daily_reconciliation_id' => $reconciliation?->id,
            'revision' => $reconciliation?->revision,
            'movement_type' => $movementType,
            'affects_type' => $affectsType,
            'amount' => $this->money($amountCents),
            'recorded_by' => $officer->id,
            'transaction_at' => $transactionAt ?? now(),
            'reference' => $reference,
            'reference_type' => $referenceDetails['reference_type'] ?? null,
            'reference_namespace' => $referenceDetails['reference_namespace'] ?? null,
            'reference_source' => $referenceDetails['reference_source'] ?? null,
            'reference_issuer' => $referenceDetails['reference_issuer'] ?? null,
            'reference_series' => $referenceDetails['reference_series'] ?? null,
            'normalized_reference' => $referenceDetails['normalized_reference'] ?? null,
            'reference_fingerprint' => $referenceDetails['reference_fingerprint'] ?? null,
            'evidence_details' => $evidenceDetails,
            'idempotency_key' => $idempotencyKey,
            'reverses_movement_id' => $reversesMovementId,
            'adjusts_movement_id' => $adjustsMovementId,
            'correction_cycle_id' => $correctionCycleId,
        ]);
    }

    private function referenceDetails(string $namespace, string $reference, ?string $evidenceDetails): array
    {
        $normalized = $this->normalizeReference($reference);
        if ($normalized === '' || strlen($normalized) > 100) {
            throw new ConflictHttpException('A valid physical transaction reference is required.');
        }

        $configured = config('cod_cash.cash_movement_reference_namespaces', []);
        $definition = is_array($configured) ? ($configured[$namespace] ?? null) : null;
        if (! is_array($definition)
            || ! in_array($definition['type'] ?? null, ['office_receipt', 'provider_transaction', 'manual_evidence'], true)
            || trim((string) ($definition['source'] ?? '')) === '') {
            throw new ConflictHttpException('The physical reference namespace is not configured for use.');
        }

        $type = $definition['type'];
        $source = trim((string) $definition['source']);
        $issuer = trim((string) ($definition['issuer'] ?? ''));
        $series = trim((string) ($definition['series'] ?? ''));
        if ($type === 'office_receipt' && ($issuer === '' || $series === '')) {
            throw new ConflictHttpException('Office receipt namespaces require a configured issuer and receipt series.');
        }
        if ($type === 'manual_evidence' && $issuer === '') {
            throw new ConflictHttpException('Manual evidence namespaces require a configured issuer identity.');
        }
        if ($type !== 'provider_transaction' && trim((string) $evidenceDetails) === '') {
            throw new ConflictHttpException('Manual cash movements require evidence details.');
        }

        $identity = [
            $type,
            $source,
            $issuer,
            $series,
            $normalized,
        ];

        return [
            'reference_type' => $type,
            'reference_namespace' => $namespace,
            'reference_source' => $source,
            'reference_issuer' => $issuer,
            'reference_series' => $series,
            'normalized_reference' => $normalized,
            'reference_fingerprint' => hash('sha256', json_encode($identity, JSON_THROW_ON_ERROR)),
        ];
    }

    private function normalizeReference(string $reference): string
    {
        return mb_strtoupper(preg_replace('/\s+/', ' ', trim($reference)) ?? '');
    }

    private function assertReferenceAvailable(array $referenceDetails): void
    {
        if (RiderDailyCashMovement::query()
            ->where('reference_fingerprint', $referenceDetails['reference_fingerprint'])
            ->exists()) {
            throw new ConflictHttpException('This physical transaction reference has already been recorded in its issuer namespace.');
        }
    }

    private function balanceType(RiderDailyCashMovement $movement): string
    {
        return $movement->affects_type ?? $movement->movement_type;
    }

    private function assertSameIdempotentVerification(
        RiderDailyReconciliationEvent $event,
        RiderDailyReconciliation $reconciliation,
        float $codReceived,
        float $cashReturned,
        float $reimbursement
    ): void {
        $details = $event->details ?? [];
        if ((int) $event->rider_daily_reconciliation_id !== (int) $reconciliation->id
            || $event->action !== 'verified'
            || $this->cents($details['cod_received'] ?? -1) !== $this->cents($codReceived)
            || $this->cents($details['cash_returned'] ?? -1) !== $this->cents($cashReturned)
            || $this->cents($details['rider_reimbursement_paid'] ?? -1) !== $this->cents($reimbursement)) {
            throw new ConflictHttpException('This idempotency key was already used for a different reconciliation action or amount.');
        }
    }

    private function cents(string|float|int|null $amount): int
    {
        $value = is_float($amount) ? number_format($amount, 2, '.', '') : trim((string) ($amount ?? '0'));
        if (! preg_match('/^(-?)(\d+)(?:\.(\d{1,2}))?$/', $value, $matches)) {
            throw new \InvalidArgumentException('Financial amounts must be valid decimal values with at most two fractional digits.');
        }

        $cents = ((int) $matches[2] * 100) + (int) str_pad($matches[3] ?? '', 2, '0');

        return ($matches[1] ?? '') === '-' ? -$cents : $cents;
    }

    private function money(int $cents): string
    {
        $whole = intdiv(abs($cents), 100);
        $fraction = abs($cents) % 100;

        return ($cents < 0 ? '-' : '').$whole.'.'.str_pad((string) $fraction, 2, '0', STR_PAD_LEFT);
    }

    private function assertPolicyAllowsMutation(string $date): void
    {
        $policy = $this->policyStatus($date);
        if (! $policy['mutations_enabled']) {
            throw new ConflictHttpException(match ($policy['status']) {
                'legacy_policy' => 'This date is under the legacy COD cash policy and cannot be reconciled through the new workflow.',
                'invalid_effective_date' => 'The configured daily COD reconciliation effective date is invalid.',
                default => 'Daily COD cash reconciliation is inactive. No cash submission, verification, or closing is permitted.',
            });
        }
    }

    private function assertRider(User $rider): void
    {
        if ($rider->role !== User::ROLE_RIDER || $rider->municipality_id === null) {
            throw new AuthorizationException('A valid rider with an assigned municipality is required.');
        }
    }

    private function recordEvent(
        RiderDailyReconciliation $reconciliation,
        User $actor,
        string $action,
        ?string $fromStatus,
        string $toStatus,
        ?string $idempotencyKey,
        array $details
    ): void {
        RiderDailyReconciliationEvent::create([
            'rider_daily_reconciliation_id' => $reconciliation->id,
            'actor_id' => $actor->id,
            'action' => $action,
            'from_status' => $fromStatus,
            'to_status' => $toStatus,
            'idempotency_key' => $idempotencyKey,
            'details' => $details,
            'created_at' => now(),
        ]);
        ActivityLog::record(
            'cash_reconciliation.'.$action,
            'Rider cash reconciliation #'.$reconciliation->id.' '.$action.' (revision '.$reconciliation->revision.').',
            $reconciliation,
            ActivityLog::TYPE_FINANCIAL
        );
    }
}
