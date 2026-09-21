<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PaymongoService
{
    protected string $secretKey;
    protected string $webhookSecret;
    protected string $baseUrl;

    public function __construct()
    {
        $this->secretKey = config('services.paymongo.secret_key', '');
        $this->webhookSecret = config('services.paymongo.webhook_secret', '');
        $this->baseUrl = config('services.paymongo.base_url', 'https://api.paymongo.com/v1');
    }

    public function isConfigured(): bool
    {
        return ! empty($this->secretKey) && ! str_contains($this->secretKey, 'your_secret_key');
    }

    protected function headers(): array
    {
        return [
            'Authorization' => 'Basic '.base64_encode($this->secretKey.':'),
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
        ];
    }

    /**
     * Create a PayMongo Checkout Session (v2 API) for GCash or Card payment.
     *
     * @param  array{amount: int, currency: string, description: string, reference_number: string, success_url: string, cancel_url: string, payment_method_types: string[], metadata: array}  $params
     */
    public function createCheckoutSession(array $params): ?array
    {
        if (! $this->isConfigured()) {
            Log::warning('PayMongo is not configured.');

            return null;
        }

        try {
            $lineItems = $params['line_items'] ?? [
                [
                    'name' => $params['description'] ?? 'Track-Tour Payment',
                    'amount' => $params['amount'],
                    'currency' => $params['currency'] ?? 'PHP',
                    'quantity' => 1,
                ],
            ];

            $response = Http::withHeaders($this->headers())
                ->timeout(15)
                ->post("https://api.paymongo.com/v1/checkout_sessions", [
                    'data' => [
                        'attributes' => [
                            'line_items' => $lineItems,
                            'payment_method_types' => $params['payment_method_types'] ?? ['gcash'],
                            'description' => $params['description'] ?? '',
                            'reference_number' => $params['reference_number'],
                            'success_url' => $params['success_url'],
                            'cancel_url' => $params['cancel_url'],
                            'metadata' => $params['metadata'] ?? [],
                        ],
                    ],
                ]);

            if ($response->successful()) {
                return $response->json('data');
            }

            Log::warning('PayMongo createCheckoutSession failed', [
                'status' => $response->status(),
                'body' => $response->json(),
            ]);

            return null;
        } catch (\Exception $e) {
            Log::error('PayMongo createCheckoutSession exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * Create a PayMongo Payment Intent (Payment Acceptance API).
     *
     * @param  array{amount: int, currency: string, description: string, payment_method_allowed: string[], metadata: array}  $params
     */
    public function createPaymentIntent(array $params): ?array
    {
        if (! $this->isConfigured()) {
            Log::warning('PayMongo is not configured.');

            return null;
        }

        try {
            $response = Http::withHeaders($this->headers())
                ->timeout(15)
                ->post('https://api.paymongo.com/v1/payment_intents', [
                    'data' => [
                        'attributes' => [
                            'amount' => $params['amount'],
                            'currency' => $params['currency'] ?? 'PHP',
                            'payment_method_allowed' => $params['payment_method_allowed'] ?? ['gcash'],
                            'description' => $params['description'] ?? '',
                            'metadata' => collect($params['metadata'] ?? [])
                                ->mapWithKeys(fn ($v, $k) => [$k => (string) $v])
                                ->all(),
                        ],
                    ],
                ]);

            if ($response->successful()) {
                return $response->json('data');
            }

            Log::warning('PayMongo createPaymentIntent failed', [
                'status' => $response->status(),
                'body' => $response->json(),
            ]);

            return null;
        } catch (\Exception $e) {
            Log::error('PayMongo createPaymentIntent exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * Retrieve a Payment Intent by ID.
     */
    public function retrievePaymentIntent(string $piId): ?array
    {
        try {
            $response = Http::withHeaders($this->headers())
                ->timeout(10)
                ->get("https://api.paymongo.com/v1/payment_intents/{$piId}");

            if ($response->successful()) {
                return $response->json('data');
            }

            return null;
        } catch (\Exception $e) {
            Log::error('PayMongo retrievePaymentIntent exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * Create a refund for a payment.
     */
    public function createRefund(string $paymentId, int $amountInCents, string $reason = ''): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            $payload = [
                'data' => [
                    'attributes' => [
                        'amount' => $amountInCents,
                    ],
                ],
            ];

            if ($reason !== '') {
                $payload['data']['attributes']['reason'] = $reason;
            }

            $response = Http::withHeaders($this->headers())
                ->timeout(15)
                ->post("https://api.paymongo.com/v1/payments/{$paymentId}/refunds", $payload);

            if ($response->successful()) {
                return $response->json('data');
            }

            Log::warning('PayMongo createRefund failed', [
                'status' => $response->status(),
                'body' => $response->json(),
            ]);

            return null;
        } catch (\Exception $e) {
            Log::error('PayMongo createRefund exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * Fetch payments from PayMongo API with pagination.
     *
     * @param  int  $limit  Number of records (max 100)
     * @param  string|null  $after  Cursor for next page
     * @param  string|null  $before  Cursor for previous page
     */
    public function fetchPayments(int $limit = 20, ?string $after = null, ?string $before = null): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            $params = ['limit' => min($limit, 100)];
            if ($after) {
                $params['after'] = $after;
            }
            if ($before) {
                $params['before'] = $before;
            }

            $response = Http::withHeaders($this->headers())
                ->timeout(15)
                ->get('https://api.paymongo.com/v1/payments', $params);

            if ($response->successful()) {
                return $response->json('data');
            }

            Log::warning('PayMongo fetchPayments failed', [
                'status' => $response->status(),
                'body' => $response->json(),
            ]);

            return null;
        } catch (\Exception $e) {
            Log::error('PayMongo fetchPayments exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * Retrieve a single refund object by its PayMongo refund ID.
     */
    public function retrieveRefund(string $refundId): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            $response = Http::withHeaders($this->headers())
                ->timeout(10)
                ->get("https://api.paymongo.com/v1/refunds/{$refundId}");

            if ($response->successful()) {
                return $response->json('data');
            }

            Log::warning('PayMongo retrieveRefund failed', [
                'refund_id' => $refundId,
                'status' => $response->status(),
                'body' => $response->json(),
            ]);

            return null;
        } catch (\Exception $e) {
            Log::error('PayMongo retrieveRefund exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * List the refunds issued against a specific payment.
     */
    public function listPaymentRefunds(string $paymentId): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            $response = Http::withHeaders($this->headers())
                ->timeout(10)
                ->get("https://api.paymongo.com/v1/payments/{$paymentId}/refunds");

            if ($response->successful()) {
                return $response->json('data') ?? [];
            }

            Log::warning('PayMongo listPaymentRefunds failed', [
                'payment_id' => $paymentId,
                'status' => $response->status(),
                'body' => $response->json(),
            ]);

            return null;
        } catch (\Exception $e) {
            Log::error('PayMongo listPaymentRefunds exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * Verify PayMongo webhook signature.
     *
     * PayMongo sends a signature header for webhook verification.
     */
    public function verifyWebhookSignature(string $payload, string $signatureHeader): bool
    {
        if (empty($this->webhookSecret)) {
            Log::warning('PayMongo webhook secret not configured — skipping signature verification.');

            return true;
        }

        if (empty($signatureHeader)) {
            Log::warning('PayMongo webhook missing signature header — rejecting.');

            return false;
        }

        $parts = [];
        foreach (explode(',', $signatureHeader) as $pair) {
            $kv = explode('=', $pair, 2);
            if (count($kv) === 2) {
                $parts[trim($kv[0])] = trim($kv[1]);
            }
        }

        $timestamp = $parts['t'] ?? '';
        // PayMongo uses `te` for test-mode signatures and `li` for live mode.
        $signature = '';
        foreach (['v1', 'te', 'li'] as $signatureKey) {
            if (! empty($parts[$signatureKey])) {
                $signature = $parts[$signatureKey];
                break;
            }
        }

        if ($timestamp === '' || $signature === '') {
            Log::warning('PayMongo webhook signature malformed', ['parts' => $parts]);

            return false;
        }

        $signedPayload = $timestamp.'.'.$payload;
        $expected = hash_hmac('sha256', $signedPayload, $this->webhookSecret);
        $valid = hash_equals($expected, $signature);

        if (! $valid) {
            Log::warning('PayMongo webhook signature mismatch', [
                'expected' => $expected,
                'received' => $signature,
            ]);
        }

        return $valid;
    }
}
