<?php

namespace App\Services;

use App\Enums\TripStatus;
use App\Models\ActivityLog;
use App\Models\CodPurchase;
use App\Models\CodPurchaseExpense;
use App\Models\CodSettlement;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\RiderCashFund;
use App\Models\RiderCashFundTransaction;
use App\Models\RiderDailyCashMovement;
use App\Models\RiderDailyReconciliation;
use App\Models\RiderDailyReconciliationEvent;
use App\Models\RiderEarning;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Throwable;

class RiderCashFundService
{
    public function dailyReceipt(User $rider, string $date): array
    {
        if ($rider->role !== User::ROLE_RIDER) {
            throw new AuthorizationException('Daily cash receipts are available only to riders.');
        }

        return $this->buildDailyReceipt($rider, $date);
    }

    public function adminDailyReceipt(User $officer, User $rider, string $date): array
    {
        $this->assertMunicipalityAccess($officer, $rider);

        return $this->buildDailyReceipt($rider, $date);
    }

    private function buildDailyReceipt(User $rider, string $date): array
    {
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $date, 'Asia/Manila')->startOfDay();
        $end = $start->addDay();
        $deliveries = Delivery::query()
            ->where('rider_id', $rider->id)
            ->where('status', TripStatus::COMPLETED->value)
            ->whereNotNull('cash_settled_at')
            ->whereRaw('COALESCE(delivered_at, cash_settled_at) >= ?', [$start->utc()])
            ->whereRaw('COALESCE(delivered_at, cash_settled_at) < ?', [$end->utc()])
            ->with(['order', 'groupCheckout.orders', 'cashFundTransactions', 'codPurchases.business', 'codPurchases.expenses'])
            ->orderByRaw('COALESCE(delivered_at, cash_settled_at)')
            ->get();

        $receiptDeliveries = [];
        $excludedDeliveries = [];
        $cashCollected = 0.0;
        $cashTendered = 0.0;
        $changeGiven = 0.0;
        $deliveryFeeEntitlement = 0.0;
        $tipEntitlement = 0.0;
        $personalContribution = 0.0;
        $settlementBase = 0.0;
        $restaurantShare = 0.0;
        $tourismOfficeShare = 0.0;

        foreach ($deliveries as $delivery) {
            if (! app(NearestRiderService::class)->isCodDelivery($delivery)) {
                continue;
            }

            $orders = $delivery->childOrders();
            if ($orders->isEmpty()) {
                $excludedDeliveries[] = ['delivery_id' => $delivery->id, 'reason' => 'No orders are linked to this completed delivery.'];

                continue;
            }

            $orderPayments = [];
            $orderEarnings = [];
            $orderSettlements = [];
            $exclusionReason = null;

            foreach ($orders as $order) {
                if ($order->status !== 'completed' || $order->payment_status !== 'paid'
                    || $order->payment_method !== 'cash'
                    || in_array($order->refund_status, ['pending', 'processing', 'refunded'], true)) {
                    $exclusionReason = 'An order is unpaid, not completed, or has an in-flight/successful refund.';
                    break;
                }

                $refundExists = Refund::query()
                    ->where('order_id', $order->id)
                    ->whereIn('status', ['pending', 'succeeded'])
                    ->exists();
                if ($refundExists) {
                    $exclusionReason = 'An order has a pending or successful refund.';
                    break;
                }

                $payments = Payment::query()
                    ->where('payable_type', Order::class)
                    ->where('payable_id', $order->id)
                    ->where('method', 'cash')
                    ->where('provider', 'rider')
                    ->where('status', 'paid')
                    ->get()
                    ->values();

                if ($payments->count() !== 1
                    || (int) ($payments->first()?->metadata['delivery_id'] ?? 0) !== (int) $delivery->id) {
                    $exclusionReason = match (true) {
                        $payments->isEmpty() => 'A completed order has no verified rider cash payment record.',
                        $payments->count() > 1 => 'A completed order has duplicate rider cash payment records.',
                        default => 'The rider cash payment record is linked to a different delivery.',
                    };
                    break;
                }

                $earnings = RiderEarning::query()
                    ->where('rider_id', $rider->id)
                    ->where('order_id', $order->id)
                    ->where('status', 'earned')
                    ->whereNotNull('earned_at')
                    ->get();
                if ($earnings->count() !== 1) {
                    $exclusionReason = 'A completed order does not have exactly one authoritative rider-earnings record.';
                    break;
                }

                $settlements = CodSettlement::query()
                    ->where('order_id', $order->id)
                    ->where('delivery_id', $delivery->id)
                    ->whereIn('status', [CodSettlement::STATUS_SETTLED, CodSettlement::STATUS_PAID])
                    ->get();
                if ($settlements->isEmpty()) {
                    $exclusionReason = 'A completed order has no COD settlement allocation.';
                    break;
                }

                $orderBase = round((float) $settlements->sum('settlement_base'), 2);
                $orderRestaurant = round((float) $settlements->sum('restaurant_share'), 2);
                $orderOffice = round((float) $settlements->sum('platform_fee'), 2);
                if ($orderBase <= 0
                    || round($orderBase, 2) !== round((float) $order->rider_financed_amount, 2)
                    || round($orderRestaurant + $orderOffice, 2) !== $orderBase) {
                    $exclusionReason = 'The COD settlement allocation does not reconcile to its recorded base.';
                    break;
                }

                $orderPayments[$order->id] = $payments->first();
                $orderEarnings[$order->id] = $earnings->first();
                $orderSettlements[$order->id] = $settlements;
            }

            $deliveryPaymentsTotal = round(array_sum(array_map(
                fn (Payment $payment) => (float) $payment->amount,
                $orderPayments
            )), 2);
            $netPhysicalCash = round((float) $delivery->cash_received - (float) $delivery->change_given, 2);
            if ($exclusionReason === null
                && (round($deliveryPaymentsTotal, 2) !== round((float) $delivery->cash_due, 2)
                    || $netPhysicalCash !== round((float) $delivery->cash_due, 2))) {
                $exclusionReason = 'The cash payment records do not reconcile to the delivery cash due and change.';
            }

            if ($exclusionReason !== null) {
                $excludedDeliveries[] = [
                    'delivery_id' => $delivery->id,
                    'reason' => $exclusionReason,
                ];

                continue;
            }

            $deliveryEarnings = 0.0;
            $deliveryTips = 0.0;
            $deliverySettlementBase = 0.0;
            $deliveryRestaurantShare = 0.0;
            $deliveryOfficeShare = 0.0;
            $paymentReferences = [];
            $earningReferences = [];
            $settlementReferences = [];

            foreach ($orders as $order) {
                $payment = $orderPayments[$order->id];
                $earning = $orderEarnings[$order->id];
                $settlements = $orderSettlements[$order->id];
                $paymentAmount = round((float) $payment->amount, 2);
                $earnedFee = round((float) $earning->delivery_fee, 2);
                $earnedTip = round((float) $earning->rider_tip, 2);

                $cashCollected += $paymentAmount;
                $deliveryEarnings += $earnedFee;
                $deliveryTips += $earnedTip;
                $deliveryFeeEntitlement += $earnedFee;
                $tipEntitlement += $earnedTip;
                foreach ($settlements as $settlement) {
                    $deliverySettlementBase += (float) $settlement->settlement_base;
                    $deliveryRestaurantShare += (float) $settlement->restaurant_share;
                    $deliveryOfficeShare += (float) $settlement->platform_fee;
                    $settlementReferences[] = [
                        'settlement_id' => $settlement->id,
                        'settlement_number' => $settlement->settlement_number,
                        'order_id' => $settlement->order_id,
                        'business_id' => $settlement->business_id,
                        'settlement_base' => (float) $settlement->settlement_base,
                        'restaurant_share' => (float) $settlement->restaurant_share,
                        'tourism_office_share' => (float) $settlement->platform_fee,
                    ];
                }

                $paymentReferences[] = [
                    'payment_id' => $payment->id,
                    'payment_number' => $payment->payment_number,
                    'order_id' => $order->id,
                    'amount' => $paymentAmount,
                ];
                $earningReferences[] = [
                    'earning_id' => $earning->id,
                    'order_id' => $order->id,
                    'delivery_fee' => $earnedFee,
                    'tip' => $earnedTip,
                ];
            }

            $verifiedExpenses = $delivery->codPurchases
                ->flatMap(fn (CodPurchase $purchase) => $purchase->expenses)
                ->where('status', CodPurchaseExpense::STATUS_VERIFIED);
            $deliveryPersonalContribution = round((float) $verifiedExpenses->sum('rider_personal_contribution'), 2);
            $personalContribution += $deliveryPersonalContribution;
            $cashTendered += (float) $delivery->cash_received;
            $changeGiven += (float) $delivery->change_given;
            $settlementBase += $deliverySettlementBase;
            $restaurantShare += $deliveryRestaurantShare;
            $tourismOfficeShare += $deliveryOfficeShare;

            $cashFundTransactions = $delivery->cashFundTransactions->map(fn (RiderCashFundTransaction $transaction) => [
                'transaction_id' => $transaction->id,
                'reference_number' => $transaction->reference_number,
                'type' => $transaction->type,
                'amount' => (float) $transaction->amount,
                'occurred_at' => $transaction->occurred_at,
            ])->values();
            $expenseReferences = $verifiedExpenses->map(fn (CodPurchaseExpense $expense) => [
                'expense_id' => $expense->id,
                'purchase_id' => $expense->cod_purchase_id,
                'actual_purchase_amount' => (float) $expense->actual_purchase_amount,
                'tourism_office_cash_used' => (float) $expense->tourism_office_cash_used,
                'rider_personal_contribution' => (float) $expense->rider_personal_contribution,
                'verified_by' => $expense->verified_by,
                'verified_at' => $expense->verified_at,
            ])->values();
            $purchaseReferences = $delivery->codPurchases->map(fn (CodPurchase $purchase) => [
                'purchase_id' => $purchase->id,
                'purchase_number' => $purchase->purchase_number,
                'business_id' => $purchase->business_id,
                'business_name' => $purchase->business?->business_name,
                'planned_purchase_amount' => (float) $purchase->purchase_amount,
                'purchase_status' => $purchase->status,
                'purchased_at' => $purchase->purchased_at,
                'collected_at' => $purchase->collected_at,
                'expense_submissions' => $purchase->expenses->map(fn (CodPurchaseExpense $expense) => [
                    'expense_id' => $expense->id,
                    'revision' => $expense->revision,
                    'actual_purchase_amount' => (float) $expense->actual_purchase_amount,
                    'tourism_office_cash_used' => (float) $expense->tourism_office_cash_used,
                    'rider_personal_contribution' => (float) $expense->rider_personal_contribution,
                    'status' => $expense->status,
                    'receipt_evidence_available' => Storage::disk('local')->exists($expense->receipt_path),
                    'submitted_by' => $expense->submitted_by,
                    'submitted_at' => $expense->submitted_at,
                    'verified_by' => $expense->verified_by,
                    'verified_at' => $expense->verified_at,
                ])->values(),
            ])->values();

            $receiptDeliveries[] = [
                'delivery_id' => $delivery->id,
                'group_checkout_id' => $delivery->group_checkout_id,
                'completed_at' => $delivery->delivered_at ?? $delivery->cash_settled_at,
                'cash_settled_at' => $delivery->cash_settled_at,
                'cash_due' => (float) $delivery->cash_due,
                'cash_collected' => $deliveryPaymentsTotal,
                'cash_tendered' => (float) $delivery->cash_received,
                'change_given' => (float) $delivery->change_given,
                'rider_delivery_fee_earnings' => round($deliveryEarnings, 2),
                'rider_tip_entitlement' => round($deliveryTips, 2),
                'verified_personal_purchase_contribution' => $deliveryPersonalContribution,
                'cod_settlement' => [
                    'base' => round($deliverySettlementBase, 2),
                    'restaurant_share' => round($deliveryRestaurantShare, 2),
                    'tourism_office_share' => round($deliveryOfficeShare, 2),
                    'allocations' => $settlementReferences,
                ],
                'purchasing_cash' => [
                    'fund_id' => $delivery->rider_cash_fund_id,
                    'transactions' => $cashFundTransactions,
                ],
                'purchases' => $purchaseReferences,
                'verified_purchase_expenses' => $expenseReferences,
                'payment_references' => $paymentReferences,
                'earning_references' => $earningReferences,
            ];
        }

        $grossCollected = round($cashCollected, 2);
        $totalDeductions = round($deliveryFeeEntitlement + $tipEntitlement + $personalContribution, 2);
        $netBeforeFloor = round($grossCollected - $totalDeductions, 2);
        $reconciliationPolicy = app(RiderDailyReconciliationService::class)->policyStatus($date);
        $isLegacyPolicyDate = $reconciliationPolicy['status'] === 'legacy_policy';
        $netRemittance = $isLegacyPolicyDate ? null : max(0.0, $netBeforeFloor);
        $riderPayable = $isLegacyPolicyDate ? null : max(0.0, -$netBeforeFloor);

        $fundIds = RiderCashFund::query()
            ->where('rider_id', $rider->id)
            ->when($rider->municipality_id !== null, fn ($query) => $query->where('municipality_id', $rider->municipality_id))
            ->where('opened_at', '<', $end->utc())
            ->pluck('id');
        $fundTransactions = RiderCashFundTransaction::query()
            ->whereIn('rider_cash_fund_id', $fundIds)
            ->where('occurred_at', '<', $end->utc())
            ->with('expense')
            ->get();
        $totalOfficeCashIssued = (float) $fundTransactions
            ->whereIn('type', [
                RiderCashFundTransaction::TYPE_CASH_ISSUED,
                RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED,
            ])->sum('amount');
        $totalOfficeCashUsed = (float) $fundTransactions
            ->filter(fn (RiderCashFundTransaction $transaction) => $transaction->type === RiderCashFundTransaction::TYPE_PURCHASE_OFFICE_CASH_USED
                && $transaction->expense?->status === CodPurchaseExpense::STATUS_VERIFIED
            )->sum('amount');
        $officeCashBalanceBeforeReturns = round($totalOfficeCashIssued - $totalOfficeCashUsed, 2);
        $cashReturnsToDate = round((float) RiderDailyCashMovement::query()
            ->where('rider_id', $rider->id)
            ->whereDate('business_date', '<=', $date)
            ->whereRaw('COALESCE(affects_type, movement_type) = ?', [RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED])
            ->sum('amount'), 2);
        $unreturnedFundBalance = round($officeCashBalanceBeforeReturns - $cashReturnsToDate, 2);
        if ($unreturnedFundBalance < 0) {
            throw new ConflictHttpException('Recorded cash returns exceed the authoritative Tourism Office cash-fund balance; review the movement ledger.');
        }
        $reconciliation = RiderDailyReconciliation::query()
            ->where('rider_id', $rider->id)
            ->whereDate('working_date', $date)
            ->with([
                'events.actor:id,name',
                'corrections.creator:id,name',
                'corrections.reviewer:id,name',
                'corrections.closer:id,name',
                'corrections.movements:id,correction_cycle_id',
                'corrections.linkedMovements:id',
            ])
            ->orderByDesc('revision')
            ->first();
        $latestCorrection = $reconciliation?->corrections->sortByDesc('cycle_number')->first();
        $correctedResultStatus = match ($latestCorrection?->status) {
            'pending_review' => 'correction_pending_review',
            'reviewed' => 'correction_reviewed_pending_close',
            'rejected' => 'correction_review_rejected',
            'closed' => 'corrected_closed',
            default => $reconciliation?->status,
        };
        $financialMovements = RiderDailyCashMovement::query()
            ->where('rider_id', $rider->id)
            ->whereDate('business_date', '<=', $date)
            ->with(['recorder:id,name', 'correctionCycles:id'])
            ->orderBy('transaction_at')
            ->orderBy('id')
            ->get()
            ->map(fn (RiderDailyCashMovement $movement) => [
                'id' => $movement->id,
                'business_date' => $movement->business_date->toDateString(),
                'movement_type' => $movement->movement_type,
                'affects_type' => $movement->affects_type,
                'amount' => (float) $movement->amount,
                'transaction_at' => $movement->transaction_at,
                'recorded_by' => $movement->recorder?->only(['id', 'name']),
                'reconciliation_id' => $movement->rider_daily_reconciliation_id,
                'revision' => $movement->revision,
                'reference' => $movement->reference,
                'reference_type' => $movement->reference_type,
                'reference_namespace' => $movement->reference_namespace,
                'reference_source' => $movement->reference_source,
                'reference_issuer' => $movement->reference_issuer,
                'reference_series' => $movement->reference_series,
                'evidence_details' => $movement->evidence_details,
                'reverses_movement_id' => $movement->reverses_movement_id,
                'adjusts_movement_id' => $movement->adjusts_movement_id,
                'correction_cycle_id' => $movement->correction_cycle_id,
                'correction_cycle_ids' => $movement->correctionCycles->pluck('id')->values(),
            ])->values();
        $recordedCodMovements = $financialMovements->filter(fn (array $movement) => $movement['business_date'] === $date
            && ($movement['affects_type'] ?? $movement['movement_type']) === RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED
        );
        $recordedCashReturnMovements = $financialMovements->filter(fn (array $movement) => $movement['business_date'] === $date
            && ($movement['affects_type'] ?? $movement['movement_type']) === RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED
        );
        $reconciliationPayload = $reconciliation ? [
            'id' => $reconciliation->id,
            'revision' => $reconciliation->revision,
            'status' => $reconciliation->status,
            'expected_cod_remittance' => (float) $reconciliation->expected_cod_remittance,
            'expected_office_cash_return' => (float) $reconciliation->expected_office_cash_return,
            'expected_rider_payable' => (float) $reconciliation->expected_rider_payable,
            'submitted_cod_remittance' => (float) $reconciliation->submitted_cod_remittance,
            'submitted_office_cash_return' => (float) $reconciliation->submitted_office_cash_return,
            'remittance_reference' => $reconciliation->remittance_reference,
            'rider_note' => $reconciliation->rider_note,
            'submitted_at' => $reconciliation->submitted_at,
            'verified_cod_received' => $reconciliation->verified_cod_received !== null ? (float) $reconciliation->verified_cod_received : null,
            'verified_office_cash_return' => $reconciliation->verified_office_cash_return !== null ? (float) $reconciliation->verified_office_cash_return : null,
            'verified_rider_reimbursement' => $reconciliation->verified_rider_reimbursement !== null ? (float) $reconciliation->verified_rider_reimbursement : null,
            'rider_reimbursement_outstanding' => $reconciliation->verified_rider_reimbursement !== null
                ? max(0, round((float) $reconciliation->expected_rider_payable - (float) $reconciliation->verified_rider_reimbursement, 2))
                : (float) $reconciliation->expected_rider_payable,
            'verification_note' => $reconciliation->verification_note,
            'verified_by' => $reconciliation->verifier?->only(['id', 'name']),
            'verified_at' => $reconciliation->verified_at,
            'closed_by' => $reconciliation->closer?->only(['id', 'name']),
            'closed_at' => $reconciliation->closed_at,
            'corrected_result_status' => $correctedResultStatus,
            'is_finally_reconciled' => $reconciliation->status === RiderDailyReconciliation::STATUS_CLOSED
                && ($latestCorrection === null || $latestCorrection->status === 'closed'),
            'corrections' => $reconciliation->corrections->sortBy('cycle_number')->values()->map(fn ($correction) => [
                'id' => $correction->id,
                'cycle_number' => $correction->cycle_number,
                'status' => $correction->status,
                'balance_snapshot' => $correction->balance_snapshot,
                'created_by' => $correction->creator?->only(['id', 'name']),
                'created_at' => $correction->created_at,
                'review_decision' => $correction->review_decision,
                'review_note' => $correction->review_note,
                'reviewed_by' => $correction->reviewer?->only(['id', 'name']),
                'reviewed_at' => $correction->reviewed_at,
                'closed_by' => $correction->closer?->only(['id', 'name']),
                'closed_at' => $correction->closed_at,
                'movement_ids' => $correction->movements->pluck('id')
                    ->merge($correction->linkedMovements->pluck('id'))
                    ->unique()
                    ->values(),
            ]),
            'discrepancies' => [
                'cod_remittance_vs_expected' => round((float) $reconciliation->submitted_cod_remittance - (float) $reconciliation->expected_cod_remittance, 2),
                'cash_return_vs_expected' => round((float) $reconciliation->submitted_office_cash_return - (float) $reconciliation->expected_office_cash_return, 2),
                'office_cod_received_vs_rider_submission' => $reconciliation->verified_cod_received !== null
                    ? round((float) $reconciliation->verified_cod_received - (float) $reconciliation->submitted_cod_remittance, 2)
                    : null,
                'office_cash_return_vs_rider_submission' => $reconciliation->verified_office_cash_return !== null
                    ? round((float) $reconciliation->verified_office_cash_return - (float) $reconciliation->submitted_office_cash_return, 2)
                    : null,
            ],
            'events' => $reconciliation->events->map(fn (RiderDailyReconciliationEvent $event) => [
                'action' => $event->action,
                'from_status' => $event->from_status,
                'to_status' => $event->to_status,
                'details' => $event->details,
                'actor' => $event->actor?->only(['id', 'name']),
                'created_at' => $event->created_at,
            ])->values(),
        ] : null;

        return [
            'receipt_status' => $reconciliation?->status ?? ($isLegacyPolicyDate ? 'legacy_policy_preview' : 'calculated_preview'),
            'policy_status' => $reconciliationPolicy['status'],
            'reconciliation_policy' => $reconciliationPolicy,
            'working_date' => $date,
            'timezone' => 'Asia/Manila',
            'rider' => [
                'id' => $rider->id,
                'name' => $rider->name,
            ],
            'deliveries' => $receiptDeliveries,
            'excluded_deliveries' => $excludedDeliveries,
            'totals' => [
                'eligible_delivery_count' => count($receiptDeliveries),
                'cash_collected' => $grossCollected,
                'cash_tendered' => round($cashTendered, 2),
                'change_given' => round($changeGiven, 2),
                'rider_delivery_fee_entitlement' => round($deliveryFeeEntitlement, 2),
                'rider_tip_entitlement' => round($tipEntitlement, 2),
                'verified_personal_purchase_reimbursement' => round($personalContribution, 2),
                'net_cod_remittance_expected' => $netRemittance === null ? null : round($netRemittance, 2),
                'additional_rider_payable' => $riderPayable === null ? null : round($riderPayable, 2),
                'cod_settlement_base' => round($settlementBase, 2),
                'restaurant_share' => round($restaurantShare, 2),
                'tourism_office_share' => round($tourismOfficeShare, 2),
                'tourism_office_cash_issued_to_date' => round($totalOfficeCashIssued, 2),
                'tourism_office_cash_used_to_date' => round($totalOfficeCashUsed, 2),
                'tourism_office_cash_issued_less_verified_spending' => $officeCashBalanceBeforeReturns,
                'tourism_office_cash_returned_to_date' => round($cashReturnsToDate, 2),
                'unreturned_tourism_office_cash_balance' => $unreturnedFundBalance,
            ],
            'reconciliation' => $reconciliationPayload,
            'financial_movements' => $financialMovements,
            'cash_received_by_tourism_office' => $recordedCodMovements->isNotEmpty()
                ? round((float) $recordedCodMovements->sum('amount'), 2)
                : null,
            'cash_returned_to_tourism_office' => $recordedCashReturnMovements->isNotEmpty()
                ? round((float) $recordedCashReturnMovements->sum('amount'), 2)
                : null,
            'remittance_submitted' => $reconciliation !== null,
            'cash_return_recorded' => $recordedCashReturnMovements->isNotEmpty(),
            'fund_balance_is_carried_forward' => true,
            'cash_movement_reference_namespaces' => $this->cashMovementReferenceNamespaces(),
        ];
    }

    public function recordDeliveryIssuance(Delivery $delivery, User $officer, float $amount): RiderCashFund
    {
        $rider = User::query()->lockForUpdate()->findOrFail($delivery->rider_id);
        $this->assertMunicipalityAccess($officer, $rider);

        $fund = RiderCashFund::query()
            ->where('active_rider_key', $rider->id)
            ->lockForUpdate()
            ->first();

        if (! $fund) {
            $fund = RiderCashFund::create([
                'fund_number' => 'RCF-'.now('Asia/Manila')->format('Ymd').'-'.Str::upper(Str::random(8)),
                'rider_id' => $rider->id,
                'municipality_id' => $rider->municipality_id,
                'status' => RiderCashFund::STATUS_OPEN,
                'active_rider_key' => $rider->id,
                'opened_by' => $officer->id,
                'opened_at' => now(),
            ]);
        }

        RiderCashFundTransaction::create([
            'rider_cash_fund_id' => $fund->id,
            'reference_number' => 'RCFT-ISSUE-'.$delivery->id,
            'type' => RiderCashFundTransaction::TYPE_CASH_ISSUED,
            'amount' => round($amount, 2),
            'occurred_at' => now(),
            'delivery_id' => $delivery->id,
            'recorded_by' => $officer->id,
        ]);

        return $fund;
    }

    public function issueAdditionalCash(
        Delivery $delivery,
        User $officer,
        float $amount,
        string $idempotencyKey
    ): RiderCashFundTransaction {
        if ($amount <= 0) {
            throw new InvalidArgumentException('Additional purchasing cash must be greater than zero.');
        }

        return DB::transaction(function () use ($delivery, $officer, $amount, $idempotencyKey) {
            $lockedDelivery = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
            $rider = User::query()->lockForUpdate()->findOrFail($lockedDelivery->rider_id);
            $this->assertMunicipalityAccess($officer, $rider);

            $existing = RiderCashFundTransaction::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existing) {
                if ((int) $existing->delivery_id !== (int) $lockedDelivery->id
                    || $existing->type !== RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED
                    || round((float) $existing->amount, 2) !== round($amount, 2)) {
                    throw new ConflictHttpException('This idempotency key was already used for a different cash issuance.');
                }

                return $existing;
            }

            if (! $lockedDelivery->rider_cash_fund_id || $lockedDelivery->purchasing_cash_issued_at === null) {
                throw new InvalidArgumentException('Initial purchasing cash must be issued before an additional amount.');
            }

            $fund = RiderCashFund::query()
                ->whereKey($lockedDelivery->rider_cash_fund_id)
                ->lockForUpdate()
                ->firstOrFail();
            $this->assertFundMunicipalityAccess($officer, $fund);
            if ($fund->status !== RiderCashFund::STATUS_OPEN) {
                throw new InvalidArgumentException('The rider cash fund is already closed.');
            }

            $status = $lockedDelivery->status->value ?? $lockedDelivery->status;
            if (! in_array($status, PurchasingCashService::ISSUABLE_STATUSES, true)) {
                throw new InvalidArgumentException('Additional purchasing cash can only be issued during the pickup stage.');
            }

            $transaction = RiderCashFundTransaction::create([
                'rider_cash_fund_id' => $fund->id,
                'reference_number' => 'RCFT-ADD-'.Str::upper(Str::random(12)),
                'idempotency_key' => $idempotencyKey,
                'type' => RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED,
                'amount' => round($amount, 2),
                'occurred_at' => now(),
                'delivery_id' => $lockedDelivery->id,
                'recorded_by' => $officer->id,
            ]);

            $lockedDelivery->update([
                'purchasing_cash' => round((float) $lockedDelivery->purchasing_cash + $amount, 2),
            ]);

            ActivityLog::record(
                'purchasing_cash.additional_issued',
                sprintf(
                    'Issued additional purchasing cash ₱%s to rider #%s for delivery #%s.',
                    number_format($amount, 2),
                    (string) $rider->id,
                    (string) $lockedDelivery->id
                ),
                $lockedDelivery,
                ActivityLog::TYPE_FINANCIAL
            );

            return $transaction;
        });
    }

    public function confirmCashReceipt(Delivery $delivery, User $rider): void
    {
        DB::transaction(function () use ($delivery, $rider) {
            $lockedDelivery = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
            if ((int) $lockedDelivery->rider_id !== (int) $rider->id) {
                throw new AuthorizationException('You are not assigned to this delivery.');
            }

            if (! $lockedDelivery->rider_cash_fund_id || $lockedDelivery->purchasing_cash_issued_at === null) {
                throw new InvalidArgumentException('Purchasing cash has not been issued yet.');
            }

            $status = $lockedDelivery->status->value ?? $lockedDelivery->status;
            if (! in_array($status, PurchasingCashService::ISSUABLE_STATUSES, true)) {
                throw new InvalidArgumentException('Purchasing cash receipt can only be confirmed at the pickup stage.');
            }

            $unreceived = RiderCashFundTransaction::query()
                ->where('rider_cash_fund_id', $lockedDelivery->rider_cash_fund_id)
                ->where('delivery_id', $lockedDelivery->id)
                ->whereIn('type', [
                    RiderCashFundTransaction::TYPE_CASH_ISSUED,
                    RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED,
                ])
                ->whereNull('received_at')
                ->lockForUpdate()
                ->get();

            if ($unreceived->isEmpty()) {
                if ($lockedDelivery->purchasing_cash_received_at !== null) {
                    return;
                }

                throw new InvalidArgumentException('There is no outstanding purchasing-cash issuance to acknowledge.');
            }

            foreach ($unreceived as $transaction) {
                $transaction->update([
                    'received_by' => $rider->id,
                    'received_at' => now(),
                ]);
            }

            $lockedDelivery->update([
                'purchasing_cash_received_at' => $lockedDelivery->purchasing_cash_received_at ?? now(),
            ]);

            ActivityLog::record(
                'purchasing_cash.received',
                sprintf('Rider #%s confirmed receipt of purchasing cash for delivery #%s.', $rider->id, $lockedDelivery->id),
                $lockedDelivery,
                ActivityLog::TYPE_FINANCIAL
            );
        });
    }

    public function submitPurchaseExpense(
        Delivery $delivery,
        CodPurchase $purchase,
        User $rider,
        float $actualAmount,
        float $officeCashUsed,
        float $personalContribution,
        UploadedFile $receipt
    ): CodPurchaseExpense {
        if (round($officeCashUsed + $personalContribution, 2) !== round($actualAmount, 2)) {
            throw new InvalidArgumentException('Tourism Office cash and personal contribution must equal the actual purchase amount.');
        }
        if ($actualAmount <= 0 || $officeCashUsed < 0 || $personalContribution < 0) {
            throw new InvalidArgumentException('Purchase amounts must be valid non-negative amounts and the actual total must be positive.');
        }

        return DB::transaction(function () use (
            $delivery,
            $purchase,
            $rider,
            $actualAmount,
            $officeCashUsed,
            $personalContribution,
            $receipt
        ) {
            $lockedDelivery = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
            if ((int) $lockedDelivery->rider_id !== (int) $rider->id) {
                throw new AuthorizationException('You are not assigned to this delivery.');
            }

            $lockedPurchase = CodPurchase::query()
                ->where('delivery_id', $lockedDelivery->id)
                ->whereKey($purchase->id)
                ->lockForUpdate()
                ->firstOrFail();

            if (! $lockedDelivery->rider_cash_fund_id || $lockedDelivery->purchasing_cash_received_at === null) {
                throw new InvalidArgumentException('Confirm receipt of the Tourism Office cash before submitting a purchase.');
            }
            if ($this->hasUnreceivedIssuance($lockedDelivery)) {
                throw new InvalidArgumentException('Confirm receipt of all purchasing-cash issuances before submitting a purchase.');
            }
            if (! in_array($lockedPurchase->status, [CodPurchase::STATUS_PURCHASED, CodPurchase::STATUS_COLLECTED], true)) {
                throw new InvalidArgumentException('Only a purchased restaurant stop can be submitted for expense verification.');
            }

            $activeExpense = $lockedPurchase->expenses()
                ->whereIn('status', [CodPurchaseExpense::STATUS_SUBMITTED, CodPurchaseExpense::STATUS_VERIFIED])
                ->lockForUpdate()
                ->first();
            if ($activeExpense) {
                if ($activeExpense->status === CodPurchaseExpense::STATUS_SUBMITTED
                    && round((float) $activeExpense->actual_purchase_amount, 2) === round($actualAmount, 2)
                    && round((float) $activeExpense->tourism_office_cash_used, 2) === round($officeCashUsed, 2)
                    && round((float) $activeExpense->rider_personal_contribution, 2) === round($personalContribution, 2)) {
                    return $activeExpense;
                }

                throw new ConflictHttpException('This purchase already has a submitted or verified expense record.');
            }

            $revision = ((int) $lockedPurchase->expenses()->max('revision')) + 1;
            $receiptPath = $receipt->store('cod-purchase-receipts', 'local');
            if (! is_string($receiptPath) || $receiptPath === '') {
                throw new \RuntimeException('The purchase receipt could not be stored.');
            }

            try {
                $expense = $lockedPurchase->expenses()->create([
                    'revision' => $revision,
                    'actual_purchase_amount' => round($actualAmount, 2),
                    'tourism_office_cash_used' => round($officeCashUsed, 2),
                    'rider_personal_contribution' => round($personalContribution, 2),
                    'receipt_path' => $receiptPath,
                    'status' => CodPurchaseExpense::STATUS_SUBMITTED,
                    'submitted_by' => $rider->id,
                    'submitted_at' => now(),
                ]);

                ActivityLog::record(
                    'cod_purchase.expense_submitted',
                    sprintf('Rider #%s submitted purchase expense #%s for verification.', $rider->id, $expense->id),
                    $expense,
                    ActivityLog::TYPE_FINANCIAL
                );

                return $expense;
            } catch (Throwable $exception) {
                Storage::disk('local')->delete($receiptPath);
                throw $exception;
            }
        });
    }

    public function reviewPurchaseExpense(
        Delivery $delivery,
        CodPurchase $purchase,
        CodPurchaseExpense $expense,
        User $officer,
        bool $approve,
        ?string $reason = null
    ): CodPurchaseExpense {
        if (! $approve && trim((string) $reason) === '') {
            throw new InvalidArgumentException('A reason is required when rejecting a purchase expense.');
        }

        return DB::transaction(function () use ($delivery, $purchase, $expense, $officer, $approve, $reason) {
            $lockedDelivery = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
            User::query()->lockForUpdate()->findOrFail($lockedDelivery->rider_id);

            $lockedPurchase = CodPurchase::query()
                ->where('delivery_id', $lockedDelivery->id)
                ->whereKey($purchase->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedExpense = CodPurchaseExpense::query()
                ->where('cod_purchase_id', $lockedPurchase->id)
                ->whereKey($expense->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($lockedExpense->status !== CodPurchaseExpense::STATUS_SUBMITTED) {
                throw new ConflictHttpException('Only a submitted purchase expense can be reviewed.');
            }

            if (! $lockedDelivery->rider_cash_fund_id) {
                throw new InvalidArgumentException('The delivery is not linked to an open rider cash fund.');
            }

            $fund = RiderCashFund::query()
                ->whereKey($lockedDelivery->rider_cash_fund_id)
                ->lockForUpdate()
                ->firstOrFail();
            $this->assertFundMunicipalityAccess($officer, $fund);

            if (! $approve) {
                $lockedExpense->update([
                    'status' => CodPurchaseExpense::STATUS_REJECTED,
                    'verified_by' => $officer->id,
                    'verified_at' => now(),
                    'rejection_reason' => trim((string) $reason),
                ]);

                ActivityLog::record(
                    'cod_purchase.expense_rejected',
                    sprintf('Tourism Office rejected purchase expense #%s: %s', $lockedExpense->id, trim((string) $reason)),
                    $lockedExpense,
                    ActivityLog::TYPE_FINANCIAL
                );

                return $lockedExpense;
            }

            if ($fund->status !== RiderCashFund::STATUS_OPEN) {
                throw new InvalidArgumentException('The rider cash fund is closed.');
            }

            $issued = (float) $fund->transactions()
                ->whereIn('type', [
                    RiderCashFundTransaction::TYPE_CASH_ISSUED,
                    RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED,
                ])
                ->sum('amount');
            $spent = (float) $fund->transactions()
                ->where('type', RiderCashFundTransaction::TYPE_PURCHASE_OFFICE_CASH_USED)
                ->sum('amount');
            $officeCashUsed = round((float) $lockedExpense->tourism_office_cash_used, 2);

            if (round($spent + $officeCashUsed, 2) > round($issued, 2)) {
                throw new InvalidArgumentException('Verified Tourism Office-funded purchases cannot exceed cash issued to the rider.');
            }

            $lockedExpense->update([
                'status' => CodPurchaseExpense::STATUS_VERIFIED,
                'verified_by' => $officer->id,
                'verified_at' => now(),
                'rejection_reason' => null,
            ]);

            $common = [
                'rider_cash_fund_id' => $fund->id,
                'delivery_id' => $lockedDelivery->id,
                'cod_purchase_id' => $lockedPurchase->id,
                'cod_purchase_expense_id' => $lockedExpense->id,
                'recorded_by' => $officer->id,
            ];

            if ($officeCashUsed > 0) {
                RiderCashFundTransaction::create(array_merge($common, [
                    'reference_number' => 'RCFT-PURCHASE-OFFICE-'.$lockedExpense->id,
                    'type' => RiderCashFundTransaction::TYPE_PURCHASE_OFFICE_CASH_USED,
                    'amount' => $officeCashUsed,
                    'occurred_at' => $lockedPurchase->purchased_at ?? now(),
                ]));
            }

            $personalContribution = round((float) $lockedExpense->rider_personal_contribution, 2);
            if ($personalContribution > 0) {
                RiderCashFundTransaction::create(array_merge($common, [
                    'reference_number' => 'RCFT-PURCHASE-RIDER-'.$lockedExpense->id,
                    'type' => RiderCashFundTransaction::TYPE_RIDER_PERSONAL_CONTRIBUTION,
                    'amount' => $personalContribution,
                    'occurred_at' => $lockedPurchase->purchased_at ?? now(),
                ]));
            }

            ActivityLog::record(
                'cod_purchase.expense_verified',
                sprintf('Tourism Office verified purchase expense #%s.', $lockedExpense->id),
                $lockedExpense,
                ActivityLog::TYPE_FINANCIAL
            );

            return $lockedExpense;
        });
    }

    public function dailyLedger(User $officer, User $rider, string $date): array
    {
        $municipalityId = $this->officerMunicipalityId($officer);
        if ($rider->role !== User::ROLE_RIDER) {
            throw new AuthorizationException('Cash-fund ledgers are available only for riders.');
        }

        $hasHistoricalFundsInScope = RiderCashFund::query()
            ->where('rider_id', $rider->id)
            ->where('municipality_id', $municipalityId)
            ->exists();
        if ((int) $rider->municipality_id !== (int) $municipalityId && ! $hasHistoricalFundsInScope) {
            throw new AuthorizationException("The rider is outside this Tourism Office account's municipality.");
        }

        $receipt = $this->buildDailyReceipt($rider, $date);
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $date, 'Asia/Manila')->startOfDay();
        $end = $start->addDay();

        $transactions = RiderCashFundTransaction::query()
            ->with(['fund', 'delivery', 'purchase', 'expense'])
            ->whereHas('fund', fn ($query) => $query
                ->where('rider_id', $rider->id)
                ->where('municipality_id', $municipalityId))
            ->where(function ($query) use ($start, $end) {
                $query->where(function ($occurred) use ($start, $end) {
                    $occurred->where('occurred_at', '>=', $start->utc())
                        ->where('occurred_at', '<', $end->utc());
                })->orWhere(function ($received) use ($start, $end) {
                    $received->where('received_at', '>=', $start->utc())
                        ->where('received_at', '<', $end->utc());
                });
            })
            ->orderBy('created_at')
            ->get();
        $moneyTransactions = $transactions->filter(fn (RiderCashFundTransaction $transaction) => $transaction->occurred_at >= $start->utc() && $transaction->occurred_at < $end->utc()
        );

        return [
            'rider_id' => $rider->id,
            'rider_name' => $rider->name,
            'working_date' => $date,
            'timezone' => 'Asia/Manila',
            'transactions' => $transactions,
            'cash_movements' => collect($receipt['financial_movements'])
                ->where('business_date', $date)
                ->values(),
            'totals' => [
                'cash_issued' => round((float) $moneyTransactions
                    ->whereIn('type', [
                        RiderCashFundTransaction::TYPE_CASH_ISSUED,
                        RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED,
                    ])->sum('amount'), 2),
                'tourism_office_cash_used' => round((float) $moneyTransactions
                    ->where('type', RiderCashFundTransaction::TYPE_PURCHASE_OFFICE_CASH_USED)->sum('amount'), 2),
                'rider_personal_contribution' => round((float) $moneyTransactions
                    ->where('type', RiderCashFundTransaction::TYPE_RIDER_PERSONAL_CONTRIBUTION)->sum('amount'), 2),
                'cash_fund_returned_today' => round((float) ($receipt['cash_returned_to_tourism_office'] ?? 0), 2),
                'cash_fund_returned_to_date' => $receipt['totals']['tourism_office_cash_returned_to_date'],
                'unreturned_cash_fund_balance' => $receipt['totals']['unreturned_tourism_office_cash_balance'],
            ],
        ];
    }

    public function assertMunicipalityAccess(User $officer, User $rider): void
    {
        if ($rider->role !== User::ROLE_RIDER) {
            throw new AuthorizationException('This Tourism Office account is not authorized for the rider.');
        }

        $officeMunicipalityId = $this->officerMunicipalityId($officer);

        if ($officeMunicipalityId === null || $rider->municipality_id === null
            || (int) $officeMunicipalityId !== (int) $rider->municipality_id) {
            throw new AuthorizationException("The rider is outside this Tourism Office account's municipality.");
        }
    }

    public function assertFundMunicipalityAccess(User $officer, RiderCashFund $fund): void
    {
        if ((int) $this->officerMunicipalityId($officer) !== (int) $fund->municipality_id) {
            throw new AuthorizationException("The rider cash fund is outside this Tourism Office account's municipality.");
        }
    }

    private function cashMovementReferenceNamespaces(): array
    {
        $namespaces = config('cod_cash.cash_movement_reference_namespaces', []);
        if (! is_array($namespaces)) {
            return [];
        }

        $available = [];
        foreach ($namespaces as $key => $definition) {
            if (! is_string($key) || ! is_array($definition)
                || ! in_array($definition['type'] ?? null, ['office_receipt', 'provider_transaction', 'manual_evidence'], true)) {
                continue;
            }

            $available[] = [
                'key' => $key,
                'type' => $definition['type'],
                'label' => (string) ($definition['label'] ?? $key),
            ];
        }

        return $available;
    }

    private function officerMunicipalityId(User $officer): ?int
    {
        if ($officer->role !== User::ROLE_BANSUD_TOURISM_OFFICE) {
            throw new AuthorizationException('This account is not authorized to manage Tourism Office cash funds.');
        }

        $municipalityId = $officer->municipality_id;
        if ($municipalityId === null) {
            $municipalityId = Municipality::query()
                ->whereRaw('LOWER(name) = ?', ['bansud'])
                ->value('id');
        }

        return $municipalityId !== null ? (int) $municipalityId : null;
    }

    private function hasUnreceivedIssuance(Delivery $delivery): bool
    {
        return RiderCashFundTransaction::query()
            ->where('rider_cash_fund_id', $delivery->rider_cash_fund_id)
            ->where('delivery_id', $delivery->id)
            ->whereIn('type', [
                RiderCashFundTransaction::TYPE_CASH_ISSUED,
                RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED,
            ])
            ->whereNull('received_at')
            ->exists();
    }
}
