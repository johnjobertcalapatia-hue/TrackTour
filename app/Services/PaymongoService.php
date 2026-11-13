<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PaymongoService
{
    protected string $secretKey = '';
    protected string $webhookSecret = '';
    protected string $baseUrl = 'https://api.paymongo.com/v1';

    public function __construct()
    {
        $this->secretKey = (string) (config('services.paymongo.secret_key') ?? '');
        $this->webhookSecret = (string) (config('services.paymongo.webhook_secret') ?? '');
        $this->baseUrl = (string) (config('services.paymongo.base_url') ?? 'https://api.paymongo.com/v1');
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
     * Create a refund for a payment; the refund resource, or null on ANY
     * non-success. Callers that act on failure must use createRefundOutcome:
     * null does not mean PayMongo did not create the refund.
     */
    public function createRefund(string $paymentId, int $amountInCents, string $reason = '', ?string $idempotencyKey = null): ?array
    {
        $outcome = $this->createRefundOutcome($paymentId, $amountInCents, $reason, $idempotencyKey);

        return $outcome['outcome'] === self::REFUND_CREATED ? $outcome['data'] : null;
    }

    /** PayMongo returned the refund (it exists). */
    public const REFUND_CREATED = 'created';

    /** PayMongo definitively refused: the response proves no refund was created. */
    public const REFUND_REJECTED = 'rejected';

    /**
     * Unknown whether PayMongo created the refund (timeout, connection failure,
     * 5xx, 429, 408, 409, or a response we cannot read). NEVER retry the
     * create on this: PayMongo ignores Idempotency-Key on refunds (verified
     * live in test mode 2026-11-12), so a second POST can refund twice.
     */
    public const REFUND_UNCERTAIN = 'uncertain';

    /**
     * Create a refund and classify the result conservatively.
     *
     * @return array{outcome: string, data: ?array, http_status: ?int, error: ?string}
     */
    public function createRefundOutcome(string $paymentId, int $amountInCents, string $reason = '', ?string $idempotencyKey = null): array
    {
        $result = fn (string $outcome, ?array $data = null, ?int $status = null, ?string $error = null) => [
            'outcome' => $outcome, 'data' => $data, 'http_status' => $status, 'error' => $error,
        ];

        if (! $this->isConfigured()) {
            // Nothing was sent, so nothing can have been created.
            return $result(self::REFUND_REJECTED, error: 'PayMongo is not configured.');
        }

        try {
            // Documented "Create a Refund" (docs.paymongo.com, read 2026-11-11):
            // POST /refunds with amount, payment_id and a reason from a fixed
            // list; our free-text reason travels in `notes`. (Previously this
            // posted to an undocumented /payments/{id}/refunds path without
            // payment_id and with a free-text reason.)
            $attributes = [
                'amount' => $amountInCents,
                'payment_id' => $paymentId,
                'reason' => self::refundReason($reason),
            ];
            if (trim($reason) !== '') {
                $attributes['notes'] = mb_substr($reason, 0, 255);
            }
            if ($idempotencyKey) {
                $attributes['metadata'] = ['local_refund_key' => $idempotencyKey];
            }

            // The header is still sent, but PayMongo does NOT honour it on
            // refunds (a repeated POST with the same key created a second
            // refund, test mode 2026-11-12). The guarantee is ours: one POST
            // per local "requested" refund. The key also travels in metadata,
            // which PayMongo echoes — that is how a lost refund is found.
            $headers = $this->headers() + ($idempotencyKey ? ['Idempotency-Key' => $idempotencyKey] : []);
            $response = Http::withHeaders($headers)
                ->timeout(15)
                ->post('https://api.paymongo.com/v1/refunds', ['data' => ['attributes' => $attributes]]);
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            // Timeout / connection failure: the request may have reached PayMongo.
            Log::warning('PayMongo createRefund outcome uncertain (connection): '.$e->getMessage());

            return $result(self::REFUND_UNCERTAIN, error: 'No response from PayMongo: '.$e->getMessage());
        } catch (\Throwable $e) {
            Log::error('PayMongo createRefund outcome uncertain (exception): '.$e->getMessage());

            return $result(self::REFUND_UNCERTAIN, error: $e->getMessage());
        }

        $status = $response->status();
        $body = $response->json();
        $data = is_array($body) ? ($body['data'] ?? null) : null;

        if ($response->successful()) {
            return is_array($data) && ! empty($data['id'])
                ? $result(self::REFUND_CREATED, $data, $status)
                : $result(self::REFUND_UNCERTAIN, null, $status, 'PayMongo answered without a refund id.');
        }

        $errors = is_array($body) ? collect($body['errors'] ?? [])->filter(fn ($e) => is_array($e)) : collect();
        $detail = $errors->map(fn ($e) => trim(($e['code'] ?? '').' '.($e['detail'] ?? '')))->filter()->implode('; ');

        Log::warning('PayMongo createRefund failed', ['status' => $status, 'body' => $body]);

        // Only a client error that PayMongo explained in its error format
        // proves the refund was refused. Rate limits, timeouts, conflicts,
        // server errors and unreadable bodies stay uncertain.
        $definite = $status >= 400 && $status < 500
            && ! in_array($status, [408, 409, 425, 429], true)
            && $errors->isNotEmpty();

        return $result($definite ? self::REFUND_REJECTED : self::REFUND_UNCERTAIN, null, $status, $detail !== '' ? $detail : "HTTP {$status}");
    }

    /**
     * Retrieve a payment (documented GET /v1/payments/{id}). Its attributes
     * list the payment's refunds with their metadata (seen live 2026-11-12),
     * which is how a refund whose create response was lost is found by our
     * local key — without ever creating another.
     */
    public function retrievePayment(string $paymentId): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            $response = Http::withHeaders($this->headers())
                ->timeout(10)
                ->get("https://api.paymongo.com/v1/payments/{$paymentId}");

            return $response->successful() ? $response->json('data') : null;
        } catch (\Throwable $e) {
            Log::error('PayMongo retrievePayment exception: '.$e->getMessage());

            return null;
        }
    }

    /**
     * PayMongo accepts only these refund reasons: duplicate, fraudulent,
     * requested_by_customer, others. Our reasons are free text (kept in notes).
     */
    public static function refundReason(string $text): string
    {
        $t = strtolower($text);

        return match (true) {
            str_contains($t, 'duplicate') => 'duplicate',
            str_contains($t, 'fraud') => 'fraudulent',
            (bool) preg_match('/cancel|changed|tourist|customer|requested|no rider|not delivered|timeout|unavailable/', $t) => 'requested_by_customer',
            default => 'others',
        };
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
     * Verify PayMongo webhook signature.
     *
     * PayMongo sends a signature header for webhook verification.
     */
    public function verifyWebhookSignature(string $payload, string $signatureHeader): bool
    {
        if (empty($this->webhookSecret)) {
            // Only local development / the test suite may run without a
            // secret. Anywhere else (production, staging) fail CLOSED: an
            // unsigned "paid" event could otherwise mark an order paid with
            // no money received (checkout ids are visible to the payer).
            if (app()->environment(['local', 'testing'])) {
                Log::warning('PayMongo webhook secret not configured — skipping signature verification (local/testing only).');

                return true;
            }

            Log::error('PayMongo webhook rejected: PAYMONGO_WEBHOOK_SECRET is not configured.');

            return false;
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
            // Never log the expected HMAC: it would let anyone reading the
            // logs replay a valid signature for this payload.
            Log::warning('PayMongo webhook signature mismatch', [
                'timestamp' => $timestamp,
            ]);
        }

        return $valid;
    }
}
