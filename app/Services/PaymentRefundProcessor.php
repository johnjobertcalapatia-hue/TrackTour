<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\GroupCheckout;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Refund;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

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
        return DB::transaction(function () use ($payment, $amount, $reason, $forOrder, $orderItemId, $userId, $originalAmount) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);

            if (! $locked) {
                return ['success' => false, 'status' => 'not_found', 'refund_id' => null];
            }

            if ($locked->status === 'refunded') {
                return ['success' => false, 'status' => 'already_refunded', 'refund_id' => null];
            }

            if ($locked->status === 'pending_refund') {
                return ['success' => false, 'status' => 'in_flight', 'refund_id' => null];
            }

            if (! in_array($locked->status, ['paid', 'authorized'], true)) {
                return ['success' => false, 'status' => 'not_refundable', 'refund_id' => null];
            }

            $sourceId = $locked->provider_source_id ?? $locked->provider_payment_id;
            if (! $sourceId) {
                return ['success' => false, 'status' => 'no_provider_ref', 'refund_id' => null];
            }

            // Never issue a second provider refund when an active (pending or
            // succeeded) provider-backed refund already exists for the same
            // payment / item intent. Local credit-ledger rows (provider_refund_id
            // null) never block a real provider refund.
            $active = Refund::query()
                ->where('payment_id', $locked->id)
                ->whereNotNull('provider_refund_id')
                ->whereIn('status', ['pending', 'succeeded'])
                ->when($orderItemId, fn ($q) => $q->where('order_item_id', $orderItemId), fn ($q) => $q->whereNull('order_item_id'))
                ->latest('id')
                ->first();

            if ($active) {
                return [
                    'success' => $active->status === 'succeeded',
                    'status' => $active->status === 'succeeded' ? 'already_refunded' : 'in_flight',
                    'refund_id' => $active->provider_refund_id,
                ];
            }

            $providerResponse = $this->paymongo->createRefund(
                $sourceId,
                (int) round($amount * 100),
                $reason
            );

            $payableType = $forOrder ? Order::class : ($locked->payable_type ?: Order::class);
            $payableId = $forOrder ? $forOrder->id : $locked->payable_id;

            if (! $providerResponse || empty($providerResponse['id'])) {
                // Provider error: KEEP the payment refundable. Record the failed
                // attempt so the failure is audit-visible and retryable.
                $this->recordLedger(
                    $locked,
                    $payableType,
                    $payableId,
                    $orderItemId,
                    $userId ?? $locked->user_id,
                    $amount,
                    $originalAmount ?? $amount,
                    0.0,
                    $reason ?: 'Refund',
                    'failed',
                    null,
                    ['attempt_failed' => true],
                    $forOrder,
                );
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

            $ledger = $this->recordLedger(
                $locked,
                $payableType,
                $payableId,
                $orderItemId,
                $userId ?? $locked->user_id,
                $amount,
                $originalAmount ?? $amount,
                0.0,
                $reason ?: 'Refund',
                $ledgerStatus,
                $refundId,
                ['response' => $providerResponse],
                $forOrder,
            );

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
    ): void {
        $normalized = $this->normalizeProviderStatus($providerStatus);

        $ledger = Refund::query()->where('provider_refund_id', $providerRefundId)->first();

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

        if ($payment->status !== 'refunded') {
            $payment->update([
                'status' => 'refunded',
                'refunded_at' => now(),
            ]);
        }

        $payable = $forOrder ?? $payment->payable;

        if ($payable instanceof Order) {
            $payable->refresh();
            $paid = (float) ($payable->paid_amount ?: $payable->total ?: 0);
            $newTotal = round(min((float) $payable->refunded_amount + (float) $ledger->amount, $paid), 2);
            $payable->update([
                'payment_status' => 'refunded',
                'refund_status' => 'refunded',
                'refunded_amount' => $newTotal,
                'refund_amount' => $newTotal,
                'paymongo_refund_id' => $ledger->provider_refund_id ?: $payable->paymongo_refund_id,
                'refund_requested_at' => $payable->refund_requested_at ?? now(),
                'refunded_at' => now(),
                'refund_failure_reason' => null,
            ]);
        } elseif ($payable instanceof Booking) {
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
        $ledger->update(['status' => 'failed', 'refunded_at' => null]);

        if ($payment) {
            if ($payment->status !== 'refunded') {
                $payment->update(['status' => 'paid', 'refunded_at' => null]);
            }
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
