<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\CodPurchase;
use App\Models\CodPurchaseExpense;
use App\Models\Delivery;
use App\Models\RiderDailyCashMovement;
use App\Models\RiderDailyReconciliationCorrection;
use App\Models\RiderDailyReconciliation;
use App\Models\User;
use App\Services\PurchasingCashService;
use App\Services\RiderCashFundService;
use App\Services\RiderDailyReconciliationService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;

/**
 * Tourism Office purchasing-cash issuance for COD deliveries (professor model).
 *
 * After a rider accepts a COD delivery, the office supplies the physical cash
 * the rider needs to buy the food from the participating restaurants. The
 * issue amount is precomputed by PurchasingCashService to always equal
 * order.rider_financed_amount, the settlement base (AGENTS.md §5.3).
 */
class AdminPurchasingCashController extends Controller
{
    public function __construct(
        private PurchasingCashService $purchasingCash
    ) {}

    /**
     * POST /admin/deliveries/{delivery}/issue-purchasing-cash
     */
    public function issue(Delivery $delivery): JsonResponse
    {
        try {
            $issued = $this->purchasingCash->issuePurchasingCash($delivery, auth()->user());
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse($issued, 'Purchasing cash issued.');
    }

    public function issueAdditional(Request $request, Delivery $delivery): JsonResponse
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:9999999999.99'],
            'idempotency_key' => ['required', 'uuid'],
        ]);

        try {
            $transaction = $this->purchasingCash->issueAdditionalPurchasingCash(
                $delivery,
                auth()->user(),
                (float) $validated['amount'],
                $validated['idempotency_key']
            );
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse([
            'reference_number' => $transaction->reference_number,
            'amount' => (float) $transaction->amount,
            'delivery_id' => $transaction->delivery_id,
            'rider_cash_fund_id' => $transaction->rider_cash_fund_id,
        ], 'Additional purchasing cash issued.');
    }

    public function riderLedger(Request $request, User $rider): JsonResponse
    {
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.now('Asia/Manila')->toDateString()],
        ]);

        try {
            $ledger = app(RiderCashFundService::class)->dailyLedger(
                auth()->user(),
                $rider,
                $validated['date'] ?? now('Asia/Manila')->toDateString()
            );
        } catch (AuthorizationException $e) {
            return $this->forbiddenResponse($e->getMessage());
        }

        return $this->successResponse($ledger);
    }

    public function riderDailyReceipt(Request $request, User $rider): JsonResponse
    {
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d'],
        ]);

        try {
            $receipt = app(RiderCashFundService::class)->adminDailyReceipt(
                auth()->user(),
                $rider,
                $validated['date'] ?? now('Asia/Manila')->toDateString()
            );
        } catch (AuthorizationException $e) {
            return $this->forbiddenResponse($e->getMessage());
        }

        return $this->successResponse($receipt);
    }

    public function recordCashFundReturn(
        Request $request,
        User $rider,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:9999999999.99'],
            'transaction_at' => ['required', 'date'],
            'reference' => ['required', 'string', 'max:100'],
            'reference_namespace' => ['required', 'string', 'max:100'],
            'evidence_details' => ['nullable', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);

        $movement = $reconciliations->recordCashFundReturn(
            auth()->user(),
            $rider,
            (float) $validated['amount'],
            $validated['transaction_at'],
            $validated['reference'],
            $validated['reference_namespace'],
            $validated['evidence_details'] ?? null,
            $validated['idempotency_key']
        );

        return $this->successResponse($movement, 'Tourism Office cash-fund return recorded.');
    }

    public function reverseCashFundReturn(
        Request $request,
        User $rider,
        RiderDailyCashMovement $movement,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $movement->rider_id !== (int) $rider->id
            || $movement->rider_daily_reconciliation_id !== null
            || $movement->movement_type !== RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED) {
            return $this->notFoundResponse('Standalone cash-fund return not found.');
        }

        $validated = $request->validate([
            'reference' => ['required', 'string', 'max:100'],
            'reference_namespace' => ['required', 'string', 'max:100'],
            'evidence_details' => ['required', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);
        $reversal = $reconciliations->reverseCashFundReturn(
            auth()->user(),
            $movement,
            $validated['reference'],
            $validated['reference_namespace'],
            $validated['evidence_details'],
            $validated['idempotency_key']
        );

        return $this->successResponse($reversal, 'Cash-fund return reversed with an audited ledger entry.');
    }

    public function verifyDailyCashReconciliation(
        Request $request,
        User $rider,
        RiderDailyReconciliation $reconciliation,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $reconciliation->rider_id !== (int) $rider->id) {
            return $this->notFoundResponse('Daily cash reconciliation not found for this rider.');
        }

        $validated = $request->validate([
            'cash_received' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'office_cash_returned' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'rider_reimbursement_paid' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999999.99'],
            'note' => ['nullable', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);

        $verified = $reconciliations->verify(
            auth()->user(),
            $reconciliation,
            (float) $validated['cash_received'],
            (float) $validated['office_cash_returned'],
            (float) $validated['rider_reimbursement_paid'],
            $validated['note'] ?? null,
            $validated['idempotency_key']
        );

        return $this->successResponse($verified, 'Daily cash reconciliation reviewed.');
    }

    public function recordDailyCashMovement(
        Request $request,
        User $rider,
        RiderDailyReconciliation $reconciliation,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $reconciliation->rider_id !== (int) $rider->id) {
            return $this->notFoundResponse('Daily cash reconciliation not found for this rider.');
        }

        $validated = $request->validate([
            'movement_type' => ['required', 'string', 'in:cod_remittance_received,office_cash_returned,rider_reimbursement_paid'],
            'amount' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:9999999999.99'],
            'reference' => ['required', 'string', 'max:100'],
            'reference_namespace' => ['required', 'string', 'max:100'],
            'evidence_details' => ['nullable', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);
        $movement = $reconciliations->recordMovement(
            auth()->user(),
            $reconciliation,
            $validated['movement_type'],
            (float) $validated['amount'],
            $validated['reference'],
            $validated['evidence_details'] ?? null,
            $validated['reference_namespace'],
            $validated['idempotency_key']
        );

        return $this->successResponse($movement, 'Physical cash movement recorded.');
    }

    public function closeDailyCashReconciliation(
        Request $request,
        User $rider,
        RiderDailyReconciliation $reconciliation,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $reconciliation->rider_id !== (int) $rider->id) {
            return $this->notFoundResponse('Daily cash reconciliation not found for this rider.');
        }

        $validated = $request->validate([
            'idempotency_key' => ['required', 'uuid'],
        ]);
        $closed = $reconciliations->close(auth()->user(), $reconciliation, $validated['idempotency_key']);

        return $this->successResponse($closed, 'Daily cash reconciliation closed.');
    }

    public function reviewDailyCashCorrection(
        Request $request,
        User $rider,
        RiderDailyReconciliation $reconciliation,
        RiderDailyReconciliationCorrection $correction,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $reconciliation->rider_id !== (int) $rider->id
            || (int) $correction->rider_daily_reconciliation_id !== (int) $reconciliation->id) {
            return $this->notFoundResponse('Cash reconciliation correction not found.');
        }

        $validated = $request->validate([
            'decision' => ['required', 'in:approve,reject'],
            'note' => ['nullable', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);
        $reviewed = $reconciliations->reviewCorrection(
            auth()->user(),
            $correction,
            $validated['decision'],
            $validated['note'] ?? null,
            $validated['idempotency_key']
        );

        return $this->successResponse($reviewed, 'Corrected cash balances reviewed.');
    }

    public function closeDailyCashCorrection(
        Request $request,
        User $rider,
        RiderDailyReconciliation $reconciliation,
        RiderDailyReconciliationCorrection $correction,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $reconciliation->rider_id !== (int) $rider->id
            || (int) $correction->rider_daily_reconciliation_id !== (int) $reconciliation->id) {
            return $this->notFoundResponse('Cash reconciliation correction not found.');
        }

        $validated = $request->validate(['idempotency_key' => ['required', 'uuid']]);
        $closed = $reconciliations->closeCorrection(
            auth()->user(),
            $correction,
            $validated['idempotency_key']
        );

        return $this->successResponse($closed, 'Corrected cash reconciliation closure recorded.');
    }

    public function reverseDailyCashMovement(
        Request $request,
        User $rider,
        RiderDailyReconciliation $reconciliation,
        RiderDailyCashMovement $movement,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $reconciliation->rider_id !== (int) $rider->id
            || (int) $movement->rider_id !== (int) $rider->id
            || (int) $movement->rider_daily_reconciliation_id !== (int) $reconciliation->id) {
            return $this->notFoundResponse('Daily cash movement not found for this reconciliation.');
        }

        $validated = $request->validate([
            'reference' => ['required', 'string', 'max:100'],
            'reference_namespace' => ['required', 'string', 'max:100'],
            'evidence_details' => ['required', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);
        $reversal = $reconciliations->reverseMovement(
            auth()->user(),
            $movement,
            $validated['idempotency_key'],
            $validated['reference'],
            $validated['reference_namespace'],
            $validated['evidence_details']
        );

        return $this->successResponse($reversal, 'Financial movement reversed with an audited ledger entry.');
    }

    public function adjustDailyCashMovement(
        Request $request,
        User $rider,
        RiderDailyReconciliation $reconciliation,
        RiderDailyCashMovement $movement,
        RiderDailyReconciliationService $reconciliations
    ): JsonResponse {
        if ((int) $reconciliation->rider_id !== (int) $rider->id
            || (int) $movement->rider_id !== (int) $rider->id
            || (int) $movement->rider_daily_reconciliation_id !== (int) $reconciliation->id) {
            return $this->notFoundResponse('Daily cash movement not found for this reconciliation.');
        }

        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:-9999999999.99', 'max:9999999999.99'],
            'reference' => ['required', 'string', 'max:100'],
            'reference_namespace' => ['required', 'string', 'max:100'],
            'evidence_details' => ['required', 'string', 'max:2000'],
            'idempotency_key' => ['required', 'uuid'],
        ]);
        $adjustment = $reconciliations->adjustMovement(
            auth()->user(),
            $reconciliation,
            $movement,
            (float) $validated['amount'],
            $validated['reference'],
            $validated['reference_namespace'],
            $validated['evidence_details'],
            $validated['idempotency_key']
        );

        return $this->successResponse($adjustment, 'Financial adjustment recorded as an auditable ledger entry.');
    }

    public function purchaseExpenses(Delivery $delivery, CodPurchase $purchase): JsonResponse
    {
        if ((int) $purchase->delivery_id !== (int) $delivery->id) {
            return $this->notFoundResponse('Purchase stop not found for this delivery.');
        }

        $fund = $delivery->riderCashFund;
        if (! $fund) {
            return $this->notFoundResponse('No rider cash fund is associated with this delivery.');
        }

        try {
            app(RiderCashFundService::class)->assertFundMunicipalityAccess(
                auth()->user(),
                $fund
            );
        } catch (AuthorizationException $e) {
            return $this->forbiddenResponse($e->getMessage());
        }

        $expenses = $purchase->expenses()->with('submitter:id,name', 'verifier:id,name')->orderBy('revision')->get()
            ->map(fn (CodPurchaseExpense $expense) => $this->expensePayload($expense));

        return $this->successResponse($expenses);
    }

    public function reviewPurchaseExpense(
        Request $request,
        Delivery $delivery,
        CodPurchase $purchase,
        CodPurchaseExpense $expense,
        string $decision
    ): JsonResponse {
        if ((int) $purchase->delivery_id !== (int) $delivery->id
            || (int) $expense->cod_purchase_id !== (int) $purchase->id
            || ! in_array($decision, ['verify', 'reject'], true)) {
            return $this->notFoundResponse('Purchase expense not found.');
        }

        $validated = $request->validate([
            'reason' => [$decision === 'reject' ? 'required' : 'nullable', 'string', 'max:2000'],
        ]);

        try {
            $reviewed = $this->purchasingCash->reviewPurchaseExpense(
                $delivery,
                $purchase,
                $expense,
                auth()->user(),
                $decision === 'verify',
                $validated['reason'] ?? null
            );
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse($this->expensePayload($reviewed), 'Purchase expense '.$reviewed->status.'.');
    }

    public function purchaseReceipt(Delivery $delivery, CodPurchase $purchase, CodPurchaseExpense $expense)
    {
        if ((int) $purchase->delivery_id !== (int) $delivery->id
            || (int) $expense->cod_purchase_id !== (int) $purchase->id) {
            return $this->notFoundResponse('Purchase receipt not found.');
        }

        $fund = $delivery->riderCashFund;
        if (! $fund) {
            return $this->notFoundResponse('No rider cash fund is associated with this delivery.');
        }

        try {
            app(RiderCashFundService::class)->assertFundMunicipalityAccess(
                auth()->user(),
                $fund
            );
        } catch (AuthorizationException $e) {
            return $this->forbiddenResponse($e->getMessage());
        }

        $disk = Storage::disk('local');
        if (! $disk->exists($expense->receipt_path)) {
            return $this->notFoundResponse('Purchase receipt file not found.');
        }

        return response()->download($disk->path($expense->receipt_path));
    }

    private function expensePayload(CodPurchaseExpense $expense): array
    {
        return [
            'id' => $expense->id,
            'revision' => $expense->revision,
            'actual_purchase_amount' => (float) $expense->actual_purchase_amount,
            'tourism_office_cash_used' => (float) $expense->tourism_office_cash_used,
            'rider_personal_contribution' => (float) $expense->rider_personal_contribution,
            'status' => $expense->status,
            'receipt_available' => Storage::disk('local')->exists($expense->receipt_path),
            'submitted_by' => $expense->submitter?->only(['id', 'name']),
            'submitted_at' => $expense->submitted_at,
            'verified_by' => $expense->verifier?->only(['id', 'name']),
            'verified_at' => $expense->verified_at,
            'rejection_reason' => $expense->rejection_reason,
        ];
    }
}
