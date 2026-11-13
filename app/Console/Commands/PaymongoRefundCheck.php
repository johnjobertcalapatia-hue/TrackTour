<?php

namespace App\Console\Commands;

use App\Services\PaymongoService;
use Illuminate\Console\Command;
use Illuminate\Http\Client\Events\ResponseReceived;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Stage 6 follow-up: verify the documented refund call against PayMongo TEST
 * mode, and whether the same Idempotency-Key ever produces a second refund.
 *
 * Uses the app's own PaymongoService::createRefund (the code path real refunds
 * take). It refunds only PART of the payment, so a duplicate request without
 * idempotency WOULD succeed — the second call with the same key is a real test.
 *
 * Test keys only (sk_test_…); refuses live keys and production. Never prints
 * the key. Writes nothing to the database.
 *
 * KNOWN PAYMONGO BEHAVIOUR (verified 2026-11-12, two runs): the repeated
 * request with the same Idempotency-Key CREATED A SECOND REFUND each time
 * (pay_uhaKcjePwYRj1xyMgFyhSnyq, pay_MvERY9gocmcwEKkK5wyYhEnr — four ₱20
 * refunds, all succeeded). The "repeat" check is therefore expected to FAIL,
 * and every run leaves a duplicate refund in test mode. TrackTour does not
 * rely on the header: one POST per local "requested" refund, uncertain
 * outcomes are never re-sent, and lost refunds are found by metadata key.
 * The command refuses to run without --accept-duplicate-refund.
 */
class PaymongoRefundCheck extends Command
{
    protected $signature = 'paymongo:refund-check
        {--payment= : Use an existing TEST payment id (pay_…) instead of creating one}
        {--card : Create the payment with PayMongo\'s test card (no browser step) instead of GCash}
        {--amount=100 : Payment amount in pesos when creating one}
        {--refund=20 : Refund amount in pesos (keep it below the payment amount)}
        {--wait=300 : Seconds to wait for you to authorize the GCash test payment}
        {--accept-duplicate-refund : Required: PayMongo is known to create a duplicate refund on the repeat (test mode)}';

    protected $description = 'PayMongo TEST mode: refund once, repeat with the same idempotency key, confirm no second refund';

    private const API = 'https://api.paymongo.com/v1';

    private ?Response $last = null;

    public function handle(PaymongoService $paymongo): int
    {
        $key = (string) config('services.paymongo.secret_key');
        if (app()->environment('production')) {
            $this->error('Refused: this check never runs in production.');

            return self::FAILURE;
        }
        if (! str_starts_with($key, 'sk_test_')) {
            $this->error('Refused: PAYMONGO_SECRET_KEY must be a TEST key (sk_test_…). '
                .($key === '' ? 'It is not set.' : 'The configured key is not a test key.')
                .' Set it in your local .env, then run php artisan config:clear.');

            return self::FAILURE;
        }

        if (! $this->option('accept-duplicate-refund')) {
            $this->error('Refused: PayMongo is known to ignore Idempotency-Key on refunds (verified 2026-11-12), so this check '
                .'creates a duplicate test-mode refund every run. The result is already recorded in docs/secure-transaction-audit.md. '
                .'Re-run with --accept-duplicate-refund only if you deliberately want to re-test that behaviour.');

            return self::FAILURE;
        }

        $amount = (int) round((float) $this->option('amount') * 100);
        $refund = (int) round((float) $this->option('refund') * 100);
        if ($refund <= 0 || ($this->option('payment') === null && $refund >= $amount)) {
            $this->error('Refund must be more than 0 and less than the payment amount (a partial refund is what makes the repeat a real test).');

            return self::FAILURE;
        }

        // Capture each PayMongo response so a refused call shows PayMongo's reason.
        Event::listen(ResponseReceived::class, fn (ResponseReceived $e) => $this->last = $e->response);

        $paymentId = $this->option('payment') ?: $this->createTestPayment($paymongo, $amount);
        if (! $paymentId) {
            return self::FAILURE;
        }
        $this->line("Payment: <info>{$paymentId}</info>");

        $idempotencyKey = 'tt-refund-check-'.Str::uuid();
        $reason = 'TrackTour test-mode refund check (requested by customer)';
        $this->line("Idempotency key: {$idempotencyKey}");

        // 1. One refund.
        $first = $paymongo->createRefund($paymentId, $refund, $reason, $idempotencyKey);
        if (! $first) {
            $this->error('Refund 1 was refused by PayMongo: '.$this->lastError());

            return self::FAILURE;
        }
        $this->line('Refund 1: <info>'.$first['id'].'</info> status '.($first['attributes']['status'] ?? '?')
            .', ₱'.number_format(($first['attributes']['amount'] ?? 0) / 100, 2));

        // 2. The same request, same key.
        $second = $paymongo->createRefund($paymentId, $refund, $reason, $idempotencyKey);
        $secondNote = $second
            ? 'Refund 2: '.$second['id'].' status '.($second['attributes']['status'] ?? '?')
            : 'Refund 2 was refused by PayMongo: '.$this->lastError();
        $this->line($secondNote);

        // 3. Confirm on the provider.
        $retrieved = $paymongo->retrieveRefund($first['id']);
        $payment = $this->get("/payments/{$paymentId}");
        $providerRefunds = $payment['attributes']['refunds'] ?? null;
        $count = is_array($providerRefunds) ? count($providerRefunds) : null;

        $sameId = $second && $second['id'] === $first['id'];
        $noSecond = $second === null || $sameId;
        $countOk = $count === null || $count === 1;

        $this->newLine();
        $this->table(['Check', 'Result'], [
            ['Refund created through POST /v1/refunds', 'PASS ('.$first['id'].')'],
            ['Refund retrievable via GET /v1/refunds/{id}', $retrieved ? 'PASS (status '.($retrieved['attributes']['status'] ?? '?').')' : 'FAIL'],
            ['Same key repeated → no second refund', match (true) {
                $sameId => 'PASS (PayMongo returned the same refund)',
                $second === null => 'PASS (PayMongo refused the repeat)',
                default => 'FAIL (a second refund '.$second['id'].' was created)',
            }],
            ['Refunds on the payment at PayMongo', $count === null ? 'not listed by the API — check the dashboard' : ($countOk ? "PASS ({$count})" : "FAIL ({$count})")],
        ]);
        $this->line('Confirm in the PayMongo dashboard (TEST mode) → Payments → '.$paymentId.': exactly one refund of ₱'.number_format($refund / 100, 2).'.');
        if (! $noSecond || ! $countOk) {
            $this->warn('Known PayMongo behaviour (2026-11-12): refunds ignore Idempotency-Key. TrackTour prevents duplicates itself (one POST per refund; uncertain outcomes are never re-sent).');
        }

        return ($retrieved && $noSecond && $countOk) ? self::SUCCESS : self::FAILURE;
    }

    /** Create and authorize a TEST payment; returns its pay_… id. */
    private function createTestPayment(PaymongoService $paymongo, int $amount): ?string
    {
        $card = (bool) $this->option('card');
        $intent = $paymongo->createPaymentIntent([
            'amount' => $amount,
            'payment_method_allowed' => [$card ? 'card' : 'gcash'],
            'description' => 'TrackTour refund check (test mode)',
            'metadata' => ['purpose' => 'refund_check'],
        ]);
        if (! $intent) {
            $this->error('Could not create the payment intent: '.$this->lastError());

            return null;
        }

        // PayMongo's documented test card that succeeds without 3-D Secure.
        $method = $this->post('/payment_methods', $card
            ? ['type' => 'card', 'details' => ['card_number' => '4343434343434345', 'exp_month' => 12, 'exp_year' => (int) date('Y') + 2, 'cvc' => '123']]
            : ['type' => 'gcash']);
        if (! $method) {
            $this->error('Could not create the payment method: '.$this->lastError());

            return null;
        }

        $attached = $this->post("/payment_intents/{$intent['id']}/attach", array_filter([
            'payment_method' => $method['id'],
            'return_url' => $card ? null : rtrim((string) config('app.url'), '/').'/',
        ]));
        if (! $attached) {
            $this->error('Could not attach the payment method: '.$this->lastError());

            return null;
        }

        if (! $card && ($attached['attributes']['status'] ?? null) === 'awaiting_next_action') {
            $this->warn('Open this GCash TEST page and click "Authorize Test Payment":');
            $this->line($attached['attributes']['next_action']['redirect']['url'] ?? '(no redirect URL returned)');
            $this->line('Waiting up to '.(int) $this->option('wait').' seconds…');
        }

        $deadline = time() + (int) $this->option('wait');
        do {
            $current = $paymongo->retrievePaymentIntent($intent['id']) ?? $attached;
            $status = $current['attributes']['status'] ?? null;
            if ($status === 'succeeded') {
                $payId = $current['attributes']['payments'][0]['id'] ?? null;
                if (! $payId) {
                    $this->error('The payment succeeded but PayMongo returned no payment id.');
                }

                return $payId;
            }
            // After attaching, falling back to awaiting_payment_method means the
            // test payment failed ("Fail Test Payment" or a declined card).
            if (in_array($status, ['awaiting_payment_method', 'cancelled'], true)) {
                $this->error("The test payment did not succeed (status {$status}). Run the command again.");

                return null;
            }
            if (time() < $deadline) {
                sleep(3);
            }
        } while (time() < $deadline);

        $this->error('Timed out waiting for the test payment authorization.');

        return null;
    }

    private function post(string $path, array $attributes): ?array
    {
        $response = $this->client()->post(self::API.$path, ['data' => ['attributes' => $attributes]]);

        return $response->successful() ? $response->json('data') : null;
    }

    private function get(string $path): ?array
    {
        $response = $this->client()->get(self::API.$path);

        return $response->successful() ? $response->json('data') : null;
    }

    private function client()
    {
        return Http::withBasicAuth((string) config('services.paymongo.secret_key'), '')
            ->acceptJson()->asJson()->timeout(15);
    }

    /** PayMongo's error detail for the last call (never contains the key). */
    private function lastError(): string
    {
        if (! $this->last) {
            return 'no response (network?)';
        }
        $details = collect($this->last->json('errors') ?? [])->map(fn ($e) => trim(($e['code'] ?? '').' '.($e['detail'] ?? '')))->filter()->implode('; ');

        return 'HTTP '.$this->last->status().($details !== '' ? " — {$details}" : '');
    }
}
