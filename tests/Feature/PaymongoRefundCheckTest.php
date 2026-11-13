<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * paymongo:refund-check — the test-mode verification of the documented refund
 * call and its idempotency key. Every PayMongo call is faked here.
 */
class PaymongoRefundCheckTest extends TestCase
{
    /** @var list<Request> */
    private array $refundPosts = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.paymongo.secret_key' => 'sk_test_fake_for_tests']);
    }

    /** Fake a card payment flow; $secondRefund decides what the repeat returns. */
    private function fakePaymongo(callable $secondRefund, int $refundsOnPayment = 1): void
    {
        Http::fake(function (Request $request) use ($secondRefund, $refundsOnPayment) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            $method = $request->method();

            return match (true) {
                $method === 'POST' && $path === '/v1/payment_intents' => Http::response(['data' => ['id' => 'pi_1', 'attributes' => ['status' => 'awaiting_payment_method']]]),
                $method === 'POST' && $path === '/v1/payment_methods' => Http::response(['data' => ['id' => 'pm_1']]),
                $method === 'POST' && $path === '/v1/payment_intents/pi_1/attach' => Http::response(['data' => ['id' => 'pi_1', 'attributes' => ['status' => 'succeeded']]]),
                $method === 'GET' && $path === '/v1/payment_intents/pi_1' => Http::response(['data' => ['id' => 'pi_1', 'attributes' => ['status' => 'succeeded', 'payments' => [['id' => 'pay_1']]]]]),
                $method === 'POST' && $path === '/v1/refunds' => (function () use ($request, $secondRefund) {
                    $this->refundPosts[] = $request;

                    return count($this->refundPosts) === 1
                        ? Http::response(['data' => ['id' => 'ref_1', 'attributes' => ['status' => 'pending', 'amount' => 2000]]])
                        : $secondRefund();
                })(),
                $method === 'GET' && $path === '/v1/refunds/ref_1' => Http::response(['data' => ['id' => 'ref_1', 'attributes' => ['status' => 'succeeded']]]),
                $method === 'GET' && $path === '/v1/payments/pay_1' => Http::response(['data' => ['id' => 'pay_1', 'attributes' => ['refunds' => array_fill(0, $refundsOnPayment, ['id' => 'ref'])]]]),
                default => Http::response(['errors' => [['detail' => "unexpected {$method} {$path}"]]], 404),
            };
        });
    }

    public function test_refuses_to_run_without_accepting_the_known_duplicate(): void
    {
        Http::fake();

        $this->artisan('paymongo:refund-check', ['--card' => true])
            ->expectsOutputToContain('known to ignore Idempotency-Key')
            ->assertFailed();

        Http::assertNothingSent();
    }

    public function test_refuses_a_live_key_without_calling_paymongo(): void
    {
        config(['services.paymongo.secret_key' => 'sk_live_not_allowed']);
        Http::fake();

        $this->artisan('paymongo:refund-check', ['--card' => true, '--accept-duplicate-refund' => true])
            ->expectsOutputToContain('must be a TEST key')
            ->doesntExpectOutputToContain('sk_live_not_allowed')
            ->assertFailed();

        Http::assertNothingSent();
    }

    public function test_refuses_a_full_refund_because_the_repeat_would_prove_nothing(): void
    {
        Http::fake();

        $this->artisan('paymongo:refund-check', ['--card' => true, '--amount' => 100, '--refund' => 100, '--accept-duplicate-refund' => true])
            ->expectsOutputToContain('less than the payment amount')
            ->assertFailed();

        Http::assertNothingSent();
    }

    public function test_same_refund_returned_for_the_repeated_key_passes(): void
    {
        $this->fakePaymongo(fn () => Http::response(['data' => ['id' => 'ref_1', 'attributes' => ['status' => 'pending']]]));

        $this->artisan('paymongo:refund-check', ['--card' => true, '--accept-duplicate-refund' => true])
            ->expectsOutputToContain('PASS (PayMongo returned the same refund)')
            ->assertSuccessful();

        // Both calls: the documented endpoint, payment_id, a partial amount and the SAME key.
        $this->assertCount(2, $this->refundPosts);
        [$a, $b] = $this->refundPosts;
        $this->assertSame($a->header('Idempotency-Key'), $b->header('Idempotency-Key'));
        $this->assertStringStartsWith('tt-refund-check-', $a->header('Idempotency-Key')[0]);
        $this->assertSame('pay_1', $a['data']['attributes']['payment_id']);
        $this->assertSame(2000, $a['data']['attributes']['amount']);
        $this->assertSame('requested_by_customer', $a['data']['attributes']['reason']);
    }

    public function test_a_refused_repeat_also_passes(): void
    {
        $this->fakePaymongo(fn () => Http::response(['errors' => [['code' => 'idempotency_conflict', 'detail' => 'Duplicate request.']]], 409));

        $this->artisan('paymongo:refund-check', ['--card' => true, '--accept-duplicate-refund' => true])
            ->expectsOutputToContain('HTTP 409')
            ->expectsOutputToContain('PASS (PayMongo refused the repeat)')
            ->assertSuccessful();
    }

    public function test_a_second_refund_for_the_same_key_fails_the_check(): void
    {
        $this->fakePaymongo(fn () => Http::response(['data' => ['id' => 'ref_2', 'attributes' => ['status' => 'pending']]]), refundsOnPayment: 2);

        $this->artisan('paymongo:refund-check', ['--card' => true, '--accept-duplicate-refund' => true])
            ->expectsOutputToContain('FAIL (a second refund ref_2 was created)')
            ->assertFailed();
    }
}
