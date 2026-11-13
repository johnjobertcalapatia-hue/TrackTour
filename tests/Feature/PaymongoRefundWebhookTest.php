<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\PaymentWebhookEvent;
use App\Models\Refund;
use App\Models\User;
use App\Services\PaymentRefundProcessor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * PayMongo's documented refund webhook, `payment.refund.updated`, whose data is
 * a refund resource (docs.paymongo.com → Webhooks → Events, read 2026-11-12).
 * Payloads here follow that shape and are signed like PayMongo test mode.
 */
class PaymongoRefundWebhookTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'whsk_test_refund_webhook_secret';

    private User $tourist;
    private Order $order;
    private Payment $payment;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.paymongo.secret_key' => 'sk_test_abc123',
            'services.paymongo.webhook_secret' => self::SECRET,
        ]);

        $this->tourist = User::create([
            'email' => 'refund-webhook@test.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
        $business = Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Refund Webhook Restaurant',
            'business_description' => 'Test',
            'status' => 'approved',
            'latitude' => 12.8667,
            'longitude' => 121.45,
        ]);
        $this->order = Order::create([
            'order_number' => 'ORD-RWH-1',
            'business_id' => $business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => 'Refund Tourist',
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09123456789',
            'order_type' => 'pickup',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'waiting_restaurant',
            'subtotal' => 500,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => 500,
            'paid_amount' => 500,
        ]);
        $this->payment = Payment::create([
            'payment_number' => 'PAY-RWH-1',
            'payable_type' => Order::class,
            'payable_id' => $this->order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500,
            'method' => 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'cs_test_rwh',
            'provider_source_id' => 'pay_test_rwh',
            'status' => 'paid',
            'paid_at' => now(),
        ]);
    }

    /** A refund resource exactly as PayMongo documents it. */
    private function refundResource(string $refundId, string $status, int $amount = 50000, string $paymentId = 'pay_test_rwh', ?string $localKey = null): array
    {
        return [
            'id' => $refundId,
            'type' => 'refund',
            'attributes' => [
                'amount' => $amount,
                'balance_transaction_id' => null,
                'currency' => 'PHP',
                'livemode' => false,
                'metadata' => $localKey ? ['local_refund_key' => $localKey] : null,
                'notes' => 'Order cancelled before a rider accepted',
                'payment_id' => $paymentId,
                'payout_id' => null,
                'reason' => 'requested_by_customer',
                'status' => $status,
                'available_at' => null,
                'created_at' => 1792986084,
                'refunded_at' => $status === 'succeeded' ? 1792986221 : null,
                'updated_at' => 1792986221,
            ],
        ];
    }

    private function event(string $eventId, string $type, array $data): array
    {
        return ['data' => [
            'id' => $eventId,
            'type' => 'event',
            'attributes' => [
                'type' => $type,
                'livemode' => false,
                'data' => $data,
                'previous_data' => [],
                'created_at' => 1792986221,
                'updated_at' => 1792986221,
            ],
        ]];
    }

    /** POST the raw body with a PayMongo test-mode signature (t=…,te=…,li=). */
    private function deliver(array $event, ?string $secret = self::SECRET): TestResponse
    {
        $body = json_encode($event);
        $t = time();
        $sig = hash_hmac('sha256', $t.'.'.$body, $secret);

        return $this->call('POST', '/api/payments/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_PAYMONGO_SIGNATURE' => "t={$t},te={$sig},li=",
        ], $body);
    }

    /** A refund PayMongo already acknowledged as pending (linked by ref id). */
    private function pendingRefund(string $refundId): Refund
    {
        $this->payment->update(['status' => 'pending_refund']);

        return Refund::create([
            'payment_id' => $this->payment->id,
            'order_id' => $this->order->id,
            'payable_type' => Order::class,
            'payable_id' => $this->order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500,
            'original_amount' => 500,
            'refund_deduction' => 0,
            'currency' => 'PHP',
            'reason' => 'Order cancelled',
            'status' => 'pending',
            'provider_refund_id' => $refundId,
            'idempotency_key' => 'key-'.$refundId,
        ]);
    }

    public function test_processing_status_keeps_the_refund_pending(): void
    {
        $refund = $this->pendingRefund('ref_proc');

        $this->deliver($this->event('evt_proc', 'payment.refund.updated', $this->refundResource('ref_proc', 'processing')))->assertOk();

        $this->assertSame('pending', $refund->fresh()->status);
        $this->assertSame('pending_refund', $this->payment->fresh()->status);
        $this->assertNotSame('refunded', $this->order->fresh()->payment_status);
        $this->assertSame($this->payment->id, PaymentWebhookEvent::where('provider_event_id', 'evt_proc')->value('payment_id'));
    }

    public function test_succeeded_status_marks_the_refund_succeeded(): void
    {
        $refund = $this->pendingRefund('ref_ok');

        $this->deliver($this->event('evt_ok', 'payment.refund.updated', $this->refundResource('ref_ok', 'succeeded')))->assertOk();

        $this->assertSame('succeeded', $refund->fresh()->status);
        $this->assertNotNull($refund->fresh()->refunded_at);
        $this->assertSame('refunded', $this->payment->fresh()->status);
        $order = $this->order->fresh();
        $this->assertSame('refunded', $order->refund_status);
        $this->assertSame('ref_ok', $order->paymongo_refund_id);
        $this->assertEquals(500, (float) $order->refunded_amount);
        // Linked to the local payment through the refund's payment_id, not its ref_ id.
        $this->assertSame($this->payment->id, PaymentWebhookEvent::where('provider_event_id', 'evt_ok')->value('payment_id'));
    }

    public function test_failed_status_marks_the_refund_failed_and_keeps_the_payment_retryable(): void
    {
        $refund = $this->pendingRefund('ref_fail');

        $this->deliver($this->event('evt_fail', 'payment.refund.updated', $this->refundResource('ref_fail', 'failed')))->assertOk();

        $this->assertSame('failed', $refund->fresh()->status);
        $this->assertSame('paid', $this->payment->fresh()->status, 'money never moved: the payment stays refundable');
        $order = $this->order->fresh();
        $this->assertSame('failed', $order->refund_status);
        $this->assertNotNull($order->refund_failure_reason);
        $this->assertNotSame('refunded', $order->payment_status);
    }

    public function test_a_late_failed_event_never_downgrades_a_succeeded_refund(): void
    {
        $this->pendingRefund('ref_late');
        $this->deliver($this->event('evt_late_1', 'payment.refund.updated', $this->refundResource('ref_late', 'succeeded')))->assertOk();
        $this->deliver($this->event('evt_late_2', 'payment.refund.updated', $this->refundResource('ref_late', 'failed')))->assertOk();

        $this->assertSame('succeeded', Refund::where('provider_refund_id', 'ref_late')->value('status'));
        $this->assertSame('refunded', $this->payment->fresh()->status);
    }

    public function test_a_duplicate_event_is_a_no_op(): void
    {
        $refund = $this->pendingRefund('ref_dup');
        $event = $this->event('evt_dup', 'payment.refund.updated', $this->refundResource('ref_dup', 'succeeded'));

        $this->deliver($event)->assertOk();
        $this->deliver($event)->assertOk();

        $this->assertSame(1, PaymentWebhookEvent::where('provider_event_id', 'evt_dup')->count());
        $this->assertSame(1, Refund::count());
        $this->assertSame('succeeded', $refund->fresh()->status);
        $this->assertEquals(500, (float) $this->order->fresh()->refunded_amount, 'the refund is applied once, not twice');
    }

    public function test_an_unlinked_requested_refund_is_settled_by_its_key_not_duplicated(): void
    {
        // initiateRefund recorded the request; PayMongo's answer has not been
        // saved yet when its webhook arrives.
        $requested = Refund::create([
            'payment_id' => $this->payment->id,
            'order_id' => $this->order->id,
            'payable_type' => Order::class,
            'payable_id' => $this->order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500,
            'original_amount' => 500,
            'refund_deduction' => 0,
            'currency' => 'PHP',
            'reason' => 'Order cancelled',
            'status' => 'requested',
            'idempotency_key' => 'local-key-123',
        ]);

        $this->deliver($this->event('evt_key', 'payment.refund.updated', $this->refundResource('ref_key', 'pending', localKey: 'local-key-123')))->assertOk();

        $this->assertSame(1, Refund::count(), 'no second ledger row');
        $this->assertSame('ref_key', $requested->fresh()->provider_refund_id);
        $this->assertSame('pending', $requested->fresh()->status);
        $this->assertSame('pending_refund', $this->payment->fresh()->status);
    }

    private function requestedRefund(string $key, float $amount): Refund
    {
        return Refund::create([
            'payment_id' => $this->payment->id,
            'order_id' => $this->order->id,
            'payable_type' => Order::class,
            'payable_id' => $this->order->id,
            'user_id' => $this->tourist->id,
            'amount' => $amount,
            'original_amount' => $amount,
            'refund_deduction' => 0,
            'currency' => 'PHP',
            'reason' => 'Item unavailable',
            'status' => 'requested',
            'idempotency_key' => $key,
        ]);
    }

    public function test_without_a_key_the_single_in_flight_refund_of_that_amount_is_claimed(): void
    {
        $other = $this->requestedRefund('k-other', 80);
        $mine = $this->requestedRefund('k-mine', 20);

        $this->deliver($this->event('evt_amt', 'payment.refund.updated', $this->refundResource('ref_amt', 'pending', amount: 2000)))->assertOk();

        $this->assertSame(2, Refund::count());
        $this->assertSame('ref_amt', $mine->fresh()->provider_refund_id);
        $this->assertNull($other->fresh()->provider_refund_id);
    }

    public function test_two_in_flight_refunds_of_the_same_amount_are_never_guessed(): void
    {
        $a = $this->requestedRefund('k-a', 20);
        $b = $this->requestedRefund('k-b', 20);

        $this->deliver($this->event('evt_amb', 'payment.refund.updated', $this->refundResource('ref_amb', 'succeeded', amount: 2000)))->assertOk();

        // Nothing linked, nothing invented, nothing marked refunded.
        $this->assertSame(2, Refund::count());
        $this->assertNull($a->fresh()->provider_refund_id);
        $this->assertNull($b->fresh()->provider_refund_id);
        $this->assertSame('requested', $a->fresh()->status);
        $this->assertSame('requested', $b->fresh()->status);
        $this->assertSame('paid', $this->payment->fresh()->status);
    }

    public function test_the_key_picks_the_right_refund_among_equal_amounts(): void
    {
        $a = $this->requestedRefund('k-a', 20);
        $b = $this->requestedRefund('k-b', 20);

        $this->deliver($this->event('evt_keyed', 'payment.refund.updated', $this->refundResource('ref_keyed', 'pending', amount: 2000, localKey: 'k-b')))->assertOk();

        $this->assertSame(2, Refund::count());
        $this->assertNull($a->fresh()->provider_refund_id);
        $this->assertSame('ref_keyed', $b->fresh()->provider_refund_id);
        $this->assertSame('pending', $b->fresh()->status);
    }

    public function test_a_webhook_that_settles_first_is_not_overwritten_by_the_providers_answer(): void
    {
        // The succeeded webhook lands while PayMongo is still answering the
        // create call (which itself says "pending").
        Http::fake(function (HttpRequest $request) {
            $key = $request->header('Idempotency-Key')[0];
            app(PaymentRefundProcessor::class)->applyProviderStatus('ref_race', 'succeeded', 'pay_test_rwh', ['amount' => 50000], $key);

            return Http::response(['data' => $this->refundResource('ref_race', 'pending', localKey: $key)]);
        });

        $result = app(PaymentRefundProcessor::class)->initiateRefund($this->payment, 500.0, 'Order cancelled before a rider accepted');

        $this->assertSame('succeeded', $result['status']);
        $this->assertSame(1, Refund::count());
        $this->assertSame('succeeded', Refund::first()->status);
        $this->assertSame('ref_race', Refund::first()->provider_refund_id);
        $this->assertSame('refunded', $this->payment->fresh()->status);
    }

    public function test_an_unmatched_payment_and_refund_change_nothing(): void
    {
        $this->deliver($this->event('evt_unknown', 'payment.refund.updated', $this->refundResource('ref_unknown', 'succeeded', paymentId: 'pay_not_ours')))->assertOk();

        $this->assertSame(0, Refund::count());
        $this->assertSame('paid', $this->payment->fresh()->status);
        $this->assertNull(PaymentWebhookEvent::where('provider_event_id', 'evt_unknown')->value('payment_id'));
    }

    public function test_a_refund_made_outside_the_app_is_recorded_with_its_own_amount(): void
    {
        // e.g. a partial refund issued from the PayMongo dashboard: recorded once,
        // for the refund's amount (₱120), not the whole payment.
        $this->deliver($this->event('evt_dash', 'payment.refund.updated', $this->refundResource('ref_dash', 'pending', amount: 12000)))->assertOk();

        $row = Refund::where('provider_refund_id', 'ref_dash')->first();
        $this->assertNotNull($row);
        $this->assertEquals(120.00, (float) $row->amount);
        $this->assertSame('pending', $row->status);
        $this->assertSame($this->payment->id, $row->payment_id);
    }

    public function test_a_payment_resource_id_is_never_taken_for_a_refund_id(): void
    {
        $paymentResource = ['id' => 'pay_test_rwh', 'type' => 'payment', 'attributes' => ['amount' => 50000, 'status' => 'paid', 'refunds' => []]];

        $this->deliver($this->event('evt_pay', 'payment.refunded', $paymentResource))->assertOk();

        $this->assertSame(0, Refund::count(), 'no refund invented from the payment id');
        $this->assertSame('paid', $this->payment->fresh()->status);
    }

    public function test_an_invalid_signature_is_rejected_before_anything_runs(): void
    {
        $refund = $this->pendingRefund('ref_sig');

        $this->deliver($this->event('evt_sig', 'payment.refund.updated', $this->refundResource('ref_sig', 'succeeded')), 'whsk_wrong')
            ->assertStatus(400);

        $this->assertSame('pending', $refund->fresh()->status);
        $this->assertSame(0, PaymentWebhookEvent::count());
    }
}
