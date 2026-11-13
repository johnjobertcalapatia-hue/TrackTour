<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\User;
use App\Services\PaymentRefundProcessor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * PayMongo ignores Idempotency-Key on refunds (live test mode, 2026-11-12):
 * a second POST /v1/refunds creates a second refund. So a create whose
 * outcome is UNCERTAIN (timeout, connection failure, 5xx, 429, unreadable
 * answer) must never be treated as failed or re-sent. It stays "requested"
 * (reserved, blocking), is escalated, and reconciliation finds it by our key
 * in the refund metadata on the payment. Only a definite PayMongo rejection
 * releases the reservation.
 */
class RefundUncertainOutcomeTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private Order $order;
    private Payment $payment;
    /** @var array<string, OrderItem> */
    private array $items = [];

    private int $posts = 0;
    /** @var list<string> idempotency keys PayMongo received */
    private array $keys = [];
    /** How POST /v1/refunds answers (gets the request key). */
    private ?\Closure $onPost = null;
    /** What GET /v1/payments/pay_unc lists as refunds (null = unreachable). */
    private ?\Closure $providerRefunds = null;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.paymongo.secret_key' => 'sk_test_uncertain', 'services.paymongo.webhook_secret' => '']);

        Http::fake(function (HttpRequest $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            if ($request->method() === 'POST' && $path === '/v1/refunds') {
                $this->posts++;
                $key = $request->header('Idempotency-Key')[0] ?? '';
                $this->keys[] = $key;

                return ($this->onPost)($key);
            }
            if ($request->method() === 'GET' && $path === '/v1/payments/pay_unc') {
                $refunds = $this->providerRefunds ? ($this->providerRefunds)() : null;

                return $refunds === null
                    ? Http::response(null, 503)
                    : Http::response(['data' => ['id' => 'pay_unc', 'type' => 'payment', 'attributes' => ['amount' => 10000, 'status' => 'paid', 'refunds' => $refunds]]]);
            }

            return Http::response(['errors' => [['detail' => "unexpected {$request->method()} {$path}"]]], 404);
        });

        $this->tourist = User::create(['email' => 'uncertain@test.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $business = Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Uncertain Grill',
            'status' => 'approved',
        ]);
        $this->order = Order::create([
            'order_number' => 'TT-UNC1', 'business_id' => $business->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'Uncertain Tourist', 'customer_email' => 'uncertain@test.com', 'customer_phone' => '09123456789',
            'order_type' => 'pickup', 'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'waiting_restaurant',
            'subtotal' => 100, 'delivery_fee' => 0, 'discount' => 0, 'total' => 100, 'paid_amount' => 100,
        ]);
        foreach (['a' => 20, 'b' => 80] as $key => $price) {
            $this->items[$key] = OrderItem::create(['order_id' => $this->order->id, 'business_id' => $business->id, 'product_name' => "Item {$key}", 'quantity' => 1, 'unit_price' => $price, 'subtotal' => $price, 'status' => 'pending']);
        }
        $this->payment = Payment::create([
            'payment_number' => 'PAY-UNC1', 'payable_type' => Order::class, 'payable_id' => $this->order->id, 'user_id' => $this->tourist->id,
            'amount' => 100, 'currency' => 'PHP', 'method' => 'gcash', 'provider' => 'paymongo',
            'provider_payment_id' => 'cs_unc', 'provider_source_id' => 'pay_unc', 'status' => 'paid', 'paid_at' => now(),
        ]);
    }

    private function refundItemA(): array
    {
        return app(PaymentRefundProcessor::class)->initiateRefund($this->payment->fresh(), 20.0, 'Item unavailable', $this->order, $this->items['a']->id, $this->tourist->id);
    }

    private function remaining(): float
    {
        return app(PaymentRefundProcessor::class)->refundTotals($this->payment->fresh())['remaining'];
    }

    /** A refund resource as PayMongo lists it on the payment. */
    private function providerRefund(string $id, string $status, string $key, int $amount = 2000): array
    {
        return ['id' => $id, 'type' => 'refund', 'attributes' => [
            'amount' => $amount, 'currency' => 'PHP', 'payment_id' => 'pay_unc', 'status' => $status,
            'reason' => 'requested_by_customer', 'metadata' => ['local_refund_key' => $key],
        ]];
    }

    /** The request is held: still requested, unlinked, reserving ₱20, not refunded, escalated. */
    private function assertHeld(Refund $row): void
    {
        $row->refresh();
        $this->assertSame('requested', $row->status);
        $this->assertNull($row->provider_refund_id);
        $this->assertEquals(80, $this->remaining(), 'its ₱20 stays reserved');
        $this->assertSame('paid', $this->payment->fresh()->status);
        $this->assertEquals(0, (float) $this->order->fresh()->refunded_amount, 'nothing reported as refunded');
    }

    public function test_a_timeout_after_paymongo_created_the_refund_is_held_then_found_by_its_key(): void
    {
        // PayMongo creates the refund, but our connection times out first.
        $this->onPost = fn () => throw new \Illuminate\Http\Client\ConnectionException('cURL error 28: Operation timed out after 15001 milliseconds');

        $result = $this->refundItemA();

        $this->assertSame('pending', $result['status']);
        $this->assertTrue($result['uncertain']);
        $row = Refund::firstOrFail();
        $this->assertHeld($row);
        $this->assertSame('pending', $this->order->fresh()->refund_status);
        $this->assertArrayHasKey('provider_uncertain', $row->metadata);
        $this->assertSame(1, ActivityLog::where('action', 'escalation.refund_provider_uncertain')->count());

        // Asking again for the same refund never reaches PayMongo.
        $this->assertSame('in_flight', $this->refundItemA()['status']);
        $this->assertSame(1, $this->posts);

        // Reconciliation finds it on the payment by our key and links it.
        $key = $this->keys[0];
        $this->providerRefunds = fn () => [$this->providerRefund('ref_lost', 'succeeded', $key)];
        $this->travel(2)->minutes();
        $this->artisan('payments:reconcile-refunds')->expectsOutputToContain('found at PayMongo by its key')->assertSuccessful();

        $row->refresh();
        $this->assertSame('ref_lost', $row->provider_refund_id);
        $this->assertSame('succeeded', $row->status);
        $this->assertEquals(20, (float) $this->order->fresh()->refunded_amount);
        $this->assertSame('paid', $this->payment->fresh()->status, 'a ₱20 refund of ₱100 stays paid');
        $this->assertEquals(80, $this->remaining());
        $this->assertSame(1, $this->posts, 'never a second POST /v1/refunds');
    }

    public function test_a_connection_failure_is_held_not_failed(): void
    {
        $this->onPost = fn () => throw new \Illuminate\Http\Client\ConnectionException('cURL error 6: Could not resolve host: api.paymongo.com');

        $this->assertSame('pending', $this->refundItemA()['status']);
        $this->assertHeld(Refund::firstOrFail());
        $this->assertSame('in_flight', $this->refundItemA()['status']);
        $this->assertSame(1, $this->posts);
    }

    public static function uncertainResponses(): array
    {
        return [
            '500' => [500, ['errors' => [['detail' => 'Internal error']]]],
            '502' => [502, null],
            '503' => [503, null],
            '504' => [504, null],
            '429 rate limited' => [429, ['errors' => [['code' => 'rate_limit', 'detail' => 'Too many requests']]]],
            '408 timeout' => [408, null],
            '409 conflict' => [409, ['errors' => [['detail' => 'Conflict']]]],
            '400 without a PayMongo error body' => [400, null],
            '200 without a refund id' => [200, ['data' => null]],
        ];
    }

    #[DataProvider('uncertainResponses')]
    public function test_ambiguous_answers_are_held_and_never_resent(int $status, ?array $body): void
    {
        $this->onPost = fn () => Http::response($body, $status);

        $this->assertSame('pending', $this->refundItemA()['status']);
        $this->assertHeld(Refund::firstOrFail());

        // Neither a repeat nor a larger refund that would need the reserved ₱20.
        $this->assertSame('in_flight', $this->refundItemA()['status']);
        $this->assertSame('exceeds_remaining', app(PaymentRefundProcessor::class)->initiateRefund($this->payment->fresh(), 81.0, 'x', $this->order, $this->items['b']->id)['status']);
        $this->assertSame(1, $this->posts);
    }

    public function test_a_definite_rejection_fails_the_refund_and_releases_its_reservation(): void
    {
        $this->onPost = fn () => Http::response(['errors' => [['code' => 'parameter_invalid', 'detail' => 'The payment cannot be refunded.']]], 400);

        $this->assertSame('provider_error', $this->refundItemA()['status']);

        $row = Refund::firstOrFail();
        $this->assertSame('failed', $row->status);
        $this->assertSame(400, $row->metadata['provider_rejected']['http_status']);
        $this->assertEquals(100, $this->remaining(), 'the reservation is released');
        $this->assertSame('paid', $this->payment->fresh()->status);
        $this->assertSame('failed', $this->order->fresh()->refund_status);
        $this->assertSame(0, ActivityLog::where('action', 'escalation.refund_provider_uncertain')->count());

        // PayMongo proved nothing was created, so a retry is a safe new request.
        $this->onPost = fn ($key) => Http::response(['data' => ['id' => 'ref_retry', 'type' => 'refund', 'attributes' => ['status' => 'succeeded', 'amount' => 2000]]]);
        $this->assertSame('succeeded', $this->refundItemA()['status']);
        $this->assertSame(2, $this->posts);
        $this->assertEquals(20, (float) $this->order->fresh()->refunded_amount);
    }

    public function test_no_matching_refund_keeps_it_held_and_escalated_without_a_retry(): void
    {
        $this->onPost = fn () => Http::response(null, 503);
        $this->refundItemA();
        $row = Refund::firstOrFail();

        // PayMongo lists a refund, but not ours (different key).
        $this->providerRefunds = fn () => [$this->providerRefund('ref_someone_else', 'succeeded', 'another-key')];
        $this->travel(2)->minutes();
        $this->artisan('payments:reconcile-refunds')->expectsOutputToContain('will not be retried')->assertSuccessful();
        $this->travel(15)->minutes();
        $this->artisan('payments:reconcile-refunds')->assertSuccessful();

        $this->assertHeld($row);
        $this->assertSame(1, $this->posts, 'absence of a match never authorises a retry');
        $this->assertSame(1, ActivityLog::where('action', 'escalation.refund_provider_uncertain')->count(), 'escalated once');
        $this->assertSame(0, ActivityLog::where('action', 'escalation.refund_requested_unconfirmed')->count(), 'not escalated twice');
    }

    public function test_paymongo_unreachable_during_reconciliation_changes_nothing(): void
    {
        $this->onPost = fn () => Http::response(null, 500);
        $this->refundItemA();

        $this->providerRefunds = null; // GET /payments answers 503
        $this->travel(2)->minutes();
        $this->artisan('payments:reconcile-refunds')->expectsOutputToContain('could not be asked')->assertSuccessful();

        $this->assertHeld(Refund::firstOrFail());
        $this->assertSame(1, $this->posts);
    }

    public function test_a_request_still_in_its_own_call_is_not_reconciled_yet(): void
    {
        $this->onPost = fn () => Http::response(null, 500);
        $this->refundItemA();
        $this->providerRefunds = fn () => [$this->providerRefund('ref_early', 'succeeded', $this->keys[0])];

        $this->artisan('payments:reconcile-refunds')->assertSuccessful(); // < 1 minute old

        $this->assertNull(Refund::firstOrFail()->provider_refund_id);
        Http::assertNotSent(fn (HttpRequest $r) => str_contains($r->url(), '/v1/payments/'));
    }

    public function test_a_refund_paymongo_duplicated_is_linked_once_and_escalated(): void
    {
        $this->onPost = fn () => Http::response(null, 502);
        $this->refundItemA();
        $key = $this->keys[0];
        $this->providerRefunds = fn () => [
            $this->providerRefund('ref_dup_1', 'succeeded', $key),
            $this->providerRefund('ref_dup_2', 'succeeded', $key),
        ];

        $this->travel(2)->minutes();
        $this->artisan('payments:reconcile-refunds')->assertSuccessful();

        $this->assertSame('ref_dup_1', Refund::firstOrFail()->provider_refund_id);
        $this->assertSame(1, Refund::count());
        $this->assertEquals(20, (float) $this->order->fresh()->refunded_amount, 'counted once');
        $this->assertSame(1, ActivityLog::where('action', 'escalation.refund_duplicated_at_provider')->count());
        $this->assertSame(1, $this->posts);
    }
}
