<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\GroupCheckout;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Refund;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Provider-authoritative refund orchestration (P11.3).
 *
 * Invariants:
 *  - A payment is only ever marked 'refunded' AFTER the provider confirms a
 *    refund succeeded. A provider failure/null response leaves the payment
 *    'paid' (retryable) and never marks the payable refunded.
 *  - A provider "pending" refund becomes 'pending_refund' so the final state
 *    is decided by the provider's webhook or reconciliation, never locally.
 *  - Idempotency: repeated refund requests and webhooks never create a second
 *    provider refund, duplicate ledger effects, or re-flip a successful refund.
 */
class PaymentRefundProcessor
{
    public function __construct(
        private readonly PaymongoService $paymongo,
    ) {}

    /**
     * Initiate a provider-backed refund for the given payment.
     *
     * Runs inside a row-locked transaction so concurrent duplicate requests
     * serialize into a single provider refund.
     *
     * @return array{success: bool, status: string, refund_id: ?string}
     */
    public function initiateRefund(
        Payment $payment,
        float $amount,
        string $reason = '',
        ?Order $forOrder = null,
        ?int $orderItemId = null,
        ?int $userId = null,
        ?float $originalAmount = null,
    ): array {
        // Product-owner rule (2026-11-11): no refund once a rider has accepted
        // the delivery — enforced here, the single layer every refund path uses.
        $policy = app(AcceptedOrderPolicy::class);
        if ($blocking = $policy->refundBlockingOrder($payment, $forOrder)) {
            $policy->escalate($blocking, 'refund_blocked_after_acceptance', 'A refund was refused because a rider had already accepted the order.', [
                'payment_id' => $payment->id,
                'amount' => round($amount, 2),
                'refund_reason' => $reason,
            ], \App\Models\ActivityLog::TYPE_FINANCIAL);

            return ['success' => false, 'status' => 'blocked_after_acceptance', 'refund_id' => null];
        }

        // Phase 1 — under the payment lock: run every check, then record the
        // refund as "requested" (with a stable idempotency key) BEFORE PayMongo
        // is called. A crash after PayMongo accepts can no longer leave an
        // untracked refund: the requested row blocks any second attempt and
        // reconciliation escalates it for review (Stage 5, step 0a).
        $phase1 = DB::transaction(function () use ($payment, $amount, $reason, $forOrder, $orderItemId, $userId, $originalAmount) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);

            if (! $locked) {
                return ['result' => ['success' => false, 'status' => 'not_found', 'refund_id' => null]];
            }

            if ($locked->status === 'refunded') {
                return ['result' => ['success' => false, 'status' => 'already_refunded', 'refund_id' => null]];
            }

            // pending_refund = another refund of this payment is with PayMongo;
            // a different partial refund may still go ahead for what remains.
            if (! in_array($locked->status, ['paid', 'authorized', 'pending_refund'], true)) {
                return ['result' => ['success' => false, 'status' => 'not_refundable', 'refund_id' => null]];
            }

            $sourceId = $locked->provider_source_id ?? $locked->provider_payment_id;
            if (! $sourceId) {
                return ['result' => ['success' => false, 'status' => 'no_provider_ref', 'refund_id' => null]];
            }

            // Never issue a second provider refund for the same intent: an
            // in-flight refund of the same item (or, order-level, another
            // order-level refund) blocks; an item already refunded stays
            // refunded. Separate partial refunds are governed by the remaining
            // balance below. Local credit-ledger rows (no provider id, not
            // "requested") never block a real provider refund.
            $sameIntent = $this->providerRefunds($locked)
                ->whereIn('status', $orderItemId ? ['requested', 'pending', 'succeeded'] : ['requested', 'pending'])
                ->when($orderItemId, fn ($q) => $q->where('order_item_id', $orderItemId), fn ($q) => $q->whereNull('order_item_id'))
                ->latest('id')
                ->first();

            if ($sameIntent) {
                return ['result' => [
                    'success' => $sameIntent->status === 'succeeded',
                    'status' => $sameIntent->status === 'succeeded' ? 'already_refunded' : 'in_flight',
                    'refund_id' => $sameIntent->provider_refund_id,
                ]];
            }

            // Legacy in-flight refunds (pre-ledger) left no row to reserve with.
            $totals = $this->refundTotals($locked);
            if ($locked->status === 'pending_refund' && $totals['in_flight'] <= 0) {
                return ['result' => ['success' => false, 'status' => 'in_flight', 'refund_id' => null]];
            }

            // Remaining refundable = paid − succeeded − in flight. Computed and
            // reserved (the requested row below) under the payment row lock, so
            // two simultaneous requests can never both claim the same balance.
            $amount = round($amount, 2);
            if ($amount <= 0) {
                return ['result' => ['success' => false, 'status' => 'not_refundable', 'refund_id' => null]];
            }
            if ($amount > $totals['remaining'] + 0.004) {
                return ['result' => [
                    'success' => false,
                    'status' => match (true) {
                        $totals['remaining'] > 0 => 'exceeds_remaining',
                        $totals['in_flight'] > 0 => 'in_flight',
                        default => 'already_refunded',
                    },
                    'refund_id' => null,
                    'remaining' => $totals['remaining'],
                ]];
            }

            $payableType = $forOrder ? Order::class : ($locked->payable_type ?: Order::class);
            $payableId = $forOrder ? $forOrder->id : $locked->payable_id;

            $intent = Refund::create([
                'payment_id' => $locked->id,
                'order_id' => $forOrder?->id ?: ($payableType === Order::class ? $payableId : null),
                'payable_type' => $payableType,
                'payable_id' => $payableId,
                'order_item_id' => $orderItemId,
                'user_id' => $userId ?? $locked->user_id,
                'amount' => round($amount, 2),
                'original_amount' => round($originalAmount ?? $amount, 2),
                'refund_deduction' => 0.0,
                'currency' => $locked->currency ?? 'PHP',
                'reason' => $reason ?: 'Refund',
                'metadata' => ['requested_at' => now()->toIso8601String()],
                'status' => 'requested',
                'idempotency_key' => (string) Str::uuid(),
                'refunded_at' => null,
            ]);

            return ['intent_id' => $intent->id, 'key' => $intent->idempotency_key, 'source_id' => $sourceId];
        });

        if (isset($phase1['result'])) {
            return $phase1['result'];
        }

        // Phase 2 — the ONE provider call for this refund, outside the lock.
        // It is never repeated: PayMongo ignores Idempotency-Key on refunds.
        $outcome = $this->paymongo->createRefundOutcome(
            $phase1['source_id'],
            (int) round($amount * 100),
            $reason,
            $phase1['key'],
        );
        $providerResponse = $outcome['outcome'] === PaymongoService::REFUND_CREATED ? $outcome['data'] : null;

        // Phase 3 — settle the same refund row under the lock.
        return DB::transaction(function () use ($payment, $reason, $forOrder, $providerResponse, $outcome, $phase1) {
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            /** @var Refund $ledger */
            $ledger = Refund::query()->lockForUpdate()->findOrFail($phase1['intent_id']);

            // A provider webhook already settled this refund (it arrived while
            // PayMongo was still answering us): its state is authoritative and
            // newer — never overwrite it here (no downgrade, no false failure).
            if ($ledger->status !== 'requested') {
                return [
                    'success' => $ledger->status === 'succeeded',
                    'status' => match ($ledger->status) {
                        'succeeded' => 'succeeded',
                        'failed' => 'provider_error',
                        default => 'pending',
                    },
                    'refund_id' => $ledger->provider_refund_id,
                ];
            }

            if ($outcome['outcome'] === PaymongoService::REFUND_UNCERTAIN) {
                // We do not know whether PayMongo created the refund. Keep it
                // "requested": the amount stays reserved and the same refund
                // can't be requested again. Reconciliation looks it up by our
                // key on the payment; a match is linked, no match stays
                // escalated. Nothing ever re-sends the create.
                $now = now()->toIso8601String();
                $ledger->update(['metadata' => array_merge($ledger->metadata ?? [], [
                    'provider_uncertain' => ['at' => $now, 'http_status' => $outcome['http_status'], 'error' => $outcome['error']],
                    'escalated_at' => $now,
                ])]);
                \App\Models\ActivityLog::record(
                    'escalation.refund_provider_uncertain',
                    "Refund #{$ledger->id} (payment #{$locked->id}, ₱".number_format((float) $ledger->amount, 2).') got no clear answer from PayMongo ('.($outcome['error'] ?? 'unknown').'). It stays reserved and must not be retried; reconciliation will look it up.',
                    $ledger,
                    \App\Models\ActivityLog::TYPE_FINANCIAL,
                );
                $this->markPayableAttempt($locked, 'pending');

                return ['success' => false, 'status' => 'pending', 'refund_id' => null, 'uncertain' => true];
            }

            if (! $providerResponse) {
                // PayMongo definitively refused (its error response proves no
                // refund exists): release the reservation and KEEP the payment
                // refundable. The attempt stays audit-visible; a retry is a new
                // request.
                $ledger->update([
                    'status' => 'failed',
                    'metadata' => array_merge($ledger->metadata ?? [], ['attempt_failed' => true, 'provider_rejected' => ['http_status' => $outcome['http_status'], 'error' => $outcome['error']]]),
                ]);
                $this->markPayableAttempt($locked, 'failed', $reason ?: 'Refund attempt failed.');

                return ['success' => false, 'status' => 'provider_error', 'refund_id' => null];
            }

            $providerStatus = strtolower($providerResponse['attributes']['status'] ?? 'pending');
            $refundId = $providerResponse['id'];
            $ledgerStatus = match ($providerStatus) {
                'succeeded', 'success', 'completed' => 'succeeded',
                'failed', 'cancelled', 'reversed' => 'failed',
                default => 'pending',
            };

            $ledger->update([
                'provider_refund_id' => $refundId,
                'status' => $ledgerStatus,
                'refunded_at' => $ledgerStatus === 'succeeded' ? now() : null,
                'metadata' => array_merge($ledger->metadata ?? [], ['response' => $providerResponse]),
            ]);

            if ($ledgerStatus === 'succeeded') {
                $this->finalizeRefunded($locked, $ledger, $forOrder);

                return ['success' => true, 'status' => 'succeeded', 'refund_id' => $refundId];
            }

            if ($ledgerStatus === 'failed') {
                // Provider returned a definitively-failed refund: money never
                // moved, so the payment stays 'paid' and retryable.
                $this->markPayableAttempt($locked, 'failed', $reason ?: 'Refund failed.');

                return ['success' => false, 'status' => 'provider_error', 'refund_id' => $refundId];
            }

            // pending / processing → awaiting the provider's final verdict.
            $locked->update([
                'status' => 'pending_refund',
                'refunded_at' => null,
                'metadata' => array_merge($locked->metadata ?? [], ['refund' => $providerResponse]),
            ]);
            $this->markPayableAttempt($locked, 'pending', $reason);

            return ['success' => false, 'status' => 'pending', 'refund_id' => $refundId];
        });
    }

    /**
     * Apply an authoritative provider status to a refund (webhook / reconciliation).
     *
     * Idempotent: repeated application converges to the same state, never
     * duplicates ledger rows, and never downgrades a successful refund.
     */
    public function applyProviderStatus(
        string $providerRefundId,
        string $providerStatus,
        ?string $paymentId = null,
        array $attributes = [],
        ?string $localRefundKey = null,
    ): void {
        $normalized = $this->normalizeProviderStatus($providerStatus);

        $ledger = Refund::query()->where('provider_refund_id', $providerRefundId)->first();

        if (! $ledger) {
            $claim = $this->claimRequestedRefund($providerRefundId, $localRefundKey, $paymentId, $attributes);
            if ($claim === false) {
                // Several of our own refunds for this payment are in flight and
                // nothing identifies which one this is: record nothing. The
                // request's own phase 3 links it, and reconciliation re-queries.
                Log::warning('Refund webhook matches more than one in-flight refund — left to the request and reconciliation', [
                    'refund_id' => $providerRefundId,
                    'payment_id' => $paymentId,
                ]);

                return;
            }
            $ledger = $claim;
        }

        if (! $ledger) {
            if (! $paymentId) {
                Log::warning('Refund webhook/reconciliation for unknown refund', ['refund_id' => $providerRefundId]);
                return;
            }

            $fallbackPayment = Payment::query()
                ->where(fn ($q) => $q->where('provider_source_id', $paymentId)->orWhere('provider_payment_id', $paymentId))
                ->first();

            if (! $fallbackPayment) {
                Log::warning('Refund webhook/reconciliation: no matching payment', [
                    'refund_id' => $providerRefundId,
                    'payment_id' => $paymentId,
                ]);
                return;
            }

            $fallbackAmount = isset($attributes['amount']) ? (float) ($attributes['amount'] / 100) : (float) $fallbackPayment->amount;
            $ledger = $this->recordLedger(
                $fallbackPayment,
                $fallbackPayment->payable_type,
                $fallbackPayment->payable_id,
                null,
                $fallbackPayment->user_id,
                $fallbackAmount,
                $fallbackAmount,
                0.0,
                $attributes['reason'] ?? 'Refund',
                'pending',
                $providerRefundId,
                ['webhook' => $attributes],
            );
        }

        // A refund that already succeeded is final: a duplicate or delayed
        // event (succeeded again, pending, failed) changes and counts nothing.
        if ($ledger->status === 'succeeded') {
            return;
        }

        $payment = Payment::query()->find($ledger->payment_id);

        // Never downgrade an already-refunded payment / ledger.
        if ($payment && $payment->status === 'refunded') {
            $ledger->update(['status' => 'succeeded', 'refunded_at' => $ledger->refunded_at ?? now()]);
            return;
        }

        if ($ledger->status === 'succeeded' && $normalized !== 'succeeded') {
            return;
        }

        match ($normalized) {
            'succeeded' => $this->finalizeRefunded($payment, $ledger),
            'failed' => $this->applyProviderFailure($payment, $ledger),
            default => $this->applyProviderPending($payment, $ledger),
        };
    }

    /**
     * Find, at PayMongo, a refund we requested but never got an id for
     * (uncertain create, or a crash before phase 3) — by the local key we put
     * in its metadata, on the payment's refund list. NEVER creates a refund.
     *
     *  linked       found: linked to the row and its real status applied
     *  not_found    PayMongo lists no refund with our key: stays requested,
     *               reserved and escalated (absence never authorises a retry)
     *  unreachable  PayMongo could not be asked: nothing changes
     *  skipped      not an unlinked requested refund
     */
    public function resolveUnconfirmedRequest(Refund $refund): string
    {
        $refund->refresh();
        if ($refund->status !== 'requested' || $refund->provider_refund_id || ! $refund->idempotency_key) {
            return 'skipped';
        }
        $payment = Payment::query()->find($refund->payment_id);
        $providerPaymentId = $payment?->provider_source_id ?? $payment?->provider_payment_id;
        if (! $providerPaymentId) {
            return 'skipped';
        }

        $providerPayment = $this->paymongo->retrievePayment($providerPaymentId);
        if (! $providerPayment) {
            return 'unreachable';
        }

        $matches = collect($providerPayment['attributes']['refunds'] ?? [])
            ->filter(fn ($r) => is_array($r) && ! empty($r['id'])
                && (($r['attributes']['metadata']['local_refund_key'] ?? $r['metadata']['local_refund_key'] ?? null) === $refund->idempotency_key))
            ->values();

        if ($matches->isEmpty()) {
            Log::warning('Unconfirmed refund not found at PayMongo — left requested and escalated, never retried', [
                'refund_id' => $refund->id,
                'payment_id' => $refund->payment_id,
            ]);

            return 'not_found';
        }

        // One POST per request means one match. More than one would be refunds
        // PayMongo created twice: link the first, escalate the rest (each is
        // recorded as its own refund when its webhook arrives).
        if ($matches->count() > 1) {
            \App\Models\ActivityLog::record(
                'escalation.refund_duplicated_at_provider',
                "PayMongo lists {$matches->count()} refunds for local refund #{$refund->id} (".$matches->pluck('id')->implode(', ').'). Investigate before anything else is refunded.',
                $refund,
                \App\Models\ActivityLog::TYPE_FINANCIAL,
            );
        }

        $match = $matches->first();
        $attributes = is_array($match['attributes'] ?? null) ? $match['attributes'] : $match;
        $this->applyProviderStatus(
            providerRefundId: (string) $match['id'],
            providerStatus: (string) ($attributes['status'] ?? 'pending'),
            paymentId: $providerPaymentId,
            attributes: $attributes,
            localRefundKey: $refund->idempotency_key,
        );

        return 'linked';
    }

    /**
     * This payment's PROVIDER refunds: rows linked to a PayMongo refund, plus
     * our requests not yet answered. Local credit-ledger rows (no provider id,
     * never "requested") are excluded — no money moved through PayMongo.
     */
    private function providerRefunds(Payment $payment)
    {
        return Refund::query()
            ->where('payment_id', $payment->id)
            ->where(fn ($q) => $q->whereNotNull('provider_refund_id')->orWhere('status', 'requested'));
    }

    /**
     * What has been refunded through PayMongo and what may still be.
     *
     *  succeeded  money returned (counts toward refunded_amount)
     *  in_flight  requested / pending: reserved, not yet money returned
     *  remaining  paid − succeeded − in_flight (failed refunds release theirs)
     *
     * @return array{paid: float, succeeded: float, in_flight: float, remaining: float}
     */
    public function refundTotals(Payment $payment): array
    {
        $rows = $this->providerRefunds($payment)->get(['status', 'amount']);
        $sum = fn (array $statuses) => round((float) $rows->whereIn('status', $statuses)->sum(fn (Refund $r) => (float) $r->amount), 2);

        $paid = round((float) $payment->amount, 2);
        $succeeded = $sum(['succeeded']);
        $inFlight = $sum(['requested', 'pending']);

        return [
            'paid' => $paid,
            'succeeded' => $succeeded,
            'in_flight' => $inFlight,
            'remaining' => max(0.0, round($paid - $succeeded - $inFlight, 2)),
        ];
    }

    /** Fully refunded = PayMongo refunds that succeeded total the amount paid. */
    private function isFullyRefunded(array $totals): bool
    {
        return $totals['paid'] > 0 && $totals['succeeded'] >= $totals['paid'] - 0.004;
    }

    /**
     * Derive the payment status from its refunds: 'refunded' only once fully
     * refunded; 'pending_refund' while a refund is with PayMongo; otherwise it
     * stays (or returns to) 'paid' — a partial refund never makes the whole
     * payment look refunded. Never downgrades 'refunded'.
     */
    private function syncPaymentStatus(Payment $payment): array
    {
        $payment->refresh();
        $totals = $this->refundTotals($payment);

        if ($payment->status === 'refunded') {
            return $totals;
        }

        if ($this->isFullyRefunded($totals)) {
            $payment->update(['status' => 'refunded', 'refunded_at' => now()]);
        } elseif ($this->providerRefunds($payment)->where('status', 'pending')->exists()) {
            if ($payment->status !== 'pending_refund') {
                $payment->update(['status' => 'pending_refund']);
            }
        } elseif ($payment->status === 'pending_refund') {
            $payment->update(['status' => 'paid', 'refunded_at' => null]);
        }

        return $totals;
    }

    /**
     * A provider refund we started but have not yet linked: initiateRefund
     * records the refund as "requested" (with its idempotency key) before
     * calling PayMongo, and attaches the ref_… id only after PayMongo answers.
     * A webhook arriving in between must settle THAT row, not create a second
     * ledger entry.
     *
     * 1. The key PayMongo echoes in metadata (local_refund_key) decides. A key
     *    that matches none of our unlinked requests is a different refund.
     * 2. Without a key: the payment's ONE unlinked requested refund of the
     *    same amount. Two or more equal candidates are ambiguous → false
     *    (never guess which refund it is, never record a duplicate).
     *
     * @return Refund|null|false  the claimed row; null = not ours (record it
     *                            as a new refund); false = ambiguous (skip)
     */
    private function claimRequestedRefund(string $providerRefundId, ?string $localRefundKey, ?string $paymentId, array $attributes): Refund|null|false
    {
        $unlinked = fn () => Refund::query()->whereNull('provider_refund_id')->where('status', 'requested')->lockForUpdate();

        $ledger = null;
        if ($localRefundKey) {
            $ledger = $unlinked()->where('idempotency_key', $localRefundKey)->first();
        } elseif ($paymentId) {
            $payment = Payment::query()
                ->where(fn ($q) => $q->where('provider_source_id', $paymentId)->orWhere('provider_payment_id', $paymentId))
                ->first();
            if ($payment) {
                $candidates = $unlinked()->where('payment_id', $payment->id)
                    ->when(isset($attributes['amount']), fn ($q) => $q->where('amount', round(((int) $attributes['amount']) / 100, 2)))
                    ->get();
                if ($candidates->count() > 1) {
                    return false;
                }
                $ledger = $candidates->first();
            }
        }

        if ($ledger) {
            $ledger->update([
                'provider_refund_id' => $providerRefundId,
                'metadata' => array_merge($ledger->metadata ?? [], ['linked_by_webhook' => true]),
            ]);
        }

        return $ledger;
    }

    protected function normalizeProviderStatus(string $providerStatus): string
    {
        return match (strtolower(trim($providerStatus))) {
            'succeeded', 'success', 'completed', 'processed' => 'succeeded',
            'failed', 'cancelled', 'reversed' => 'failed',
            default => 'pending',
        };
    }

    /**
     * Record (or update) a single refunds-ledger row. Returns the row.
     */
    private function recordLedger(
        Payment $payment,
        string $payableType,
        int $payableId,
        ?int $orderItemId,
        ?int $userId,
        float $amount,
        float $originalAmount,
        float $deduction,
        string $reason,
        string $status,
        ?string $providerRefundId,
        array $metadata,
        ?Order $forOrder = null,
    ): Refund {
        return Refund::updateOrCreate(
            ['provider_refund_id' => $providerRefundId],
            [
                'payment_id' => $payment->id,
                'order_id' => $forOrder?->id ?: ($payableType === Order::class ? $payableId : null),
                'payable_type' => $payableType,
                'payable_id' => $payableId,
                'order_item_id' => $orderItemId,
                'user_id' => $userId,
                'amount' => round($amount, 2),
                'original_amount' => round($originalAmount, 2),
                'refund_deduction' => round($deduction, 2),
                'currency' => $payment->currency ?? 'PHP',
                'reason' => $reason,
                'metadata' => $metadata,
                'status' => $status,
                'refunded_at' => $status === 'succeeded' ? now() : null,
            ],
        );
    }

    /**
     * Provider confirmed the refund succeeded: mark payment, ledger and payable
     * refunded. Idempotent — a second finalization is a no-op.
     */
    private function finalizeRefunded(?Payment $payment, Refund $ledger, ?Order $forOrder = null): void
    {
        $ledger->update(['status' => 'succeeded', 'refunded_at' => $ledger->refunded_at ?? now()]);

        app(OrderSettlementService::class)->recordRefundDeduction($ledger->fresh());

        if (! $payment) {
            return;
        }

        // 'refunded' only when the refunds total the amount paid; a partial
        // refund leaves the payment 'paid' (or 'pending_refund' while another
        // refund is still with PayMongo).
        $totals = $this->syncPaymentStatus($payment);
        $fully = $this->isFullyRefunded($totals);
        $othersInFlight = $totals['in_flight'] > 0;

        $payable = $forOrder ?? $payment->payable;

        if ($payable instanceof Order) {
            // Runs once per refund (a succeeded refund is never re-applied), so
            // the running total grows by exactly this refund's amount.
            $payable->refresh();
            $paid = (float) ($payable->paid_amount ?: $payable->total ?: 0);
            $newTotal = round(min((float) $payable->refunded_amount + (float) $ledger->amount, $paid), 2);
            $payable->update(array_merge([
                'refund_status' => $othersInFlight ? 'pending' : 'refunded',
                'refunded_amount' => $newTotal,
                'refund_amount' => $newTotal,
                'paymongo_refund_id' => $ledger->provider_refund_id ?: $payable->paymongo_refund_id,
                'refund_requested_at' => $payable->refund_requested_at ?? now(),
                'refunded_at' => now(),
                'refund_failure_reason' => null,
            ], $fully ? ['payment_status' => 'refunded'] : []));
        } elseif ($payable instanceof Booking && $fully) {
            $payable->update(['payment_status' => 'refunded']);
        }
        // GroupCheckout payments are refunded via the local credit ledger
        // (refundPaidGroupChild / markPaymentFullyRefunded); a provider refund
        // is never issued per child, so nothing more to do here.
    }

    /**
     * The provider definitively failed the refund attempt: money never moved.
     * Keep the payment refundable ('paid') and mark the payable retryable.
     */
    private function applyProviderFailure(?Payment $payment, Refund $ledger): void
    {
        // A failed refund is no longer counted: its reserved amount is released.
        $ledger->update(['status' => 'failed', 'refunded_at' => null]);

        if ($payment) {
            $this->syncPaymentStatus($payment);
            $this->markPayableAttempt($payment, 'failed', $ledger->reason ?: 'Refund failed.');
        }
    }

    /**
     * The provider has the refund pending: mark the payment 'pending_refund'
     * so local flows stop, and expose the pending state on the payable.
     */
    private function applyProviderPending(?Payment $payment, Refund $ledger): void
    {
        $ledger->update(['status' => 'pending', 'refunded_at' => null]);

        if ($payment && in_array($payment->status, ['paid', 'authorized'], true)) {
            $payment->update(['status' => 'pending_refund']);
        }

        if ($payment) {
            $this->markPayableAttempt($payment, 'pending');
        }
    }

    /**
     * Expose the refund attempt state on the order's refund-tracking columns so
     * scheduled commands and reconciliation know whether the order is settled,
     * in-flight, or retryable. Group payables are handled by their own local
     * ledger; bookings expose only payment_status.
     */
    private function markPayableAttempt(Payment $payment, string $status, string $reason = ''): void
    {
        $payable = $payment->payable;

        if (! $payable instanceof Order) {
            return;
        }

        $payable->update([
            'refund_status' => $status,
            'refund_failure_reason' => $status === 'failed' ? ($reason ?: 'Refund attempt failed.') : null,
            'refund_requested_at' => $payable->refund_requested_at ?? now(),
        ]);
    }
}
