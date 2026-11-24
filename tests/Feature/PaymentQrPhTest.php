<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use App\Services\TransportationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * QR Ph (2026-11-18): "pay online" opens PayMongo with GCash and QR Ph; the
 * payment stays method 'gcash' (online via PayMongo) for settlement and
 * refunds, and paid_via tells the tourist which one they used.
 */
class PaymentQrPhTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private ?array $sent = null;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.paymongo.secret_key' => 'sk_test_qrph']);
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@qrph.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        Http::fake([
            'api.paymongo.com/v1/checkout_sessions' => function ($request) {
                $this->sent = $request->data()['data']['attributes'] ?? null;

                return Http::response(['data' => ['id' => 'cs_qrph', 'attributes' => ['status' => 'active', 'checkout_url' => 'https://checkout.paymongo.com/cs_qrph']]], 200);
            },
            '*' => Http::response([], 200),
        ]);
    }

    private function completedRide(): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'gcash', 'booking_notes' => '',
        ]);
        $order->update(['status' => 'completed']);

        return $order->fresh();
    }

    private function payOnline(Order $order, string $method = 'gcash')
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => $method]);
    }

    public function test_paying_online_offers_gcash_and_qr_ph_and_records_the_online_channel(): void
    {
        $order = $this->completedRide();
        $this->payOnline($order)->assertOk();

        $this->assertSame(['gcash', 'qrph'], $this->sent['payment_method_types']);
        // Settlement and refunds keep working on the online channel.
        $this->assertSame('gcash', Payment::sole()->method);
    }

    public function test_qr_ph_can_be_switched_off_for_an_account_without_it(): void
    {
        config(['services.paymongo.online_methods' => ['gcash']]);
        $this->payOnline($this->completedRide())->assertOk();
        $this->assertSame(['gcash'], $this->sent['payment_method_types']);
    }

    public function test_card_stays_card_only(): void
    {
        $this->payOnline($this->completedRide(), 'card')->assertOk();
        $this->assertSame(['card'], $this->sent['payment_method_types']);
    }

    public function test_paid_via_reads_what_paymongo_reports(): void
    {
        $paid = fn (array $meta, string $status = 'paid') => new Payment(['status' => $status, 'method' => 'gcash', 'metadata' => $meta]);

        // checkout_session.payment.paid webhook: a payment resource.
        $this->assertSame('qrph', $paid(['checkout_session_payment_paid' => ['id' => 'pay_1', 'attributes' => ['source' => ['type' => 'qrph']]]])->paidVia());
        // checkout_session webhook / verify: the session's payment_method_used.
        $this->assertSame('gcash', $paid(['checkout_session' => ['attributes' => ['payment_method_used' => 'gcash']]])->paidVia());
        $this->assertSame('qrph', $paid(['checkout_session' => ['payment_method_used' => 'qrph']])->paidVia());
        // The session's payments list.
        $this->assertSame('qrph', $paid(['checkout_session' => ['payments' => [['attributes' => ['source' => ['type' => 'qrph']]]]]])->paidVia());
        // Still known after a refund.
        $this->assertSame('qrph', $paid(['webhook_data' => ['attributes' => ['source' => ['type' => 'qrph']]]], 'refunded')->paidVia());
        // Unknown or not paid.
        $this->assertNull($paid([])->paidVia());
        $this->assertNull($paid(['checkout_session' => ['payment_method_used' => 'qrph']], 'pending')->paidVia());
    }

    public function test_the_ride_shows_it_was_paid_via_qr_ph(): void
    {
        $order = $this->completedRide();
        Delivery::where('order_id', $order->id)->update(['status' => 'delivered']);
        $order->update(['payment_status' => 'paid', 'paid_amount' => $order->total]);
        Payment::create([
            'payment_number' => 'PAY-QRPH0001', 'payable_type' => Order::class, 'payable_id' => $order->id, 'user_id' => $this->tourist->id,
            'amount' => $order->total, 'method' => 'gcash', 'provider' => 'paymongo', 'provider_payment_id' => 'cs_qrph', 'status' => 'paid', 'paid_at' => now(),
            'metadata' => ['checkout_session_payment_paid' => ['id' => 'pay_qrph', 'attributes' => ['source' => ['type' => 'qrph']]]],
        ]);

        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")
            ->assertOk()
            ->assertJsonPath('data.paid_via', 'qrph');
    }
}
