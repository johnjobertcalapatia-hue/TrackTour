<?php

namespace Tests\Feature;

use App\Events\PaymentReceived;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\PaymentWebhookEvent;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * P11.4 — Payment idempotency.
 *
 * Provider webhooks are deduplicated by their stable event id at the database
 * level (UNIQUE payment_webhook_events.provider_event_id), apply state-machine
 * guarded verdicts under a payment row-lock, and can never create duplicate
 * payment/delivery/ledger effects. Legitimate payment retries keep working.
 */
class PaymentIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourist = User::create([
            'email' => 'idem.tourist@test.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Idempotency Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
            'latitude' => 12.8667000,
            'longitude' => 121.4500000,
        ]);

        config(['services.paymongo.secret_key' => 'sk_test_idempotency']);
        config(['services.paymongo.webhook_secret' => '']);
    }

    private function newDeliveryOrder(): Order
    {
        return Order::create([
            'order_number' => 'ORD-'.strtoupper(uniqid()),
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => $this->tourist->fullName,
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09123456789',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'pending',
            'status' => 'pending_payment',
            'subtotal' => 300.00,
            'delivery_fee' => 50.00,
            'rider_tip' => 0,
            'discount' => 0,
            'total' => 350.00,
            'delivery_address' => 'Bansud Proper',
            'delivery_latitude' => 12.86,
            'delivery_longitude' => 121.45,
            'delivery_distance_km' => 2.5,
            'delivery_duration_minutes' => 15,
        ]);
    }

    private function newPayment(Order $order, string $providerId, string $status = 'pending'): Payment
    {
        return Payment::create([
            'payment_number' => 'PAY-'.strtoupper(uniqid()),
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 350.00,
            'method' => 'gcash',
            'provider_payment_id' => $providerId,
            'status' => $status,
        ]);
    }

    private function webhookPayload(string $eventType, string $eventId, array $resource): array
    {
        return [
            'data' => [
                'id' => $eventId,
                'type' => 'event',
                'attributes' => [
                    'type' => $eventType,
                    'data' => $resource,
                ],
            ],
        ];
    }

    private function deliver(string $eventType, string $eventId, array $resource): TestResponse
    {
        return $this->postJson('/api/payments/webhook', $this->webhookPayload($eventType, $eventId, $resource));
    }

    // ─── same webhook processed twice ──────────────────────────────

    public function test_same_webhook_processed_twice_is_a_noop(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'pm_test_double');

        $this->deliver('payment.paid', 'evt_double_1', ['id' => 'pm_test_double'])->assertOk();
        $order->refresh();
        $acceptanceStarted = $order->acceptance_started_at;

        $this->deliver('payment.paid', 'evt_double_1', ['id' => 'pm_test_double'])->assertOk();

        $this->assertDatabaseCount('payment_webhook_events', 1);
        $this->assertDatabaseHas('payment_webhook_events', ['provider_event_id' => 'evt_double_1']);

        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'paid_amount' => 350.00]);
        // The paid side-effects ran exactly once.
        $this->assertSame($acceptanceStarted?->format('Y-m-d H:i:s'), $order->acceptance_started_at?->format('Y-m-d H:i:s'));
        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());
    }

    // ─── same webhook concurrently (DB unique backstop) ────────────

    public function test_concurrent_duplicate_event_ledger_insert_is_blocked_by_unique(): void
    {
        $this->expectException(UniqueConstraintViolationException::class);

        PaymentWebhookEvent::create([
            'provider_event_id' => 'evt_race_1',
            'event_type' => 'payment.paid',
            'processed_at' => now(),
        ]);

        // Simulates a second concurrent transaction that lost the race: the
        // UNIQUE(provider_event_id) backstop rejects it before any handler runs.
        PaymentWebhookEvent::create([
            'provider_event_id' => 'evt_race_1',
            'event_type' => 'payment.paid',
            'processed_at' => now(),
        ]);
    }

    public function test_webhook_for_event_already_committed_is_a_noop(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'pm_test_raced');

        // A concurrent transaction already committed this exact event id.
        PaymentWebhookEvent::create([
            'provider_event_id' => 'evt_raced_1',
            'event_type' => 'payment.paid',
            'processed_at' => now(),
        ]);

        $this->deliver('payment.paid', 'evt_raced_1', ['id' => 'pm_test_raced'])->assertOk();

        $this->assertDatabaseCount('payment_webhook_events', 1);
        $this->assertDatabaseHas('payments', [
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'status' => 'pending',
        ]);
        $this->assertSame('pending', $order->refresh()->payment_status);
    }

    // ─── different events for the same payment ─────────────────────

    public function test_distinct_events_for_same_payment_converge_once(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'pm_test_multi');

        $this->deliver('checkout_session.completed', 'evt_multi_a', ['id' => 'pm_test_multi', 'status' => 'completed'])->assertOk();
        $order->refresh();
        $acceptanceStarted = $order->acceptance_started_at;
        $dispatchedAt = $order->dispatch_started_at;

        $this->deliver('checkout_session.payment.paid', 'evt_multi_b', [
            'checkout_session_id' => 'pm_test_multi',
            'id' => 'pay_multi_001',
        ])->assertOk();

        $this->deliver('payment.paid', 'evt_multi_c', ['id' => 'pay_multi_001'])->assertOk();

        // All three distinct events were recorded...
        $this->assertSame(3, PaymentWebhookEvent::whereIn('provider_event_id', ['evt_multi_a', 'evt_multi_b', 'evt_multi_c'])->count());

        // ...but the payable was finalized exactly once.
        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'paid_amount' => 350.00]);
        $this->assertSame($acceptanceStarted?->format('Y-m-d H:i:s'), $order->acceptance_started_at?->format('Y-m-d H:i:s'));
        $this->assertSame($dispatchedAt?->format('Y-m-d H:i:s'), $order->dispatch_started_at?->format('Y-m-d H:i:s'));
        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());
    }

    // ─── state machine ─────────────────────────────────────────────

    public function test_paid_payment_cannot_be_downgraded_by_late_failed_webhook(): void
    {
        $order = $this->newDeliveryOrder();
        $payment = $this->newPayment($order, 'pm_test_paid', 'paid');
        $payment->update(['paid_at' => now()]);

        $this->deliver('payment.failed', 'evt_paid_fail', ['id' => 'pm_test_paid'])->assertOk();

        $payment->refresh();
        $this->assertSame('paid', $payment->status);
        $this->assertNull($payment->failed_at);
        $this->assertNotNull($payment->paid_at);
    }

    public function test_failed_payment_retry_can_become_paid(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'pm_test_retry', 'failed');

        $this->deliver('payment.paid', 'evt_retry_1', ['id' => 'pm_test_retry'])->assertOk();

        $this->assertDatabaseHas('payments', [
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'status' => 'paid',
        ]);
        $this->assertSame('paid', $order->refresh()->payment_status);
    }

    public function test_refunded_payment_cannot_be_resurrected_to_paid(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'pm_test_refunded_guard', 'refunded');

        $this->deliver('payment.paid', 'evt_resurrect', ['id' => 'pm_test_refunded_guard'])->assertOk();

        $this->assertDatabaseHas('payments', [
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'status' => 'refunded',
        ]);
        $this->assertSame('pending', $order->refresh()->payment_status);
    }

    public function test_in_flight_refund_cannot_be_flipped_to_paid(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'pm_test_pending_refund_guard', 'pending_refund');

        $this->deliver('payment.paid', 'evt_inflight', ['id' => 'pm_test_pending_refund_guard'])->assertOk();

        $this->assertDatabaseHas('payments', [
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'status' => 'pending_refund',
        ]);
    }

    public function test_verify_and_confirm_cannot_resurrect_a_refunded_payment(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'cs_test_verify_guard', 'refunded');

        Http::fake([
            'api.paymongo.com/v1/checkout_sessions/*' => Http::response([
                'data' => [
                    'attributes' => [
                        'status' => 'completed',
                        'payment_intent' => ['attributes' => ['status' => 'succeeded']],
                    ],
                ],
            ], 200),
        ]);

        $payment = Payment::where('payable_id', $order->id)->first();
        $response = $this->getJson('/api/payments/check/'.$payment->payment_number);

        $response->assertOk();
        $this->assertDatabaseHas('payments', [
            'payment_number' => $payment->payment_number,
            'status' => 'refunded',
        ]);
    }

    // ─── duplicate payment intent / provider reference ─────────────

    public function test_duplicate_payment_intent_provider_id_is_rejected_at_db(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'cs_test_dup_intent', 'pending');

        $this->expectException(UniqueConstraintViolationException::class);

        Payment::create([
            'payment_number' => 'PAY-'.strtoupper(uniqid()),
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 350.00,
            'method' => 'gcash',
            'provider_payment_id' => 'cs_test_dup_intent',
            'status' => 'pending',
        ]);
    }

    // ─── duplicate payment callback (poll + redirect confirm path) ──

    public function test_duplicate_check_and_confirm_callbacks_apply_paid_once(): void
    {
        $order = $this->newDeliveryOrder();
        $payment = $this->newPayment($order, 'cs_test_check_twice', 'pending');

        Http::fake([
            'api.paymongo.com/v1/checkout_sessions/*' => Http::response([
                'data' => [
                    'attributes' => [
                        'status' => 'completed',
                        'payment_intent' => ['id' => 'pay_check_twice', 'attributes' => ['status' => 'succeeded']],
                    ],
                ],
            ], 200),
        ]);

        $this->getJson('/api/payments/check/'.$payment->payment_number)->assertOk();
        $order->refresh();
        $acceptanceStarted = $order->acceptance_started_at;

        $this->getJson('/api/payments/check/'.$payment->payment_number)->assertOk();

        $payment->refresh();
        $this->assertSame('paid', $payment->status);

        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'paid_amount' => 350.00]);
        $this->assertSame($acceptanceStarted?->format('Y-m-d H:i:s'), $order->acceptance_started_at?->format('Y-m-d H:i:s'));
        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());
    }

    // ─── webhook transaction rollback ──────────────────────────────

    public function test_webhook_processing_is_atomic_and_rolls_back_on_failure(): void
    {
        $this->withoutExceptionHandling();

        $order = $this->newDeliveryOrder();
        $payment = $this->newPayment($order, 'pm_test_rollback');

        // Simulate a downstream crash right before commit: nothing — neither the
        // event ledger row nor the payment transition — may persist.
        Event::listen(PaymentReceived::class, fn () => throw new \RuntimeException('simulated handler crash'));

        try {
            $this->deliver('payment.paid', 'evt_rollback_1', ['id' => 'pm_test_rollback']);
            $this->fail('The simulated handler crash should have propagated.');
        } catch (\RuntimeException $e) {
            $this->assertSame('simulated handler crash', $e->getMessage());
        } finally {
            Event::forget(PaymentReceived::class);
        }

        $this->assertDatabaseCount('payment_webhook_events', 0);
        $this->assertDatabaseHas('payments', [
            'payment_number' => $payment->payment_number,
            'status' => 'pending',
        ]);
        $this->assertSame('pending', $order->refresh()->payment_status);

        // Redelivery (PostMongo retry) after the crash clears processes fully.
        $this->deliver('payment.paid', 'evt_rollback_1', ['id' => 'pm_test_rollback'])->assertOk();

        $this->assertDatabaseCount('payment_webhook_events', 1);
        $this->assertDatabaseHas('payments', [
            'payment_number' => $payment->payment_number,
            'status' => 'paid',
        ]);
        $this->assertSame('paid', $order->refresh()->payment_status);
    }

    // ─── legacy no-event-id payloads ────────────────────────────────

    public function test_legacy_webhook_without_event_id_dedupes_by_resource(): void
    {
        $order = $this->newDeliveryOrder();
        $this->newPayment($order, 'pm_test_legacy');

        $legacyPayload = [
            'data' => [
                'attributes' => [
                    'type' => 'payment.paid',
                    'data' => ['id' => 'pm_test_legacy'],
                ],
            ],
        ];

        $this->postJson('/api/payments/webhook', $legacyPayload)->assertOk();
        $order->refresh();
        $acceptanceStarted = $order->acceptance_started_at;

        $this->postJson('/api/payments/webhook', $legacyPayload)->assertOk();

        $this->assertDatabaseCount('payment_webhook_events', 1);
        $this->assertDatabaseHas('payment_webhook_events', [
            'provider_event_id' => 'res|payment.paid|pm_test_legacy',
        ]);

        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $this->assertSame($acceptanceStarted?->format('Y-m-d H:i:s'), $order->acceptance_started_at?->format('Y-m-d H:i:s'));
        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());
    }

    private function databaseDateTime($value): ?string
    {
        return $value?->format('Y-m-d H:i:s');
    }
}