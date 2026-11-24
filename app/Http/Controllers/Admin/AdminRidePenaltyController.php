<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\RidePenaltyException;
use App\Http\Controllers\Controller;
use App\Models\RideCancellationPenalty;
use App\Models\RiderCancellationCompensation;
use App\Models\User;
use App\Services\PenaltyCashReceiptService;
use App\Services\RideCancellationPenaltyService;
use App\Services\RideCompensationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Stage C2 (2026-11-18): the Bansud Tourism Office sees ride cancellation
 * penalties and can waive one, with a reason (ledger + activity log).
 */
class AdminRidePenaltyController extends Controller
{
    private const STATUSES = [
        RideCancellationPenalty::STATUS_OWED,
        RideCancellationPenalty::STATUS_UNDER_REVIEW,
        RideCancellationPenalty::STATUS_DISPUTED,
        RideCancellationPenalty::STATUS_WAIVED,
        RideCancellationPenalty::STATUS_COLLECTED,
        RideCancellationPenalty::STATUS_REFUNDED,
    ];

    /** GET /admin/ride-penalties?status=all|owed|under_review|disputed|waived|collected */
    public function index(Request $request): JsonResponse
    {
        $status = in_array($request->query('status'), self::STATUSES, true) ? $request->query('status') : null;
        $rows = RideCancellationPenalty::query()
            ->with(['cancelledOrder:id,order_number,customer_name', 'rider:id,name', 'resolver:id,name', 'collector:id,name'])
            ->when($status, fn ($q) => $q->where('status', $status))
            ->latest('id')
            ->limit(200)
            ->get();
        $counts = RideCancellationPenalty::query()->selectRaw('status, COUNT(*) as n')->groupBy('status')->pluck('n', 'status');

        return $this->successResponse([
            'penalties' => $rows->map(fn (RideCancellationPenalty $p) => $this->present($p))->values(),
            'counts' => collect(self::STATUSES)->mapWithKeys(fn ($s) => [$s => (int) ($counts[$s] ?? 0)]),
        ]);
    }

    /** POST /admin/ride-penalties/{penalty}/waive {reason} */
    public function waive(Request $request, RideCancellationPenalty $penalty, RideCancellationPenaltyService $service): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        try {
            $penalty = $service->waive($penalty, $request->user(), $data['reason']);
        } catch (RidePenaltyException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($this->present($penalty->fresh(['cancelledOrder:id,order_number,customer_name', 'rider:id,name', 'resolver:id,name'])), 'Cancellation fee waived. The tourist was notified.');
    }

    /* ── Stage D1 (§P): receipts, advances, refunds ─────────────────── */

    /** GET /admin/ride-penalties/cash-to-receive — cash fees riders collected that the office has not fully received. */
    public function cashToReceive(): JsonResponse
    {
        $rows = RideCancellationPenalty::with(['cancelledOrder:id,order_number', 'collector:id,name'])
            ->where('status', RideCancellationPenalty::STATUS_COLLECTED)
            ->where('collection_method', 'cash')
            ->whereNull('received_at')
            ->orderBy('collected_at')
            ->get();

        return $this->successResponse([
            'riders' => $rows->groupBy('collected_by')->map(fn ($group, $riderId) => [
                'rider_id' => (int) $riderId,
                'rider_name' => $group->first()->collector?->name,
                'outstanding' => round($group->sum(fn ($p) => (float) $p->penalty_amount - (float) $p->received_amount), 2),
                'penalties' => $group->map(fn ($p) => [
                    'id' => $p->id,
                    'order_number' => $p->cancelledOrder?->order_number,
                    'amount' => (float) $p->penalty_amount,
                    'received_amount' => (float) $p->received_amount,
                    'remaining' => round((float) $p->penalty_amount - (float) $p->received_amount, 2),
                    'collected_at' => $p->collected_at?->toIso8601String(),
                ])->values(),
            ])->values(),
        ]);
    }

    /** POST /admin/ride-penalties/cash-receipts — one numbered receipt per rider remittance, one line per fee. */
    public function recordCashReceipt(Request $request, PenaltyCashReceiptService $receipts): JsonResponse
    {
        $data = $request->validate([
            'collecting_rider_id' => ['required', 'integer', 'exists:users,id'],
            'receipt_number' => ['required', 'string', 'max:60'],
            'received_amount' => ['required', 'numeric', 'min:0.01'],
            'allocations' => ['required', 'array', 'min:1'],
            'allocations.*.penalty_id' => ['required', 'integer'],
            'allocations.*.amount' => ['required', 'numeric', 'min:0.01'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        try {
            $receipt = $receipts->record($request->user(), (int) $data['collecting_rider_id'], $data['receipt_number'], (float) $data['received_amount'], $data['allocations'], $data['note'] ?? null);
        } catch (RidePenaltyException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse([
            'receipt_number' => $receipt->receipt_number,
            'received_amount' => (float) $receipt->received_amount,
            'allocations' => $receipt->allocations->map(fn ($a) => ['penalty_id' => $a->penalty_id, 'amount' => (float) $a->amount])->values(),
        ], 'Receipt recorded.', 201);
    }

    /** POST /admin/ride-penalties/{penalty}/advance {reason, reference} — exceptional. */
    public function advance(Request $request, RideCancellationPenalty $penalty, RideCompensationService $compensations): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500'], 'reference' => ['required', 'string', 'max:120']]);
        try {
            $comp = $compensations->advance($penalty, $request->user(), $data['reason'], $data['reference']);
        } catch (RidePenaltyException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($comp->present(), $comp->status === RiderCancellationCompensation::STATUS_PENDING_APPROVAL
            ? 'Advance requested. Another staff member must approve it.'
            : 'Advance recorded. It is included in the rider\'s next payout.', 201);
    }

    /** POST /admin/ride-compensations/{compensation}/approve-advance — the second staff member (two-person rule). */
    public function approveAdvance(Request $request, RiderCancellationCompensation $compensation, RideCompensationService $compensations): JsonResponse
    {
        try {
            $comp = $compensations->approveAdvance($compensation, $request->user());
        } catch (RidePenaltyException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($comp->present(), 'Advance approved.');
    }

    /** POST /admin/ride-penalties/{penalty}/refund {reference, reason} — a received payment returned to the tourist. */
    public function refund(Request $request, RideCancellationPenalty $penalty, RideCancellationPenaltyService $service): JsonResponse
    {
        $data = $request->validate(['reference' => ['required', 'string', 'max:120'], 'reason' => ['required', 'string', 'min:5', 'max:500']]);
        try {
            $penalty = $service->recordRefund($penalty, $request->user(), $data['reference'], $data['reason']);
        } catch (RidePenaltyException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($this->present($penalty->fresh(['cancelledOrder:id,order_number,customer_name', 'rider:id,name', 'resolver:id,name', 'collector:id,name'])), 'Refund recorded.');
    }

    private function present(RideCancellationPenalty $p): array
    {
        return [
            'id' => $p->id,
            'cancelled_order_id' => $p->cancelled_order_id,
            'order_number' => $p->cancelledOrder?->order_number,
            'tourist_id' => $p->tourist_id,
            'tourist_name' => $p->cancelledOrder?->customer_name,
            'rider_id' => $p->compensated_rider_id,
            'rider_name' => $p->rider?->name,
            'amount' => (float) $p->penalty_amount,
            'status' => $p->status,
            'seconds_after_acceptance' => $p->seconds_after_acceptance,
            'acceptance_at' => $p->acceptance_at?->toIso8601String(),
            'cancelled_at' => $p->cancelled_at?->toIso8601String(),
            // Recorded for reference; it never decided the status (Stage C2).
            'evidence' => $p->evidence ?? [],
            'review_reasons' => $p->review_reasons ?? [],
            'dispute_reason' => $p->dispute_reason,
            'disputed_at' => $p->disputed_at?->toIso8601String(),
            'waiver_reason' => $p->status === RideCancellationPenalty::STATUS_WAIVED ? $p->resolution_note : null,
            'waived_at' => $p->status === RideCancellationPenalty::STATUS_WAIVED ? $p->resolved_at?->toIso8601String() : null,
            'waived_by' => $p->status === RideCancellationPenalty::STATUS_WAIVED ? $p->resolver?->name : null,
            'collected_at' => $p->collected_at?->toIso8601String(),
            'collection_method' => $p->collection_method,
            // Stage D1: collected by (cash), received by the office, refunded, compensation.
            'collected_by_name' => $p->collector?->name,
            'received_amount' => (float) $p->received_amount,
            'received_at' => $p->received_at?->toIso8601String(),
            'refunded_at' => $p->refunded_at?->toIso8601String(),
            'refund_reference' => $p->refund_reference,
            'compensation' => RiderCancellationCompensation::with('cancelledOrder:id,order_number')->where('penalty_id', $p->id)->first()?->present(),
            'can_waive' => ! in_array($p->status, [RideCancellationPenalty::STATUS_WAIVED, RideCancellationPenalty::STATUS_COLLECTED, RideCancellationPenalty::STATUS_REFUNDED], true),
            'can_advance' => $p->status === RideCancellationPenalty::STATUS_OWED && ! RiderCancellationCompensation::where('penalty_id', $p->id)->exists(),
            'can_refund' => $p->status === RideCancellationPenalty::STATUS_COLLECTED && $p->received_at !== null,
        ];
    }
}
