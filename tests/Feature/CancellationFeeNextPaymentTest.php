<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\PaymentPenaltyItem;
use App\Models\RideCancellationPenalty;
use App\Models\RiderCancellationCompensation as Comp;
use App\Models\RiderDetail;
use App\Models\User;
use App\Services\PaymentRefundProcessor;
use App\Services\RideCancellationPenaltyService;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Owner decision 2026-11-23: an owed cancellation fee is added to the
 * tourist's NEXT payment — a ride or a food order. Online it is a line on the
 * same checkout, marked collected when that payment is confirmed; the order's
 * paid amount and refund limit exclude it. Cash (ride or COD food): the
 * driver / rider collects it with the payment and confirms it — it is never
 * that rider's earning; the rider who accepted the cancelled ride is
 * compensated once the money is received.
 */
class CancellationFeeNextPaymentTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $firstRider;

    private User $nextRider;

    private ?array $sentCheckout = null;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(function ($request) {
            if (! str_contains($request->url(), 'checkout_sessions')) {
                return Http::response([], 200);
            }
            $this->sentCheckout = $request->data()['data']['attributes'];

            return Http::response(['data' => ['id' => 'cs_next', 'attributes' => ['status' => 'active', 'checkout_url' => 'https://checkout.paymongo.com/cs_next']]], 200);
        });
        Cache::flush();
        config(['services.paymongo.secret_key' => 'sk_test_next', 'services.paymongo.webhook_secret' => '']);
        $this->travelTo(CarbonImmutable::parse('2026-11-23 10:00:00'));
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@next.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->firstRider = $this->rider('first@next.test', 'Aldrin Robledo');
        $this->nextRider = $this->rider('next@next.test', 'Ben Santos');
    }

    private function rider(string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        RiderDetail::create(['user_id' => $u->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);

        return $u;
    }

    private function ride(User $rider, string $status, string $payment): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => $payment, 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update(['rider_id' => $rider->id, 'status' => $status, 'assigned_at' => now()]);

        return $order->fresh();
    }

    private function owedPenalty(): RideCancellationPenalty
    {
        $earlier = $this->ride($this->firstRider, 'assigned', 'cash');
        $earlier->update(['status' => 'cancelled']);
        Delivery::where('order_id', $earlier->id)->update(['status' => 'cancelled']);

        return RideCancellationPenalty::create([
            'cancelled_order_id' => $earlier->id, 'delivery_id' => Delivery::where('order_id', $earlier->id)->value('id'),
            'tourist_id' => $this->tourist->id, 'compensated_rider_id' => $this->firstRider->id, 'penalty_amount' => 50,
            'acceptance_at' => now()->subMinutes(10), 'cancelled_at' => now(), 'seconds_after_acceptance' => 600,
            'status' => RideCancellationPenalty::STATUS_OWED, 'review_reasons' => [],
        ]);
    }

    private function foodOrder(string $payment = 'gcash'): Order
    {
        return Order::create([
            'order_number' => 'FOOD-'.uniqid(), 'user_id' => $this->tourist->id, 'customer_name' => 'Jayvie De Torres',
            'customer_email' => $this->tourist->email, 'order_type' => 'delivery', 'subtotal' => 250, 'delivery_fee' => 50,
            'total' => 300, 'payment_method' => $payment, 'payment_status' => 'pending', 'status' => 'pending',
        ]);
    }

    private function completeCheckout(): void
    {
        $this->postJson('/api/payments/webhook', ['data' => ['attributes' => ['type' => 'checkout_session.completed', 'data' => ['id' => 'cs_next', 'status' => 'completed']]]])->assertOk();
    }

    public function test_an_online_ride_payment_carries_the_owed_fee_and_collects_it_once(): void
    {
        $penalty = $this->owedPenalty();
        $ride = $this->ride($this->nextRider, 'arrived_destination', 'gcash');

        $res = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $ride->id, 'method' => 'gcash'])
            ->assertOk()->assertJsonPath('data.cancellation_fees', 50);

        $fareCents = (int) round((float) $ride->total * 100);
        $names = array_column($this->sentCheckout['line_items'], 'name');
        $this->assertContains('Ride Fare', $names);
        $this->assertStringStartsWith('Cancellation fee (ride ', end($names));
        $this->assertSame($fareCents + 5000, array_sum(array_column($this->sentCheckout['line_items'], 'amount')));
        $payment = Payment::sole();
        $this->assertEquals((float) $ride->total + 50, (float) $payment->amount);
        $this->assertSame(1, PaymentPenaltyItem::where('payment_id', $payment->id)->count());

        $this->completeCheckout();
        $this->completeCheckout(); // repeat-safe

        $penalty->refresh();
        $this->assertSame(RideCancellationPenalty::STATUS_COLLECTED, $penalty->status);
        $this->assertSame('online', $penalty->collection_method);
        $this->assertSame($payment->id, (int) $penalty->collection_payment_id);
        // The ride's paid amount is its own fare: the fee is not ride money.
        $this->assertEquals((float) $ride->total, (float) $ride->fresh()->paid_amount);
        // The rider who accepted the cancelled ride is compensated, once.
        $comp = Comp::sole();
        $this->assertSame($this->firstRider->id, (int) $comp->rider_id);
        $this->assertEquals(50.0, (float) $comp->amount);
        $this->assertNotNull(PaymentPenaltyItem::sole()->applied_at);
    }

    public function test_a_food_order_paid_online_carries_the_fee_but_never_refunds_it(): void
    {
        $this->owedPenalty();
        $order = $this->foodOrder();

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])
            ->assertOk()->assertJsonPath('data.cancellation_fees', 50);
        $this->assertSame(35000, array_sum(array_column($this->sentCheckout['line_items'], 'amount')));

        $payment = Payment::sole();
        $this->assertEquals(350.0, (float) $payment->amount);
        // If the food order is refunded, only its own ₱300 can go back.
        $this->assertEquals(300.0, app(PaymentRefundProcessor::class)->refundTotals($payment)['paid']);
    }

    public function test_cod_food_rider_collects_the_fee_at_the_door_and_it_is_not_their_earning(): void
    {
        $penalty = $this->owedPenalty();
        $order = $this->foodOrder('cod');
        $delivery = Delivery::create(['order_id' => $order->id, 'rider_id' => $this->nextRider->id, 'status' => 'in_transit', 'pickup_address' => 'Grill', 'delivery_address' => 'Home']);

        $due = app(RideCancellationPenaltyService::class)->dueOnDelivery($delivery);
        $this->assertSame($penalty->id, $due?->id);

        $this->actingAs($this->nextRider, 'sanctum')
            ->postJson("/api/rider/deliveries/{$delivery->id}/cancellation-fee/collect", ['penalty_id' => $penalty->id])
            ->assertOk();

        $penalty->refresh();
        $this->assertSame(RideCancellationPenalty::STATUS_COLLECTED, $penalty->status);
        $this->assertSame('cash', $penalty->collection_method);
        $this->assertSame($this->nextRider->id, (int) $penalty->collected_by);
        // Handed over with the day's cash, owed to the accepting rider, not this one.
        $this->assertSame($this->firstRider->id, (int) $penalty->compensated_rider_id);
        $this->assertNull(app(RideCancellationPenaltyService::class)->dueOnDelivery($delivery->fresh()));
        $this->assertFalse(Comp::where('rider_id', $this->nextRider->id)->exists());
    }

    public function test_nothing_is_added_when_nothing_is_owed(): void
    {
        $order = $this->foodOrder();
        $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])
            ->assertOk()->assertJsonPath('data.cancellation_fees', 0);
        $this->assertSame(30000, array_sum(array_column($this->sentCheckout['line_items'], 'amount')));
        $this->assertSame(0, PaymentPenaltyItem::count());
    }
}
