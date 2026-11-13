<?php

namespace App\Console\Commands;

use App\Models\Payment;
use App\Models\Refund;
use App\Services\PaymongoService;
use App\Services\PaymentRefundProcessor;
use Illuminate\Console\Command;

class ReconcilePendingRefunds extends Command
{
    protected $signature = 'payments:reconcile-refunds';

    protected $description = 'Reconcile pending_refund payments against the PayMongo refund state (idempotent, never issues duplicate refunds)';

    public function handle(): int
    {
        $paymongo = app(PaymongoService::class);
        $processor = app(PaymentRefundProcessor::class);

        $this->reconcileUnconfirmedRequests($processor);
        $this->escalateStaleRequests();

        $payments = Payment::query()->where('status', 'pending_refund')->get();

        if ($payments->isEmpty()) {
            $this->info('No pending refunds to reconcile.');

            return self::SUCCESS;
        }

        $settled = 0;
        $stillPending = 0;
        $unreachable = 0;

        foreach ($payments as $payment) {
            $sourceId = $payment->provider_source_id ?? $payment->provider_payment_id;

            if (! $sourceId) {
                // Cannot attribute a provider refund: revert to 'paid' (retryable)
                // rather than leaving the payment stuck as pending_refund.
                $payment->update(['status' => 'paid']);
                $this->warn("Payment #{$payment->payment_number} had no provider id; reverted to paid.");
                continue;
            }

            // Every provider refund of this payment still pending (a payment can
            // carry several partial refunds); else the latest one we recorded.
            $providerRefundIds = Refund::query()
                ->where('payment_id', $payment->id)
                ->whereNotNull('provider_refund_id')
                ->where('status', 'pending')
                ->orderBy('id')
                ->pluck('provider_refund_id')
                ->all();

            if ($providerRefundIds === []) {
                $latest = Refund::query()
                    ->where('payment_id', $payment->id)
                    ->whereNotNull('provider_refund_id')
                    ->latest('id')
                    ->value('provider_refund_id');

                // Legacy: pre-P11.3 refund flows only stored the provider refund
                // id inside payment.metadata.refund.id.
                $latest = $latest ?: ($payment->metadata['refund']['id'] ?? null);
                $providerRefundIds = $latest ? [$latest] : [];
            }

            // Only a provider refund id we recorded can be looked up (documented
            // GET /refunds/{id}). Without one — or if PayMongo is unreachable —
            // the payment stays pending_refund: never decided blindly.
            $lookedUp = 0;
            foreach ($providerRefundIds as $providerRefundId) {
                $response = $paymongo->retrieveRefund($providerRefundId);
                if (! $response || empty($response['id'])) {
                    continue;
                }
                $lookedUp++;
                $processor->applyProviderStatus(
                    providerRefundId: $response['id'],
                    providerStatus: strtolower($response['attributes']['status'] ?? 'pending'),
                    paymentId: $sourceId,
                    attributes: $response['attributes'] ?? [],
                );
            }

            if ($lookedUp === 0) {
                $unreachable++;
                $this->warn("Refund for payment #{$payment->payment_number} could not be looked up; leaving as pending_refund.");

                continue;
            }

            $payment->refresh();

            if ($payment->status === 'refunded') {
                $settled++;
                $this->info("Payment #{$payment->payment_number} settled as refunded.");
            } elseif ($payment->status === 'paid') {
                // A partial refund succeeded, or the refund failed (retryable):
                // either way nothing is pending and the payment is not fully refunded.
                $this->info("Payment #{$payment->payment_number} has no refund pending; it stays paid (partial refund settled or failed and retryable).");
            } else {
                $stillPending++;
                $this->info("Payment #{$payment->payment_number} still pending with the provider.");
            }
        }

        $count = $payments->count();
        $this->info("Reconciled {$count} pending refund(s): {$settled} settled, {$stillPending} still pending, {$unreachable} provider-unreachable.");

        return self::SUCCESS;
    }

    /**
     * Refunds we requested but never got a PayMongo id for (an uncertain
     * create: timeout, connection failure, 5xx, 429…, or a crash before the
     * answer was saved). Each is looked up by its local key on the payment's
     * PayMongo refund list: a match is linked and settled; no match stays
     * requested, reserved and escalated. A create is NEVER re-sent — PayMongo
     * ignores Idempotency-Key on refunds, so that could refund twice.
     * Requests younger than a minute are left alone (still in their own call).
     */
    private function reconcileUnconfirmedRequests(PaymentRefundProcessor $processor): void
    {
        $requests = Refund::query()
            ->where('status', 'requested')
            ->whereNull('provider_refund_id')
            ->whereNotNull('idempotency_key')
            ->where('created_at', '<=', now()->subMinute())
            ->orderBy('id')
            ->get();

        foreach ($requests as $refund) {
            $result = $processor->resolveUnconfirmedRequest($refund);
            match ($result) {
                'linked' => $this->info("Refund #{$refund->id} found at PayMongo by its key; linked (".$refund->fresh()->status.').'),
                'not_found' => $this->warn("Refund #{$refund->id}: no PayMongo refund carries its key. Left requested and escalated; it will not be retried."),
                'unreachable' => $this->warn("Refund #{$refund->id}: PayMongo could not be asked; left as requested."),
                default => null,
            };
        }
    }

    /**
     * Stage 5: a refund still "requested" after 10 minutes means PayMongo may
     * have accepted it without our record being settled (e.g. a crash). It
     * is NEVER retried automatically (that could refund twice): it keeps
     * blocking new refund attempts and is escalated once for the Tourism
     * Office to check against the PayMongo dashboard.
     */
    private function escalateStaleRequests(): void
    {
        $stale = \App\Models\Refund::query()
            ->where('status', 'requested')
            ->where('created_at', '<=', now()->subMinutes(10))
            ->get()
            ->filter(fn ($r) => empty(($r->metadata ?? [])['escalated_at']));

        foreach ($stale as $refund) {
            \App\Models\ActivityLog::record(
                'escalation.refund_requested_unconfirmed',
                "Refund #{$refund->id} (payment #{$refund->payment_id}, ₱".number_format((float) $refund->amount, 2).") was requested but never confirmed. Check PayMongo before any retry.",
                $refund,
                \App\Models\ActivityLog::TYPE_FINANCIAL,
            );
            $refund->update(['metadata' => array_merge($refund->metadata ?? [], ['escalated_at' => now()->toIso8601String()])]);
            $this->warn("Refund #{$refund->id} requested but unconfirmed: escalated for review.");
        }
    }
}
