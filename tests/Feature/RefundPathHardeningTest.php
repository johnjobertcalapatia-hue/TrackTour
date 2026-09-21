<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * P11.3 — Refund-path hardening.
 *
 * Money-safety invariants under test:
 *  - A payment is only ever marked 'refunded' AFTER PayMongo confirms a refund
 *    succeeded. A failed/null provider response keeps the payment 'paid'
 *    (retryable) and never marks the payable refunded.
 *  - A provider-pending refund becomes 'pending_refund'; its final state is
 *    decided by the refund webhook or the reconciliation command, never locally.
 *  - ONE provider refund → ONE internal refund effect (no duplicate refunds,
 *    no duplicated ledger rows, no double financial effects).
 */
class RefundPathHardeningTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourist = User::create([
            'email' => 'refund-tourist@test.com',
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
            'business_name' => 'Refund Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
            'latitude' => 12.8667000,
            'longitude' => 121.4500000,
        ]);

        config(['services.paymongo.secret_key' => 'sk_test_abc123']);
        config(['services.paymongo.webhook_secret' => '']);
    }

    private function createOrder(float $total = 500.00, string $status = 'waiting_restaurant'): Order
    {
        return Order::create([
            'order_number' => 'ORD-'.strtoupper(uniqid()),
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => $this->tourist->fullName,
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09123456789',
            'order_type' => 'pickup',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => $status,
            'subtotal' => $total,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => $total,
            'paid_amount' => $total,
        ]);
    }

    private function createPaidPayment(Order $order, string $providerSource = 'pm_test_src', string $status = 'paid'): Payment
    {
        return Payment::create([
            'payment_number' => 'PAY-'.strtoupper(uniqid()),
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => (float) $order->total,
            'method' => 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'cs_test_legacy',
            'provider_source_id' => $providerSource,
            'status' => $status,
            'paid_at' => $status === 'paid' ? now() : null,
        ]);
    }

    private function refundWebhookPayload(string $type, string $refundId, ?string $status = null): array
    {
        $data = [
            'id' => $refundId,
            'payment_id' => 'pm_test_src',
        ];
        if ($status) {
            $data['attributes'] = ['status' => $status];
        }

        return [
            'data' => [
                'attributes' => [
                    'type' => $type,
                    'data' => $data,
                ],
            ],
        ];
    }

    // ─── successful refund ────────────────────────────────────────────

    public function test_successful_refund_marks_refunded_only_after_provider_success(): void
    {
        $order = $this->createOrder();
        $this->createPaidPayment($order, 'pm_success');

        Http::fake([
            'api.paymongo.com/v1/payments/pm_success/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_success_1',
                    'attributes' => ['status' => 'succeeded'],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/'.$order->payments->first()->payment_number.'/refund', [
                'reason' => 'Customer request',
            ]);

        $response->assertOk()
            ->assertJson(['data' => ['refund_id' => 'ref_success_1', 'status' => 'succeeded']]);

        $this->assertDatabaseHas('payments', [
            'payment_number' => $order->payments->first()->payment_number,
            'status' => 'refunded',
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'refunded',
            'status' => 'cancelled',
            'refund_status' => 'refunded',
            'paymongo_refund_id' => 'ref_success_1',
        ]);

        // The provider refund is recorded in the ledger WITH its provider id
        // (regression: this column used to be silently dropped).
        $ledger = Refund::where('payment_id', $order->payments->first()->id)->first();
        $this->assertNotNull($ledger);
        $this->assertSame('succeeded', $ledger->status);
        $this->assertSame('ref_success_1', $ledger->provider_refund_id);
        $this->assertSame(500.00, (float) $ledger->amount);
        $this->assertSame(500.00, (float) $order->fresh()->refunded_amount);
        $this->assertSame(500.00, (float) $order->fresh()->refund_amount);
    }

    // ─── provider failure: never refunded, always retryable ──────────

    public function test_provider_refund_failure_keeps_payment_paid_and_order_unrefunded(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_fail');

        Http::fake([
            'api.paymongo.com/v1/payments/pm_fail/refunds' => Http::response(null, 500),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/'.$payment->payment_number.'/refund');

        $response->assertStatus(502)
            ->assertJson(['message' => 'Refund failed. Please try again.']);

        // THE core invariant: never refunded before provider success.
        $this->assertDatabaseHas('payments', [
            'id' => $payment->id,
            'status' => 'paid',
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'paid',
            'refund_status' => 'failed',
        ]);
        $this->assertDatabaseMissing('payments', ['id' => $payment->id, 'status' => 'refunded']);

        // The failed attempt is audit-visible and retryable.
        $ledger = Refund::where('payment_id', $payment->id)->first();
        $this->assertNotNull($ledger);
        $this->assertSame('failed', $ledger->status);
        $this->assertNull($ledger->provider_refund_id);
        $this->assertNotNull($order->fresh()->refund_failure_reason);
        $this->assertSame(0.0, (float) $order->fresh()->refunded_amount);
    }

    // ─── provider pending → pending_refund, settled only by provider ──

    public function test_provider_pending_creates_pending_refund_state(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_pending');

        Http::fake([
            'api.paymongo.com/v1/payments/pm_pending/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_pending_1',
                    'attributes' => ['status' => 'pending'],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/'.$payment->payment_number.'/refund');

        $response->assertOk()
            ->assertJson(['data' => ['refund_id' => 'ref_pending_1', 'status' => 'pending']]);

        $this->assertDatabaseHas('payments', [
            'id' => $payment->id,
            'status' => 'pending_refund',
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'paid',
            'refund_status' => 'pending',
        ]);

        $ledger = Refund::where('payment_id', $payment->id)->first();
        $this->assertSame('pending', $ledger->status);
        $this->assertSame('ref_pending_1', $ledger->provider_refund_id);
    }

    // ─── refund.succeeded webhook ─────────────────────────────────────

    public function test_refund_succeeded_webhook_finalizes_a_pending_refund(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_src_w_success', 'pending_refund');
        Refund::create([
            'payment_id' => $payment->id,
            'provider_refund_id' => 'ref_w_success',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'original_amount' => 500.00,
            'refund_deduction' => 0.00,
            'currency' => 'PHP',
            'reason' => 'Customer request',
            'status' => 'pending',
        ]);

        $response = $this->postJson('/api/payments/webhook', $this->refundWebhookPayload('refund.succeeded', 'ref_w_success'));

        $response->assertOk()->assertJson(['status' => 'ok']);

        $this->assertDatabaseHas('payments', [
            'id' => $payment->id,
            'status' => 'refunded',
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'refunded',
            'refund_status' => 'refunded',
        ]);
        $this->assertDatabaseHas('refunds', [
            'provider_refund_id' => 'ref_w_success',
            'status' => 'succeeded',
        ]);
        $this->assertSame(500.00, (float) $order->fresh()->refunded_amount);
    }

    // ─── refund.failed webhook ────────────────────────────────────────

    public function test_refund_failed_webhook_reverts_to_paid_and_stays_retryable(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_src_w_fail', 'pending_refund');
        Refund::create([
            'payment_id' => $payment->id,
            'provider_refund_id' => 'ref_w_fail',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'original_amount' => 500.00,
            'refund_deduction' => 0.00,
            'currency' => 'PHP',
            'reason' => 'Customer request',
            'status' => 'pending',
        ]);

        $response = $this->postJson('/api/payments/webhook', $this->refundWebhookPayload('refund.failed', 'ref_w_fail'));

        $response->assertOk()->assertJson(['status' => 'ok']);

        // Provider says FAILED → internal refund ≠ refunded, retryable again.
        $this->assertDatabaseHas('payments', [
            'id' => $payment->id,
            'status' => 'paid',
        ]);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'paid',
            'refund_status' => 'failed',
        ]);
        $this->assertDatabaseHas('refunds', [
            'provider_refund_id' => 'ref_w_fail',
            'status' => 'failed',
        ]);
    }

    // ─── idempotent webhooks ──────────────────────────────────────────

    public function test_duplicate_refund_succeeded_webhook_is_idempotent(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_src_dup', 'pending_refund');
        Refund::create([
            'payment_id' => $payment->id,
            'provider_refund_id' => 'ref_dup',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'original_amount' => 500.00,
            'refund_deduction' => 0.00,
            'currency' => 'PHP',
            'reason' => 'Customer request',
            'status' => 'pending',
        ]);

        $payload = $this->refundWebhookPayload('refund.succeeded', 'ref_dup');

        $this->postJson('/api/payments/webhook', $payload)->assertOk();
        $this->postJson('/api/payments/webhook', $payload)->assertOk();

        $this->assertSame(1, Refund::where('provider_refund_id', 'ref_dup')->count());
        $this->assertSame(500.00, (float) $order->fresh()->refunded_amount);
        $this->assertSame('refunded', $order->fresh()->refund_status);
    }

    public function test_late_refund_failed_webhook_never_downgrades_a_successful_refund(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_src_no_downgrade', 'refunded');
        Refund::create([
            'payment_id' => $payment->id,
            'provider_refund_id' => 'ref_no_downgrade',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'original_amount' => 500.00,
            'refund_deduction' => 0.00,
            'currency' => 'PHP',
            'reason' => 'Customer request',
            'status' => 'succeeded',
        ]);
        $order->update(['payment_status' => 'refunded', 'refund_status' => 'refunded']);

        // A late refund.failed MUST NOT turn a successful refund back.
        $this->postJson('/api/payments/webhook', $this->refundWebhookPayload('refund.failed', 'ref_no_downgrade'))->assertOk();

        $this->assertDatabaseHas('payments', ['id' => $payment->id, 'status' => 'refunded']);
        $this->assertDatabaseHas('refunds', ['provider_refund_id' => 'ref_no_downgrade', 'status' => 'succeeded']);
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'payment_status' => 'refunded']);
    }

    // ─── duplicate refund requests ────────────────────────────────────

    public function test_already_refunded_payment_rejects_duplicate_request(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_dup_req', 'refunded');

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/'.$payment->payment_number.'/refund');

        $response->assertStatus(422)
            ->assertJson(['message' => 'This payment has already been refunded.']);

        Http::assertNothingSent();
    }

    public function test_pending_refund_payment_rejects_duplicate_request(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_inflight', 'pending_refund');

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/'.$payment->payment_number.'/refund');

        $response->assertStatus(422)
            ->assertJson(['message' => 'A refund is already being processed for this payment.']);

        Http::assertNothingSent();
    }

    // ─── reconciliation of pending_refund ─────────────────────────────

    public function test_reconciliation_finalizes_a_succeeded_provider_refund(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_recon_success', 'pending_refund');
        Refund::create([
            'payment_id' => $payment->id,
            'provider_refund_id' => 'ref_recon_success',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'original_amount' => 500.00,
            'refund_deduction' => 0.00,
            'currency' => 'PHP',
            'reason' => 'Customer request',
            'status' => 'pending',
        ]);

        Http::fake([
            'api.paymongo.com/v1/refunds/ref_recon_success' => Http::response([
                'data' => [
                    'id' => 'ref_recon_success',
                    'attributes' => ['status' => 'succeeded'],
                ],
            ], 200),
        ]);

        $this->artisan('payments:reconcile-refunds')->assertSuccessful();

        $this->assertDatabaseHas('payments', ['id' => $payment->id, 'status' => 'refunded']);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'refunded',
            'refund_status' => 'refunded',
        ]);
        $this->assertDatabaseHas('refunds', ['provider_refund_id' => 'ref_recon_success', 'status' => 'succeeded']);
    }

    public function test_reconciliation_reverts_a_failed_provider_refund_to_retryable(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_recon_fail', 'pending_refund');
        Refund::create([
            'payment_id' => $payment->id,
            'provider_refund_id' => 'ref_recon_fail',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'original_amount' => 500.00,
            'refund_deduction' => 0.00,
            'currency' => 'PHP',
            'reason' => 'Customer request',
            'status' => 'pending',
        ]);

        Http::fake([
            'api.paymongo.com/v1/refunds/ref_recon_fail' => Http::response([
                'data' => [
                    'id' => 'ref_recon_fail',
                    'attributes' => ['status' => 'failed'],
                ],
            ], 200),
        ]);

        $this->artisan('payments:reconcile-refunds')->assertSuccessful();

        $this->assertDatabaseHas('payments', ['id' => $payment->id, 'status' => 'paid']);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'paid',
            'refund_status' => 'failed',
        ]);
        $this->assertDatabaseHas('refunds', ['provider_refund_id' => 'ref_recon_fail', 'status' => 'failed']);
    }

    public function test_reconciliation_does_not_flip_when_provider_is_out_of_reach(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_recon_unreachable', 'pending_refund');
        Refund::create([
            'payment_id' => $payment->id,
            'provider_refund_id' => 'ref_recon_unknown',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 500.00,
            'original_amount' => 500.00,
            'refund_deduction' => 0.00,
            'currency' => 'PHP',
            'reason' => 'Customer request',
            'status' => 'pending',
        ]);

        // Provider unreachable: retrieval AND the payment's refunds listing both
        // error out. Reconciliation must not blind-mark the refund anything.
        Http::fake([
            'api.paymongo.com/v1/refunds/ref_recon_unknown' => Http::response(null, 500),
            'api.paymongo.com/v1/payments/pm_recon_unreachable/refunds' => Http::response(null, 500),
        ]);

        $this->artisan('payments:reconcile-refunds')->assertSuccessful();

        $this->assertDatabaseHas('payments', ['id' => $payment->id, 'status' => 'pending_refund']);
        $this->assertDatabaseHas('orders', ['id' => $order->id, 'payment_status' => 'paid']);
        $this->assertDatabaseHas('refunds', ['provider_refund_id' => 'ref_recon_unknown', 'status' => 'pending']);
    }

    // ─── cancelled order whose refund fails ───────────────────────────

    public function test_cancelled_order_whose_refund_fails_is_never_marked_refunded(): void
    {
        $order = $this->createOrder(total: 500.00, status: 'waiting_restaurant');
        $payment = $this->createPaidPayment($order, 'pm_cancel_fail');

        Http::fake([
            'api.paymongo.com/v1/payments/pm_cancel_fail/refunds' => Http::response(null, 500),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/food/order/'.$order->id.'/cancel', ['reason' => 'Change of plans']);

        $response->assertOk();

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'status' => 'cancelled_by_tourist',
            'payment_status' => 'paid',          // NOT refunded
            'refund_status' => 'failed',         // retryable by commands
        ]);
        $this->assertDatabaseHas('payments', ['id' => $payment->id, 'status' => 'paid']);
        $this->assertDatabaseMissing('payments', ['id' => $payment->id, 'status' => 'refunded']);
        $this->assertDatabaseMissing('orders', ['id' => $order->id, 'payment_status' => 'refunded']);
        $this->assertSame(0.0, (float) $order->fresh()->refunded_amount);
    }

    public function test_cancelled_order_whose_refund_succeeds_is_marked_refunded(): void
    {
        $order = $this->createOrder(total: 500.00, status: 'waiting_restaurant');
        $payment = $this->createPaidPayment($order, 'pm_cancel_ok');

        Http::fake([
            'api.paymongo.com/v1/payments/pm_cancel_ok/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_cancel_ok',
                    'attributes' => ['status' => 'succeeded'],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/food/order/'.$order->id.'/cancel');

        $response->assertOk();

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'status' => 'cancelled_by_tourist',
            'payment_status' => 'refunded',
            'refund_status' => 'refunded',
            'paymongo_refund_id' => 'ref_cancel_ok',
        ]);
        $this->assertDatabaseHas('payments', ['id' => $payment->id, 'status' => 'refunded']);
        $this->assertSame(500.00, (float) $order->fresh()->refunded_amount);
    }

    // ─── no duplicate financial effects ───────────────────────────────

    public function test_duplicate_requests_never_duplicate_financial_effects(): void
    {
        $order = $this->createOrder();
        $payment = $this->createPaidPayment($order, 'pm_effects');

        Http::fake([
            'api.paymongo.com/v1/payments/pm_effects/refunds' => Http::response([
                'data' => [
                    'id' => 'ref_effects',
                    'attributes' => ['status' => 'succeeded'],
                ],
            ], 200),
        ]);

        $url = '/api/payments/'.$payment->payment_number.'/refund';

        $this->actingAs($this->tourist, 'sanctum')->postJson($url)->assertOk();
        $this->assertSame(500.00, (float) $order->fresh()->refunded_amount);
        $this->assertSame(1, Refund::count());

        // Second request: rejected, no second provider refund, refunded_amount
        // untouched. Then a duplicate webhook: still exactly one ledger effect.
        $this->actingAs($this->tourist, 'sanctum')->postJson($url)
            ->assertStatus(422)
            ->assertJson(['message' => 'This payment has already been refunded.']);

        $this->postJson('/api/payments/webhook', $this->refundWebhookPayload('refund.succeeded', 'ref_effects'))->assertOk();

        $this->assertSame(1, Refund::count());
        $this->assertSame(500.00, (float) $order->fresh()->refunded_amount);
        $this->assertSame(500.00, (float) $order->fresh()->refund_amount);
    }
}