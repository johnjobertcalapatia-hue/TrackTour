<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use App\Services\PaymongoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PaymentApiTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourist = User::create([
            'email' => 'tourist@test.com',
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
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
            'latitude' => 12.8667000,
            'longitude' => 121.4500000,
        ]);

        config(['services.paymongo.secret_key' => 'sk_test_abc123']);
        config(['services.paymongo.webhook_secret' => '']);
    }

    private function createOrder(float $total = 300.00): Order
    {
        $order = Order::create([
            'order_number' => 'ORD-'.strtoupper(uniqid()),
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => $this->tourist->fullName,
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09123456789',
            'order_type' => 'pickup',
            'payment_method' => 'gcash',
            'payment_status' => 'pending',
            'status' => 'pending_payment',
            'subtotal' => $total,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => $total,
        ]);

        $order->items()->create([
            'offering_id' => 1,
            'product_name' => 'Adobo',
            'quantity' => 2,
            'unit_price' => 150.00,
            'subtotal' => 300.00,
        ]);

        return $order;
    }

    private function createBooking(float $total = 500.00): Booking
    {
        return Booking::create([
            'booking_number' => 'BK-'.strtoupper(uniqid()),
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => $this->tourist->fullName,
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09123456789',
            'booking_type' => 'tour',
            'status' => 'confirmed',
            'total_amount' => $total,
            'paid_amount' => 0,
            'guests' => 2,
        ]);
    }

    // ─── createIntent ───────────────────────────────────────────────

    public function test_create_intent_requires_auth(): void
    {
        $response = $this->postJson('/api/payments/create-intent', [
            'payable_type' => 'order',
            'payable_id' => 1,
            'method' => 'gcash',
        ]);

        $response->assertStatus(401);
    }

    public function test_create_intent_requires_validation_fields(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['payable_type', 'payable_id', 'method']);
    }

    public function test_create_intent_rejects_invalid_payable_type(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'invalid',
                'payable_id' => 1,
                'method' => 'gcash',
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['payable_type']);
    }

    public function test_create_intent_rejects_invalid_method(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => 1,
                'method' => 'bitcoin',
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['method']);
    }

    public function test_create_intent_for_order_returns_payment_intent(): void
    {
        $order = $this->createOrder();

        Http::fake([
            'api.paymongo.com/v1/checkout_sessions' => Http::response([
                'data' => [
                    'id' => 'cs_test_session_123',
                    'attributes' => [
                        'status' => 'active',
                        'checkout_url' => 'https://checkout.paymongo.com/cs_test_session_123',
                    ],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => $order->id,
                'method' => 'gcash',
            ]);

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data' => ['payment_number', 'checkout_url'],
            ]);

        $this->assertDatabaseHas('payments', [
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
        ]);
    }

    public function test_create_intent_for_booking_returns_payment_intent(): void
    {
        $booking = $this->createBooking();

        Http::fake([
            'api.paymongo.com/v1/checkout_sessions' => Http::response([
                'data' => [
                    'id' => 'cs_test_session_456',
                    'attributes' => [
                        'status' => 'active',
                        'checkout_url' => 'https://checkout.paymongo.com/cs_test_session_456',
                    ],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'booking',
                'payable_id' => $booking->id,
                'method' => 'gcash',
            ]);

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data' => ['payment_number', 'checkout_url'],
            ]);

        $this->assertDatabaseHas('payments', [
            'payable_type' => Booking::class,
            'payable_id' => $booking->id,
            'amount' => 500.00,
            'method' => 'gcash',
            'status' => 'pending',
        ]);
    }

    public function test_create_intent_rejects_already_paid_order(): void
    {
        $order = $this->createOrder();

        Payment::create([
            'payment_number' => 'PAY-EXISTING001',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => $order->id,
                'method' => 'gcash',
            ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'This order has already been paid.']);
    }

    public function test_create_intent_rejects_already_paid_booking(): void
    {
        $booking = $this->createBooking();

        Payment::create([
            'payment_number' => 'PAY-EXISTING002',
            'payable_type' => Booking::class,
            'payable_id' => $booking->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'method' => 'gcash',
            'status' => 'paid',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'booking',
                'payable_id' => $booking->id,
                'method' => 'gcash',
            ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'This booking has already been paid.']);
    }

    public function test_create_intent_returns_503_when_gateway_not_configured(): void
    {
        $order = $this->createOrder();
        config(['services.paymongo.secret_key' => '']);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => $order->id,
                'method' => 'gcash',
            ]);

        $response->assertStatus(503)
            ->assertJson(['message' => 'Payment gateway is not configured. Please contact support.']);
    }

    public function test_create_intent_returns_502_on_paymongo_failure(): void
    {
        $order = $this->createOrder();

        Http::fake([
            'api.paymongo.com/v1/payment_intents' => Http::response(null, 500),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => $order->id,
                'method' => 'gcash',
            ]);

        $response->assertStatus(502)
            ->assertJson(['message' => 'Failed to initialize payment. Please try again.']);
    }

    public function test_create_intent_404_for_nonexistent_order(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => 99999,
                'method' => 'gcash',
            ]);

        $response->assertStatus(404);
    }

    public function test_create_intent_404_for_other_users_order(): void
    {
        $otherUser = User::create([
            'email' => 'other@test.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $order = Order::create([
            'order_number' => 'ORD-OTHERUSR',
            'business_id' => $this->business->id,
            'user_id' => $otherUser->id,
            'customer_name' => 'Other User',
            'customer_email' => 'other@test.com',
            'customer_phone' => '09123456789',
            'order_type' => 'pickup',
            'payment_method' => 'gcash',
            'payment_status' => 'pending',
            'status' => 'pending_payment',
            'subtotal' => 300.00,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => 300.00,
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => $order->id,
                'method' => 'gcash',
            ]);

        $response->assertStatus(404);
    }

    public function test_create_intent_stores_payment_number(): void
    {
        $order = $this->createOrder();

        Http::fake([
            'api.paymongo.com/v1/checkout_sessions' => Http::response([
                'data' => [
                    'id' => 'cs_test_session_789',
                    'attributes' => [
                        'status' => 'active',
                        'checkout_url' => 'https://checkout.paymongo.com/cs_test_session_789',
                    ],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', [
                'payable_type' => 'order',
                'payable_id' => $order->id,
                'method' => 'gcash',
            ]);

        $response->assertOk();

        $paymentNumber = $response->json('data.payment_number');
        $this->assertStringStartsWith('PAY-', $paymentNumber);
        $this->assertDatabaseHas('payments', [
            'payment_number' => $paymentNumber,
            'provider_payment_id' => 'cs_test_session_789',
        ]);
    }

    // ─── callback ───────────────────────────────────────────────────

    public function test_callback_requires_auth(): void
    {
        $response = $this->getJson('/api/payments/callback?payment_number=PAY-123&status=success');

        $response->assertStatus(401);
    }

    public function test_callback_without_payment_number_returns_400(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/callback');

        $response->assertStatus(400)
            ->assertJson(['message' => 'Invalid payment callback.']);
    }

    public function test_callback_returns_404_for_nonexistent_payment(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/callback?payment_number=PAY-NONEXIST&status=success');

        $response->assertStatus(404)
            ->assertJson(['message' => 'Payment not found.']);
    }

    public function test_callback_cancels_pending_payment(): void
    {
        $order = $this->createOrder();
        $payment = Payment::create([
            'payment_number' => 'PAY-CBTEST001',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/callback?payment_number=PAY-CBTEST001&status=cancelled');

        $response->assertOk()
            ->assertJson(['data' => ['status' => 'cancelled']]);

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-CBTEST001',
            'status' => 'cancelled',
        ]);
    }

    public function test_callback_does_not_overwrite_paid_status(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-CBTEST002',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/callback?payment_number=PAY-CBTEST002&status=cancelled');

        $response->assertOk()
            ->assertJson(['data' => ['status' => 'paid']]);

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-CBTEST002',
            'status' => 'paid',
        ]);
    }

    public function test_callback_success_returns_pending_for_unpaid(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-CBTEST003',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/callback?payment_number=PAY-CBTEST003&status=success');

        $response->assertOk()
            ->assertJson(['data' => ['status' => 'pending']]);
    }

    public function test_callback_redirects_to_order_for_order_payment(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-CBTEST004',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/callback?payment_number=PAY-CBTEST004&status=success');

        $response->assertOk();
        $redirect = $response->json('data.redirect');
        $this->assertStringContainsString('order_id='.$order->id, $redirect);
    }

    public function test_callback_redirects_to_booking_for_booking_payment(): void
    {
        $booking = $this->createBooking();
        Payment::create([
            'payment_number' => 'PAY-CBTEST005',
            'payable_type' => Booking::class,
            'payable_id' => $booking->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'method' => 'gcash',
            'status' => 'paid',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/callback?payment_number=PAY-CBTEST005&status=success');

        $response->assertOk();
        $redirect = $response->json('data.redirect');
        $this->assertStringContainsString('booking_id='.$booking->id, $redirect);
    }

    // ─── webhook ────────────────────────────────────────────────────

    public function test_webhook_does_not_require_auth(): void
    {
        $response = $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'checkout_session.completed',
                    'data' => ['id' => 'cs_xxx', 'status' => 'completed'],
                ],
            ],
        ]);

        $response->assertOk();
    }

    public function test_webhook_checkout_session_completed_marks_paid(): void
    {
        $order = $this->createOrder();
        $payment = Payment::create([
            'payment_number' => 'PAY-WH001',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'cs_test_wh_session',
        ]);

        $response = $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'checkout_session.completed',
                    'data' => [
                        'id' => 'cs_test_wh_session',
                        'status' => 'completed',
                    ],
                ],
            ],
        ]);

        $response->assertOk()
            ->assertJson(['status' => 'ok']);

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-WH001',
            'status' => 'paid',
        ]);

        // Pickup orders start cooking the moment they are paid. This order is
        // order_type='pickup', so PaymentController::markPayablePaid() hands it
        // straight to PreparationStartService, which gates on an accepted rider
        // ONLY for delivery orders (a pickup has no rider). The order therefore
        // lands in 'preparing', not 'waiting_restaurant' — waiting_restaurant
        // is the delivery-only "Finding Rider" state. Test drift: this assertion
        // predates the pickup branch (AGENTS.md §12).
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'paid',
            'status' => 'preparing',
        ]);
    }

    public function test_webhook_checkout_session_completed_for_booking(): void
    {
        $booking = $this->createBooking();
        $payment = Payment::create([
            'payment_number' => 'PAY-WH002',
            'payable_type' => Booking::class,
            'payable_id' => $booking->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'cs_test_wh_booking',
        ]);

        $response = $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'checkout_session.completed',
                    'data' => [
                        'id' => 'cs_test_wh_booking',
                        'status' => 'completed',
                    ],
                ],
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-WH002',
            'status' => 'paid',
        ]);

        $this->assertDatabaseHas('bookings', [
            'id' => $booking->id,
            'paid_amount' => 500.00,
        ]);
    }

    public function test_webhook_checkout_session_expired_marks_failed(): void
    {
        $order = $this->createOrder();
        $payment = Payment::create([
            'payment_number' => 'PAY-WH003',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'cs_test_wh_expired',
        ]);

        $response = $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'checkout_session.completed',
                    'data' => [
                        'id' => 'cs_test_wh_expired',
                        'status' => 'expired',
                    ],
                ],
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-WH003',
            'status' => 'failed',
        ]);
    }

    public function test_webhook_payment_paid_marks_paid(): void
    {
        $order = $this->createOrder();
        $payment = Payment::create([
            'payment_number' => 'PAY-WH004',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'pm_test_payment_123',
        ]);

        $response = $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'payment.paid',
                    'data' => ['id' => 'pm_test_payment_123'],
                ],
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-WH004',
            'status' => 'paid',
        ]);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'paid',
        ]);
    }

    public function test_webhook_payment_failed_marks_failed(): void
    {
        $order = $this->createOrder();
        $payment = Payment::create([
            'payment_number' => 'PAY-WH005',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'pm_test_failed_456',
        ]);

        $response = $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'payment.failed',
                    'data' => ['id' => 'pm_test_failed_456'],
                ],
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-WH005',
            'status' => 'failed',
        ]);
    }

    public function test_webhook_is_idempotent_for_paid_payment(): void
    {
        $order = $this->createOrder();
        $payment = Payment::create([
            'payment_number' => 'PAY-WH006',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'pm_test_idempotent',
        ]);

        $webhookPayload = [
            'data' => [
                'attributes' => [
                    'type' => 'payment.paid',
                    'data' => ['id' => 'pm_test_idempotent'],
                ],
            ],
        ];

        $response1 = $this->postJson('/api/payments/webhook', $webhookPayload);
        $response1->assertOk();

        $response2 = $this->postJson('/api/payments/webhook', $webhookPayload);
        $response2->assertOk();

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-WH006',
            'status' => 'paid',
        ]);
    }

    public function test_webhook_ignores_unknown_payment_ids(): void
    {
        $response = $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'payment.paid',
                    'data' => ['id' => 'pm_nonexistent'],
                ],
            ],
        ]);

        $response->assertOk();
    }

    // ─── status ─────────────────────────────────────────────────────

    public function test_status_requires_auth(): void
    {
        $response = $this->getJson('/api/payments/status/PAY-123');

        $response->assertStatus(401);
    }

    public function test_status_returns_404_for_nonexistent_payment(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/status/PAY-NONEXIST');

        $response->assertStatus(404)
            ->assertJson(['message' => 'Payment not found.']);
    }

    public function test_status_returns_payment_details(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-STATUS01',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
            'paid_at' => now(),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/status/PAY-STATUS01');

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'payment_number' => 'PAY-STATUS01',
                    'status' => 'paid',
                    'amount' => 300.00,
                    'method' => 'gcash',
                ],
            ])
            ->assertJsonStructure([
                'data' => ['payment_number', 'status', 'amount', 'method', 'paid_at'],
            ]);
    }

    public function test_status_404_for_other_users_payment(): void
    {
        $otherUser = User::create([
            'email' => 'other2@test.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-STATUS02',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $otherUser->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/payments/status/PAY-STATUS02');

        $response->assertStatus(404);
    }

    // ─── refund ─────────────────────────────────────────────────────

    public function test_refund_requires_auth(): void
    {
        $response = $this->postJson('/api/payments/PAY-123/refund', []);

        $response->assertStatus(401);
    }

    public function test_refund_returns_404_for_nonexistent_payment(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-NONEXIST/refund', []);

        $response->assertStatus(404)
            ->assertJson(['message' => 'Payment not found.']);
    }

    public function test_refund_rejects_unpaid_payment(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-REFUND01',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'pending',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND01/refund', []);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Only paid payments can be refunded.']);
    }

    public function test_refund_rejects_cancelled_payment(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-REFUND02',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'cancelled',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND02/refund', []);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Only paid payments can be refunded.']);
    }

    public function test_refund_calls_paymongo_and_updates_order(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-REFUND03',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
            'provider_payment_id' => 'pm_test_refund_src',
        ]);

        Http::fake([
            'api.paymongo.com/v1/payments/pm_test_refund_src/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_test_123',
                    'attributes' => ['status' => 'succeeded'],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND03/refund', [
                'reason' => 'Customer request',
            ]);

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'refund_id' => 'ref_test_123',
                    'status' => 'succeeded',
                ],
            ]);

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-REFUND03',
            'status' => 'refunded',
        ]);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'refunded',
            'status' => 'cancelled',
        ]);
    }

    public function test_refund_calls_paymongo_and_updates_booking(): void
    {
        $booking = $this->createBooking();
        Payment::create([
            'payment_number' => 'PAY-REFUND04',
            'payable_type' => Booking::class,
            'payable_id' => $booking->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'method' => 'gcash',
            'status' => 'paid',
            'provider_payment_id' => 'pm_test_refund_bk',
        ]);

        Http::fake([
            'api.paymongo.com/v1/payments/pm_test_refund_bk/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_test_bk',
                    'attributes' => ['status' => 'succeeded'],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND04/refund');

        $response->assertOk();

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-REFUND04',
            'status' => 'refunded',
        ]);

        $this->assertDatabaseHas('bookings', [
            'id' => $booking->id,
            'payment_status' => 'refunded',
        ]);
    }

    public function test_refund_handles_partial_amount(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-REFUND05',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
            'provider_payment_id' => 'pm_test_partial',
        ]);

        Http::fake([
            'api.paymongo.com/v1/payments/pm_test_partial/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_partial',
                    'attributes' => ['status' => 'succeeded'],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND05/refund', [
                'amount' => 15000,
            ]);

        $response->assertOk()
            ->assertJsonFragment(['amount' => 150.00]);
    }

    public function test_refund_returns_502_on_paymongo_failure(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-REFUND06',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
            'provider_payment_id' => 'pm_test_refund_fail',
        ]);

        Http::fake([
            'api.paymongo.com/v1/payments/pm_test_refund_fail/refunds' => Http::response(null, 500),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND06/refund');

        $response->assertStatus(502)
            ->assertJson(['message' => 'Refund failed. Please try again.']);
    }

    public function test_refund_sets_pending_refund_status_on_partial_success(): void
    {
        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-REFUND07',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
            'provider_payment_id' => 'pm_test_refund_pending',
        ]);

        Http::fake([
            'api.paymongo.com/v1/payments/pm_test_refund_pending/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_pending',
                    'attributes' => ['status' => 'pending'],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND07/refund');

        $response->assertOk()
            ->assertJsonFragment(['status' => 'pending']);

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-REFUND07',
            'status' => 'pending_refund',
        ]);
    }

    public function test_refund_404_for_other_users_payment(): void
    {
        $otherUser = User::create([
            'email' => 'other3@test.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $order = $this->createOrder();
        Payment::create([
            'payment_number' => 'PAY-REFUND08',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $otherUser->id,
            'amount' => 300.00,
            'method' => 'gcash',
            'status' => 'paid',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/PAY-REFUND08/refund');

        $response->assertStatus(404);
    }
}
