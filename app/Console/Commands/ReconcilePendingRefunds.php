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

            // Prefer the provider-backed refund we track in the refunds ledger.
            $ledger = Refund::query()
                ->where('payment_id', $payment->id)
                ->whereNotNull('provider_refund_id')
                ->latest('id')
                ->first();

            $providerRefundId = $ledger?->provider_refund_id;

            // Legacy: pre-P11.3 refund flows only stored the provider refund id
            // inside payment.metadata.refund.id.
            if (! $providerRefundId) {
                $providerRefundId = $payment->metadata['refund']['id'] ?? null;
            }

            $response = null;
            if ($providerRefundId) {
                $response = $paymongo->retrieveRefund($providerRefundId);
            }

            // Fallback: list the payment's refunds straight from the provider.
            if (! $response) {
                $refunds = $paymongo->listPaymentRefunds($sourceId);

                if ($refunds === null) {
                    $unreachable++;
                    $this->warn("Provider unreachable for payment #{$payment->payment_number}; leaving as pending_refund.");

                    continue;
                }

                $match = null;
                foreach ($refunds as $refund) {
                    if ($providerRefundId === null || ($refund['id'] ?? null) === $providerRefundId) {
                        $match = $refund;
                        break;
                    }
                }
                $response = $match;
            }

            if (! $response || empty($response['id'])) {
                // The provider has no refund for this payment: the refund never
                // happened. Do NOT mark it failed — revert to 'paid' (retryable)
                // and let the refund flows re-issue safely.
                $payment->update(['status' => 'paid']);
                $this->info("Payment #{$payment->payment_number} has no provider refund; reverted to paid.");

                continue;
            }

            $status = strtolower($response['attributes']['status'] ?? 'pending');
            $processor->applyProviderStatus(
                providerRefundId: $response['id'],
                providerStatus: $status,
                paymentId: $sourceId,
                attributes: $response['attributes'] ?? [],
            );

            $payment->refresh();

            if ($payment->status === 'refunded') {
                $settled++;
                $this->info("Payment #{$payment->payment_number} settled as refunded.");
            } elseif ($payment->status === 'paid') {
                $this->info("Payment #{$payment->payment_number} refund failed; reverted to paid (retryable).");
            } else {
                $stillPending++;
                $this->info("Payment #{$payment->payment_number} still pending with the provider.");
            }
        }

        $count = $payments->count();
        $this->info("Reconciled {$count} pending refund(s): {$settled} settled, {$stillPending} still pending, {$unreachable} provider-unreachable.");

        return self::SUCCESS;
    }
}