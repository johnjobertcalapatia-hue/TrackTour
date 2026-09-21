<?php

namespace App\Services;

use App\Models\RiderCredit;
use App\Models\RiderCreditTransaction;
use App\Models\RiderTopUp;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class RiderCreditService
{
    /**
     * Get or create rider credit account.
     */
    public function getOrCreateAccount(int $riderId): RiderCredit
    {
        return RiderCredit::firstOrCreate(
            ['rider_id' => $riderId],
            [
                'total_credits' => 200, // Start with protected reserve
                'reserved_credits' => 0,
                'minimum_reserve' => 200,
            ]
        );
    }

    /**
     * Get rider's full credit balance with all details.
     */
    public function getBalance(int $riderId): array
    {
        $account = $this->getOrCreateAccount($riderId);

        return [
            'total_credits' => (float) $account->total_credits,
            'minimum_reserve' => (float) $account->minimum_reserve,
            'reserved_credits' => (float) $account->reserved_credits,
            'usable_credits' => $account->usable_credits,
            'is_cod_eligible' => $account->isCodEligible(),
        ];
    }

    /**
     * Get rider's credit transaction history.
     */
    public function getTransactions(int $riderId, int $limit = 20): \Illuminate\Database\Eloquent\Collection
    {
        return RiderCreditTransaction::where('rider_id', $riderId)
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();
    }

    /**
     * Initiate a top-up via PayMongo GCash.
     */
    public function initiateTopUp(User $rider, float $amount): array
    {
        if ($amount < 100) {
            throw new \InvalidArgumentException('Minimum top-up amount is ₱100.');
        }

        if ($amount > 50000) {
            throw new \InvalidArgumentException('Maximum top-up amount is ₱50,000.');
        }

        $reference = 'TT-CREDIT-' . Str::upper(Str::random(12));
        $baseUrl = config('app.frontend_url', 'http://localhost:5173');

        // Create pending top-up record
        $topUp = RiderTopUp::create([
            'rider_id' => $rider->id,
            'amount' => $amount,
            'payment_method' => 'gcash',
            'payment_reference' => $reference,
            'provider' => 'paymongo',
            'status' => 'pending',
        ]);

        $amountCents = (int) ($amount * 100);

        $payload = [
            'data' => [
                'attributes' => [
                    'amount' => $amountCents,
                    'currency' => 'PHP',
                    'description' => "TrackTour Credits - PHP " . number_format($amount, 2),
                    'reference_number' => $reference,
                    'statement_descriptor' => 'TRACKTOUR CREDITS',
                    'payment_method_types' => ['gcash'],
                    'success_url' => "{$baseUrl}/rider/wallet/topup/success?ref={$reference}",
                    'cancel_url' => "{$baseUrl}/rider/wallet/topup/failed?ref={$reference}",
                    'line_items' => [
                        [
                            'currency' => 'PHP',
                            'amount' => $amountCents,
                            'description' => "TrackTour credits worth PHP " . number_format($amount, 2),
                            'quantity' => 1,
                            'name' => 'TrackTour Credits',
                        ],
                    ],
                ],
            ],
        ];

        $response = Http::withBasicAuth(
            config('services.paymongo.secret_key', ''),
            ''
        )->post('https://api.paymongo.com/v1/checkout_sessions', $payload);

        if (!$response->successful()) {
            $topUp->markFailed();
            throw new \RuntimeException('Failed to create PayMongo checkout session.');
        }

        $session = $response->json('data');

        return [
            'checkout_url' => $session['attributes']['checkout_url'],
            'reference' => $reference,
            'amount' => $amount,
            'top_up_id' => $topUp->id,
        ];
    }

    /**
     * Confirm top-up after PayMongo webhook/redirect success.
     * Idempotent and concurrency-safe: a repeated confirm (e.g. the return
     * page mounting twice, or a retry) returns success instead of failing.
     */
    public function confirmTopUp(string $reference, string $paymentId): bool
    {
        return DB::transaction(function () use ($reference, $paymentId) {
            $topUp = RiderTopUp::where('payment_reference', $reference)
                ->lockForUpdate()
                ->first();

            if (!$topUp) {
                return false;
            }

            // Idempotency - already credited
            if ($topUp->isCredited()) {
                return true;
            }

            if (in_array($topUp->status, ['cancelled', 'failed'], true)) {
                return false;
            }

            $account = $this->getOrCreateAccount($topUp->rider_id);

            $amount = (float) $topUp->amount;

            // Credit the wallet
            $account->increment('total_credits', $amount);

            // Create ledger transaction
            $balanceBefore = (float) $account->total_credits - $amount;
            RiderCreditTransaction::create([
                'rider_id' => $topUp->rider_id,
                'order_id' => null,
                'transaction_type' => 'TOP_UP',
                'amount' => $amount,
                'balance_before' => $balanceBefore,
                'balance_after' => $account->total_credits,
                'reserved_before' => (float) $account->reserved_credits,
                'reserved_after' => (float) $account->reserved_credits,
                'reference' => $paymentId,
                'description' => "Top-up of PHP " . number_format($amount, 2) . " via GCash",
            ]);

            // Mark top-up as completed
            $topUp->update([
                'status' => 'completed',
                'provider_transaction_id' => $paymentId,
                'completed_at' => now(),
            ]);

            return true;
        });
    }

    /**
     * Mark a pending top-up as cancelled.
     */
    public function cancelTopUp(string $reference): bool
    {
        $topUp = RiderTopUp::where('payment_reference', $reference)
            ->where('status', 'pending')
            ->first();

        if (!$topUp) {
            return false;
        }

        $topUp->markCancelled();

        return true;
    }

    /**
     * Check if rider has sufficient credits for COD financing.
     */
    public function hasSufficientCredits(int $riderId, float $amount): bool
    {
        $account = $this->getOrCreateAccount($riderId);
        return $account->hasSufficientCredits($amount);
    }

    /**
     * Check if rider is COD eligible.
     */
    public function isCodEligible(int $riderId): bool
    {
        $account = $this->getOrCreateAccount($riderId);
        return $account->isCodEligible();
    }

    /**
     * Usable credits available for COD financing (total - minimum - reserved).
     */
    public function getUsableCredits(int $riderId): float
    {
        $account = $this->getOrCreateAccount($riderId);
        return $account->usable_credits;
    }

    /**
     * Reserve credits for COD order with concurrency protection.
     */
    public function reserveCredits(int $riderId, float $amount, ?int $orderId = null, ?string $description = null): bool
    {
        return DB::transaction(function () use ($riderId, $amount, $orderId, $description) {
            $account = RiderCredit::where('rider_id', $riderId)
                ->lockForUpdate()
                ->first();

            if (!$account) {
                return false;
            }

            if (!$account->hasSufficientCredits($amount)) {
                return false;
            }

            if ($account->wouldViolateReserve($amount)) {
                return false;
            }

            return $account->reserve($amount, $orderId, $description);
        });
    }

    /**
     * Release credits after cancelled COD order.
     */
    public function releaseCredits(int $riderId, float $amount, ?int $orderId = null, ?string $description = null): bool
    {
        $account = $this->getOrCreateAccount($riderId);
        return $account->release($amount, $orderId, $description);
    }

    /**
     * Finalize credits after completed COD delivery (rider keeps collected cash).
     */
    public function finalizeCredits(int $riderId, float $amount, ?int $orderId = null, ?string $description = null): bool
    {
        $account = $this->getOrCreateAccount($riderId);
        return $account->finalize($amount, $orderId, $description);
    }
}
