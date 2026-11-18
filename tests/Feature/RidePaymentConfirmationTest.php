<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\TransportationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Ride hailing — the rider confirms the payment before completing a ride
 * (owner decision 2026-11-18): GCash is payable at the drop-off and must be
 * verified paid; cash is confirmed received; an unpaid GCash ride may be
 * switched to cash at the drop-off; a GCash payment landing after that
 * switch never turns the ride back and is escalated for a manual refund.
 */
class RidePaymentConfirmationTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    /** HTTP stub (PayMongo, socket bridge); a test may replace it. */
    private ?\Closure $http = null;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(fn (HttpRequest $r) => $this->http ? ($this->http)($r) : Http::response([], 200));
        Cache::flush();
        config(['services.paymongo.secret_key' => 'sk_test_ride', 'services.paymongo.webhook_secret' => '']);

        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@pay.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@pay.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);
    }

    private function rideAt(string $status, string $payment = 'gcash'): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => $payment, 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update(['rider_id' => $this->rider->id, 'status' => $status, 'assigned_at' => now(), 'picked_up_at' => now()]);
        $order->update(['status' => 'confirmed']);

        return $order->fresh();
    }

    private function delivery(Order $order): Delivery
    {
        return Delivery::where('order_id', $order->id)->sole();
    }

    private function complete(Order $order, array $extra = [])
    {
        return $this->actingAs($this->rider, 'sanctum')->patchJson("/api/rider/deliveries/{$this->delivery($order)->id}/status", ['status' => 'delivered'] + $extra);
    }

    /** PayMongo reports the GCash payment paid (webhook). */
    private function gcashPaid(Order $order, string $ref = 'pay_ride_ok'): void
    {
        Payment::create([
            'payment_number' => 'PAY-'.$ref, 'payable_type' => Order::class, 'payable_id' => $order->id, 'user_id' => $this->tourist->id,
            'amount' => (float) $order->total, 'method' => 'gcash', 'provider' => 'paymongo', 'provider_payment_id' => $ref, 'status' => 'pending',
        ]);
        $this->postJson('/api/payments/webhook', ['data' => [
            'id' => 'evt_'.$ref, 'type' => 'event',
            'attributes' => ['type' => 'payment.paid', 'data' => ['id' => $ref]],
        ]])->assertOk();
    }

    private function events(Order $order, string $type)
    {
        return TransactionEvent::query()->whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))->where('event_type', $type)->get();
    }

    // ───────────── GCash ─────────────

    public function test_gcash_opens_at_the_drop_off_for_the_final_fare(): void
    {
        $captured = null;
        $this->http = function (HttpRequest $request) use (&$captured) {
            if (! str_contains($request->url(), 'api.paymongo.com/v1/checkout_sessions')) {
                return Http::response([], 200);
            }
            $captured = $request->data();

            return Http::response(['data' => ['id' => 'cs_ride', 'attributes' => ['status' => 'active', 'checkout_url' => 'https://checkout.paymongo.com/cs_ride']]], 200);
        };

        $order = $this->rideAt('in_transit');
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])
            ->assertStatus(422)->assertJsonPath('message', 'You can pay for this ride once you reach your destination.');

        $this->delivery($order)->update(['status' => 'arrived_destination']);
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])->assertOk();
        $this->assertSame((int) round($order->total * 100), $captured['data']['attributes']['line_items'][0]['amount']);
    }

    public function test_a_gcash_ride_cannot_be_completed_before_the_payment_is_verified(): void
    {
        $order = $this->rideAt('arrived_destination');

        $this->complete($order, ['payment_confirmed' => true])->assertStatus(422)
            ->assertJsonPath('message', 'The passenger\'s GCash payment of ₱'.number_format((float) $order->total, 2).' has not been received yet. Ask them to pay in the app, or switch the ride to cash.');
        $this->assertSame('arrived_destination', $this->delivery($order)->status->value, 'A refusal changes nothing.');
        $this->assertCount(0, $this->events($order, 'ride_payment_confirmed'));
    }

    public function test_a_paid_gcash_ride_still_needs_the_rider_to_confirm_it(): void
    {
        $order = $this->rideAt('arrived_destination');
        $this->gcashPaid($order);
        $this->assertSame('paid', $order->fresh()->payment_status);
        // The rider is told right away.
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/event') && in_array('user:'.$this->rider->id, $r['rooms'] ?? [], true));

        $this->complete($order)->assertStatus(422)
            ->assertJsonPath('message', 'Confirm that the passenger\'s GCash payment of ₱'.number_format((float) $order->total, 2).' was received before completing the ride.');
        $this->assertSame('arrived_destination', $this->delivery($order)->status->value);

        $this->complete($order, ['payment_confirmed' => true])->assertOk();
        $this->assertSame('completed', $this->delivery($order)->status->value);
        $confirmed = $this->events($order, 'ride_payment_confirmed')->sole()->payload;
        $this->assertSame('gcash', $confirmed['method']);
        $this->assertSame($this->rider->id, $confirmed['rider_id']);
        $this->assertTrue(RiderEarning::where('order_id', $order->id)->exists());
    }

    // ───────────── cash ─────────────

    public function test_a_cash_ride_needs_the_rider_to_confirm_the_cash(): void
    {
        $order = $this->rideAt('arrived_destination', 'cash');
        $fare = (float) $order->total;

        $this->complete($order)->assertStatus(422)
            ->assertJsonPath('message', 'Confirm that you received ₱'.number_format($fare, 2).' in cash before completing the ride.');
        $this->assertSame('arrived_destination', $this->delivery($order)->status->value);

        $this->complete($order, ['payment_confirmed' => true])->assertOk();
        $this->assertSame($fare, (float) $this->delivery($order)->cash_due);
        // The settlement still refuses less than the fare.
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$this->delivery($order)->id}/settle-cod", ['cash_received' => $fare - 1])->assertStatus(422);
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$this->delivery($order)->id}/settle-cod", ['cash_received' => $fare])->assertOk();
        $this->assertSame('cash', $this->events($order, 'ride_payment_confirmed')->sole()->payload['method']);
    }

    // ───────────── switch to cash ─────────────

    public function test_an_unpaid_gcash_ride_can_switch_to_cash_at_the_drop_off(): void
    {
        $order = $this->rideAt('in_transit');
        $url = "/api/rider/deliveries/{$this->delivery($order)->id}/ride-payment/cash";

        $this->actingAs($this->rider, 'sanctum')->postJson($url)->assertStatus(422)
            ->assertJsonPath('message', 'You can switch to cash only at the drop-off, before completing the ride.');

        $this->delivery($order)->update(['status' => 'arrived_destination']);
        $other = User::create(['name' => 'Other Rider', 'email' => 'r2@pay.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->actingAs($other, 'sanctum')->postJson($url)->assertStatus(403);

        $this->actingAs($this->rider, 'sanctum')->postJson($url)->assertOk();
        $this->assertSame('cash', $order->fresh()->payment_method);
        $this->assertSame('gcash', $this->events($order, 'ride_payment_switched_to_cash')->sole()->payload['from']);
        $this->assertTrue(ActivityLog::where('action', 'ride.payment_switched_to_cash')->exists());

        // Now a cash ride: confirm the cash, settle, done.
        $fare = (float) $order->total;
        $this->complete($order, ['payment_confirmed' => true])->assertOk();
        $this->assertSame($fare, (float) $this->delivery($order)->cash_due);
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$this->delivery($order)->id}/settle-cod", ['cash_received' => $fare])->assertOk();

        // The tourist can no longer open a GCash checkout for it.
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])
            ->assertStatus(422);
    }

    public function test_a_paid_gcash_ride_cannot_switch_to_cash(): void
    {
        $order = $this->rideAt('arrived_destination');
        $this->gcashPaid($order);

        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$this->delivery($order)->id}/ride-payment/cash")
            ->assertStatus(409)->assertJsonPath('message', 'The passenger has already paid with GCash. Complete the ride instead.');
        $this->assertSame('gcash', $order->fresh()->payment_method);
    }

    public function test_a_gcash_payment_after_the_switch_keeps_cash_and_is_escalated_for_refund(): void
    {
        $order = $this->rideAt('arrived_destination');
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$this->delivery($order)->id}/ride-payment/cash")->assertOk();

        // The passenger had the checkout open and pays anyway.
        $this->gcashPaid($order, 'pay_ride_late');

        $order->refresh();
        $this->assertSame('cash', $order->payment_method, 'The ride stays on cash.');
        $this->assertNotSame('paid', $order->payment_status);
        $this->assertCount(1, $this->events($order, 'ride_payment_after_cash_switch'));
        $this->assertTrue(ActivityLog::where('action', 'escalation.ride_payment_after_cash_switch')->exists());
    }
}
