<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
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
use Tests\TestCase;

/**
 * Partial refunds (owner-approved 2026-11-12, no new status values):
 * a payment / order becomes 'refunded' only when PayMongo refunds total the
 * amount paid; until then it stays 'paid' with the running refunded_amount.
 * Remaining refundable = paid − succeeded − in flight, reserved under the
 * payment row lock. Failed refunds release their reservation.
 */
class PartialRefundTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private Business $business;
    private Order $order;
    private Payment $payment;
    /** @var array<string, OrderItem> */
    private array $items = [];

    /** PayMongo refund statuses returned by successive create calls. */
    private array $script = [];
    private int $calls = 0;
    /** Runs inside the PayMongo call (to interleave a concurrent request). */
    private ?\Closure $duringCall = null;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.paymongo.secret_key' => 'sk_test_partial', 'services.paymongo.webhook_secret' => '']);

        Http::fake(function (HttpRequest $request) {
            if ($request->method() !== 'POST' || ! str_ends_with(parse_url($request->url(), PHP_URL_PATH), '/v1/refunds')) {
                return Http::response(['errors' => [['detail' => 'unexpected']]], 404);
            }
            $this->calls++;
            $n = $this->calls;
            if ($this->duringCall) {
                $during = $this->duringCall;
                $this->duringCall = null;
                $during();
            }

            return Http::response(['data' => ['id' => "ref_part_{$n}", 'type' => 'refund', 'attributes' => [
                'status' => array_shift($this->script) ?? 'succeeded',
                'amount' => $request['data']['attributes']['amount'],
                'payment_id' => $request['data']['attributes']['payment_id'],
            ]]]);
        });

        $this->tourist = User::create(['email' => 'partial@test.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Partial Grill',
            'status' => 'approved',
        ]);
        $this->order = Order::create([
            'order_number' => 'TT-PART1',
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => 'Partial Tourist',
            'customer_email' => 'partial@test.com',
            'customer_phone' => '09123456789',
            'order_type' => 'pickup',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'waiting_restaurant',
            'subtotal' => 100,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => 100,
            'paid_amount' => 100,
        ]);
        foreach (['a' => 20, 'b' => 30, 'c' => 50] as $key => $price) {
            $this->items[$key] = OrderItem::create(['order_id' => $this->order->id, 'business_id' => $this->business->id, 'product_name' => "Item {$key}", 'quantity' => 1, 'unit_price' => $price, 'subtotal' => $price, 'status' => 'pending']);
        }
        $this->payment = Payment::create([
            'payment_number' => 'PAY-PART1',
            'payable_type' => Order::class,
            'payable_id' => $this->order->id,
            'user_id' => $this->tourist->id,
            'amount' => 100,
            'currency' => 'PHP',
            'method' => 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'cs_part',
            'provider_source_id' => 'pay_part',
            'status' => 'paid',
            'paid_at' => now(),
        ]);
    }

    private function refund(float $amount, ?string $item = null): array
    {
        return app(PaymentRefundProcessor::class)->initiateRefund(
            $this->payment->fresh(), $amount, 'Partial refund test', $this->order,
            $item ? $this->items[$item]->id : null, $this->tourist->id,
        );
    }

    private function remaining(): float
    {
        return app(PaymentRefundProcessor::class)->refundTotals($this->payment->fresh())['remaining'];
    }

    /** Payment status, order payment_status, refunded_amount, remaining. */
    private function assertState(string $status, float $refunded, float $remaining): void
    {
        $order = $this->order->fresh();
        $this->assertSame($status, $this->payment->fresh()->status, 'payment.status');
        $this->assertSame($status, $order->payment_status, 'order.payment_status');
        $this->assertEquals($refunded, (float) $order->refunded_amount, 'order.refunded_amount');
        $this->assertEquals($remaining, $this->remaining(), 'remaining refundable');
    }

    public function test_two_separate_partial_refunds_both_succeed(): void
    {
        $this->assertState('paid', 0, 100);

        $this->assertSame('succeeded', $this->refund(20, 'a')['status']);
        $this->assertState('paid', 20, 80);

        $this->assertSame('succeeded', $this->refund(30, 'b')['status']);
        $this->assertState('paid', 50, 50);

        $this->assertSame(2, $this->calls);
        $this->assertNotSame('cancelled', $this->order->fresh()->status);
    }

    public function test_partial_refunds_eventually_complete_the_full_refund(): void
    {
        $this->refund(20, 'a');
        $this->refund(30, 'b');
        $this->assertSame('succeeded', $this->refund(50, 'c')['status']);

        $this->assertState('refunded', 100, 0);
        $this->assertNotNull($this->payment->fresh()->refunded_at);

        // Nothing left: refused without calling PayMongo.
        $this->assertSame('already_refunded', $this->refund(1)['status']);
        $this->assertSame(3, $this->calls);
    }

    public function test_a_refund_above_the_remaining_amount_is_rejected_without_calling_paymongo(): void
    {
        $this->refund(20, 'a');

        $result = $this->refund(80.01);

        $this->assertSame('exceeds_remaining', $result['status']);
        $this->assertEquals(80, $result['remaining']);
        $this->assertSame(1, $this->calls, 'PayMongo was not called for the rejected refund');
        $this->assertSame(1, Refund::count());
        $this->assertState('paid', 20, 80);

        // Through the tourist endpoint too.
        $this->actingAs($this->tourist)
            ->postJson('/api/payments/PAY-PART1/refund', ['amount' => 9000])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'The refund is more than the ₱80.00 still refundable on this payment.']);
        $this->assertSame(1, $this->calls);
    }

    public function test_an_in_flight_refund_reserves_its_amount(): void
    {
        $this->script = ['pending'];
        $this->assertSame('pending', $this->refund(20, 'a')['status']);

        // Reserved, but not reported as money refunded.
        $this->assertSame('pending_refund', $this->payment->fresh()->status);
        $this->assertEquals(0, (float) $this->order->fresh()->refunded_amount);
        $this->assertEquals(80, $this->remaining());

        $this->assertSame('exceeds_remaining', $this->refund(81, 'b')['status']);
        $this->assertSame(1, $this->calls);

        // Within the remaining balance a separate refund still goes ahead.
        $this->assertSame('succeeded', $this->refund(30, 'b')['status']);
        $this->assertEquals(50, $this->remaining());
        $this->assertSame('pending_refund', $this->payment->fresh()->status, 'the first refund is still with PayMongo');
        $this->assertEquals(30, (float) $this->order->fresh()->refunded_amount);
        $this->assertSame('pending', $this->order->fresh()->refund_status);
    }

    public function test_a_failed_refund_releases_its_reserved_amount(): void
    {
        $this->script = ['pending'];
        $this->refund(20, 'a');
        $this->assertEquals(80, $this->remaining());

        app(PaymentRefundProcessor::class)->applyProviderStatus('ref_part_1', 'failed', 'pay_part');

        $this->assertSame('failed', Refund::where('provider_refund_id', 'ref_part_1')->value('status'));
        $this->assertState('paid', 0, 100);
        $this->assertSame('failed', $this->order->fresh()->refund_status);

        // The whole amount is refundable again.
        $this->assertSame('succeeded', $this->refund(100)['status']);
        $this->assertState('refunded', 100, 0);
    }

    public function test_duplicate_webhooks_do_not_double_count(): void
    {
        $this->script = ['pending'];
        $this->refund(20, 'a');

        $event = fn (string $id) => ['data' => ['id' => $id, 'type' => 'event', 'attributes' => [
            'type' => 'payment.refund.updated',
            'data' => ['id' => 'ref_part_1', 'type' => 'refund', 'attributes' => ['amount' => 2000, 'payment_id' => 'pay_part', 'status' => 'succeeded']],
        ]]];

        $this->postJson('/api/payments/webhook', $event('evt_a'))->assertOk();
        $this->postJson('/api/payments/webhook', $event('evt_a'))->assertOk(); // same event re-delivered
        $this->postJson('/api/payments/webhook', $event('evt_b'))->assertOk(); // another event, same refund
        app(PaymentRefundProcessor::class)->applyProviderStatus('ref_part_1', 'succeeded', 'pay_part'); // reconciliation

        $this->assertState('paid', 20, 80);
        $this->assertSame(1, Refund::count());
    }

    public function test_concurrent_requests_cannot_exceed_the_payment_amount(): void
    {
        // Request B arrives while request A (₱60) is with PayMongo. A's
        // reservation was committed under the payment lock, so B (₱60) sees
        // only ₱40 left and is refused before reaching PayMongo.
        $second = null;
        $this->duringCall = function () use (&$second) {
            $second = $this->refund(60, 'b');
        };

        $first = $this->refund(60, 'a');

        $this->assertSame('succeeded', $first['status']);
        $this->assertSame('exceeds_remaining', $second['status']);
        $this->assertEquals(40, $second['remaining']);
        $this->assertSame(1, $this->calls);
        $this->assertState('paid', 60, 40);
        $this->assertLessThanOrEqual(100, (float) Refund::where('status', 'succeeded')->sum('amount'));
    }

    public function test_a_full_refund_still_works_as_before(): void
    {
        $this->actingAs($this->tourist)->postJson('/api/payments/PAY-PART1/refund')->assertOk()
            ->assertJsonFragment(['status' => 'succeeded', 'amount' => 100]);

        $this->assertState('refunded', 100, 0);
        $order = $this->order->fresh();
        $this->assertSame('refunded', $order->refund_status);
        $this->assertSame('cancelled', $order->status, 'a fully refunded order is cancelled, as before');
        $this->assertSame(1, $this->calls);
    }

    public function test_a_partial_refund_through_the_endpoint_does_not_cancel_the_order(): void
    {
        $this->actingAs($this->tourist)->postJson('/api/payments/PAY-PART1/refund', ['amount' => 2000])->assertOk();

        $this->assertState('paid', 20, 80);
        $this->assertSame('waiting_restaurant', $this->order->fresh()->status);

        // No amount = the rest, which completes the refund.
        $this->actingAs($this->tourist)->postJson('/api/payments/PAY-PART1/refund')->assertOk()
            ->assertJsonFragment(['amount' => 80]);
        $this->assertState('refunded', 100, 0);
    }

    public function test_cancelling_the_order_refunds_only_what_remains(): void
    {
        $this->refund(20, 'a');

        app(\App\Services\OrderRefundService::class)->refundPaidOrder($this->order->fresh(), 'Order rejected by restaurant');

        $this->assertSame(80.0, (float) Refund::where('provider_refund_id', 'ref_part_2')->value('amount'));
        $this->assertState('refunded', 100, 0);
    }

    public function test_no_partial_refund_after_a_rider_accepts(): void
    {
        $rider = User::create(['email' => 'rider-partial@test.com', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        Delivery::create(['order_id' => $this->order->id, 'rider_id' => $rider->id, 'status' => 'picked_up', 'assigned_at' => now(), 'pickup_address' => 'P', 'delivery_address' => 'D', 'rider_commission' => 40]);

        $this->assertSame('blocked_after_acceptance', $this->refund(20, 'a')['status']);
        $this->assertSame(0, $this->calls);
        $this->assertSame(0, Refund::count());
        $this->assertState('paid', 0, 100);
    }
}
