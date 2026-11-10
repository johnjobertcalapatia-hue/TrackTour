<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Live GCash payments (decision 2026-11-10): outside local development and the
 * test suite, a PayMongo webhook is only trusted with a valid signature. With
 * no PAYMONGO_WEBHOOK_SECRET configured the server fails CLOSED instead of
 * accepting unsigned events — an unsigned "paid" event could otherwise mark an
 * order paid with no money received. Live-mode signatures (`li=`) verify.
 */
class PayMongoWebhookSecretTest extends TestCase
{
    use RefreshDatabase;

    private Order $order;

    protected function setUp(): void
    {
        parent::setUp();
        $tourist = User::create(['email' => 'live.tourist@test.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $business = Business::create(['owner_id' => $tourist->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id, 'business_name' => 'Live Restaurant', 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.45]);
        $this->order = Order::create([
            'order_number' => 'ORD-LIVE-1', 'business_id' => $business->id, 'user_id' => $tourist->id,
            'customer_name' => 'Tourist', 'customer_email' => $tourist->email, 'customer_phone' => '09123456789',
            'order_type' => 'pickup', 'payment_method' => 'gcash', 'payment_status' => 'pending', 'status' => 'pending_payment',
            'subtotal' => 300, 'delivery_fee' => 0, 'rider_tip' => 0, 'discount' => 0, 'total' => 300,
        ]);
        Payment::create([
            'payment_number' => 'PAY-LIVE-1', 'payable_type' => Order::class, 'payable_id' => $this->order->id,
            'user_id' => $tourist->id, 'amount' => 300, 'method' => 'gcash',
            'provider_payment_id' => 'pay_live_1', 'status' => 'pending',
        ]);
        config(['services.paymongo.secret_key' => 'sk_live_test_suite']);
    }

    private function paidEvent(): string
    {
        return json_encode(['data' => [
            'id' => 'evt_live_1', 'type' => 'event',
            'attributes' => ['type' => 'payment.paid', 'data' => ['id' => 'pay_live_1']],
        ]]);
    }

    private function send(string $body, ?string $signature)
    {
        $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        if ($signature !== null) {
            $headers['HTTP_PAYMONGO_SIGNATURE'] = $signature;
        }

        return $this->call('POST', '/api/payments/webhook', [], [], [], $headers, $body);
    }

    public function test_production_without_a_webhook_secret_rejects_unsigned_paid_events(): void
    {
        $this->app['env'] = 'production';
        config(['services.paymongo.webhook_secret' => '']);

        $this->send($this->paidEvent(), null)->assertStatus(400);

        $this->assertSame('pending', Payment::where('payment_number', 'PAY-LIVE-1')->value('status'));
        $this->assertSame('pending', $this->order->fresh()->payment_status);
    }

    public function test_production_rejects_a_forged_signature(): void
    {
        $this->app['env'] = 'production';
        config(['services.paymongo.webhook_secret' => 'whsk_live_secret']);
        $body = $this->paidEvent();
        $t = (string) time();

        $this->send($body, "t={$t},te=,li=".hash_hmac('sha256', $t.'.'.$body, 'not-the-secret'))->assertStatus(400);

        $this->assertSame('pending', $this->order->fresh()->payment_status);
    }

    public function test_production_accepts_a_valid_live_mode_signature(): void
    {
        $this->app['env'] = 'production';
        config(['services.paymongo.webhook_secret' => 'whsk_live_secret']);
        $body = $this->paidEvent();
        $t = (string) time();

        // Live mode: `te` is empty, the signature is in `li`.
        $this->send($body, "t={$t},te=,li=".hash_hmac('sha256', $t.'.'.$body, 'whsk_live_secret'))->assertOk();

        $this->assertSame('paid', Payment::where('payment_number', 'PAY-LIVE-1')->value('status'));
        $this->assertSame('paid', $this->order->fresh()->payment_status);
    }
}
