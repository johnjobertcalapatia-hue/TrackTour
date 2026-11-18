<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\RideAdditionalCharge;
use App\Models\RideDestinationChange;
use App\Models\RideTimeEvent;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\RiderLocation;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\Integrity\TransactionIntegrityService;
use App\Services\RideTimeChargeService;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Ride hailing — Stage A (owner decisions 2026-11-18): the rider confirms
 * arrival at the pickup (location checked, server time); waiting is free for
 * 180 s, then ₱2 per completed 180 s until the trip starts; the fee is an
 * itemised charge on top of the ride fare (total = subtotal + charges,
 * commission max(₱20, 40% × total)); rides no longer arrive automatically
 * from the GPS heartbeat — so a changed destination's final fare is always
 * applied (by the rider's arrival) before payment opens.
 */
class RidePickupWaitingTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private CarbonImmutable $t0;

    private ?\Closure $http = null;

    private const PICKUP = [12.51, 121.31];

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(fn (HttpRequest $r) => $this->http ? ($this->http)($r) : Http::response([], 200));
        Cache::flush();
        config(['services.paymongo.secret_key' => 'sk_test_ride', 'services.paymongo.webhook_secret' => '']);
        $this->t0 = CarbonImmutable::parse('2026-11-18 09:00:00');
        $this->travelTo($this->t0);

        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@wait.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@wait.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);
    }

    private function ride(string $payment = 'gcash', string $status = 'assigned'): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => self::PICKUP[0], 'pickup_lng' => self::PICKUP[1], 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => $payment, 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update(['rider_id' => $this->rider->id, 'status' => $status, 'assigned_at' => now()->subMinutes(4)]);
        $order->update(['status' => 'confirmed']);

        return $order->fresh();
    }

    private function delivery(Order $order): Delivery
    {
        return Delivery::where('order_id', $order->id)->sole();
    }

    private function fix(float $lat, float $lng, int $secondsAgo = 2, float $accuracy = 8): void
    {
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => $lat, 'longitude' => $lng, 'accuracy_m' => $accuracy, 'recorded_at' => now()->subSeconds($secondsAgo)]);
    }

    private function step(Order $order, string $status, array $extra = [], ?User $as = null)
    {
        return $this->actingAs($as ?? $this->rider, 'sanctum')->patchJson("/api/rider/deliveries/{$this->delivery($order)->id}/status", ['status' => $status] + $extra);
    }

    /** Confirm arrival at the pickup (saved fix there), wait $seconds, start the trip. */
    private function waitAndStart(Order $order, int $seconds): void
    {
        $this->fix(self::PICKUP[0] + 0.0002, self::PICKUP[1]);
        $this->step($order, 'arrived_pickup')->assertOk();
        $this->travelTo(now()->addSeconds($seconds));
        $this->step($order, 'picked_up')->assertOk();
    }

    private function events(Order $order, string $type)
    {
        return TransactionEvent::query()->whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))->where('event_type', $type)->orderBy('sequence')->get();
    }

    private function check(Order $order, string $key): ?array
    {
        return collect(app(TransactionIntegrityService::class)->verifyOrder($order)['checks'])->firstWhere('key', $key);
    }

    // ───────────── the rule ─────────────

    public function test_the_waiting_fee_rule_at_its_boundaries(): void
    {
        // floor(max(0, s − 180) / 180) × ₱2
        foreach ([0 => 0, 179 => 0, 180 => 0, 359 => 0, 360 => 2, 539 => 2, 540 => 4, 900 => 8] as $seconds => $fee) {
            $this->assertSame((float) $fee, RideTimeChargeService::waitingFee($seconds), "{$seconds} s");
        }
    }

    // ───────────── arrival confirmation ─────────────

    public function test_arrival_is_confirmed_by_the_rider_at_the_pickup_point_only(): void
    {
        $order = $this->ride();

        // Too far: refused, nothing recorded, waiting not started.
        $this->fix(12.52, 121.31); // ~1.1 km away
        $this->step($order, 'arrived_pickup')->assertStatus(422)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'within 100 m of the pickup point'));
        $this->assertSame('assigned', $this->delivery($order)->status->value);
        $this->assertSame(0, RideTimeEvent::count());

        // At the pickup: confirmed at the server time.
        $this->fix(self::PICKUP[0] + 0.0002, self::PICKUP[1]); // ~22 m
        $this->step($order, 'arrived_pickup')->assertOk();
        $event = RideTimeEvent::sole();
        $this->assertSame(RideTimeEvent::PICKUP_ARRIVAL_CONFIRMED, $event->event_type);
        $this->assertSame($this->rider->id, (int) $event->actor_id);
        $this->assertSame('rider', $event->actor_role);
        $this->assertSame('saved', $event->location_source);
        $this->assertTrue($event->occurred_at->equalTo($this->t0));
        $this->assertSame('arrived_pickup', $this->delivery($order)->status->value);
        $this->assertCount(1, $this->events($order, 'ride_time_event'));

        // A repeated confirmation keeps the first start.
        $this->travelTo($this->t0->addSeconds(90));
        $this->fix(self::PICKUP[0] + 0.0001, self::PICKUP[1]);
        $this->step($order, 'arrived_pickup')->assertOk();
        $this->assertSame(1, RideTimeEvent::count());
        $this->assertTrue(RideTimeEvent::sole()->occurred_at->equalTo($this->t0));
    }

    public function test_the_phone_fix_may_confirm_arrival_up_to_200_m_precision(): void
    {
        $order = $this->ride();
        $this->step($order, 'arrived_pickup', [
            'latitude' => self::PICKUP[0] + 0.0003, 'longitude' => self::PICKUP[1], 'accuracy' => 120, 'fix_at' => now()->toIso8601String(),
        ])->assertOk();
        $this->assertSame('device', RideTimeEvent::sole()->location_source);
    }

    public function test_only_the_assigned_rider_can_confirm_arrival(): void
    {
        $order = $this->ride();
        $other = User::create(['name' => 'Other', 'email' => 'other@wait.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->fix(self::PICKUP[0], self::PICKUP[1]);
        $this->step($order, 'arrived_pickup', [], $other)->assertForbidden();
        $this->assertSame(0, RideTimeEvent::count());
    }

    public function test_a_ride_never_arrives_by_itself_from_the_gps_heartbeat(): void
    {
        $order = $this->ride();
        $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/map/location', ['latitude' => self::PICKUP[0], 'longitude' => self::PICKUP[1], 'accuracy' => 5])->assertOk();
        $this->assertSame('assigned', $this->delivery($order)->status->value, 'Waiting starts only when the rider confirms arrival.');
        $this->assertSame(0, RideTimeEvent::count());

        // At the destination too: payment must not open before the rider confirms arrival.
        $this->delivery($order)->update(['status' => 'in_transit', 'picked_up_at' => now()]);
        $this->travelTo(now()->addMinutes(10));
        $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/map/location', ['latitude' => 12.60, 'longitude' => 121.40, 'accuracy' => 5])->assertOk();
        $this->assertSame('in_transit', $this->delivery($order)->status->value);
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])
            ->assertStatus(422)->assertJsonPath('message', 'You can pay for this ride once you reach your destination.');
    }

    // ───────────── the fee ─────────────

    public function test_a_short_wait_is_free_and_still_recorded(): void
    {
        $order = $this->ride();
        $booked = (float) $order->total;
        $this->waitAndStart($order, 359);

        $charge = RideAdditionalCharge::sole();
        $this->assertSame(359, $charge->duration_seconds);
        $this->assertSame(0.0, $charge->amount);
        $this->assertSame($booked, (float) $order->fresh()->total, 'No charge, no change.');
        $this->assertCount(0, $this->events($order, 'ride_charges_applied'));
        $this->assertNotNull(RideTimeEvent::where('event_type', RideTimeEvent::TRIP_STARTED)->first());
    }

    public function test_a_long_wait_is_charged_on_top_of_the_fare_and_everything_reconciles(): void
    {
        $order = $this->ride('cash');
        $fare = (float) $order->subtotal;
        $this->waitAndStart($order, 540);

        $charge = RideAdditionalCharge::sole();
        $this->assertSame(540, $charge->duration_seconds);
        $this->assertSame(4.0, $charge->amount);
        $this->assertSame('floor(max(0, seconds − 180) / 180) × ₱2', $charge->method);

        $order->refresh();
        $this->assertSame($fare, (float) $order->subtotal, 'The ride fare (booked quote) is untouched.');
        $this->assertSame(round($fare + 4, 2), (float) $order->total);
        $commission = round(max(20, ($fare + 4) * 0.4), 2);
        $this->assertSame($commission, (float) $this->delivery($order)->rider_commission);
        $applied = $this->events($order, 'ride_charges_applied')->sole()->payload;
        $this->assertEquals(4, (float) $applied['charges_total']);

        // A retried "passenger on board" never charges twice.
        $this->step($order, 'picked_up')->assertStatus(409);
        $this->assertSame(1, RideAdditionalCharge::count());

        // Cash at the drop-off: the total including the waiting fee; the rider earns the commission on it.
        $this->step($order, 'arrived_destination')->assertOk();
        $this->step($order, 'delivered', ['payment_confirmed' => true])->assertOk();
        $this->assertSame(round($fare + 4, 2), (float) $this->delivery($order)->cash_due);
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$this->delivery($order)->id}/settle-cod", ['cash_received' => round($fare + 4, 2)])->assertOk();
        $this->assertSame($commission, (float) RiderEarning::where('order_id', $order->id)->sole()->total_earning);

        foreach (['amounts', 'ride_quote', 'ride_fare', 'ride_charges', 'ride_commission'] as $key) {
            $this->assertTrue($this->check($order, $key)['ok'], $key.': '.json_encode($this->check($order, $key)));
        }
    }

    public function test_gcash_is_itemised_and_the_tourist_sees_the_waiting_fee(): void
    {
        $captured = null;
        $this->http = function (HttpRequest $request) use (&$captured) {
            if (! str_contains($request->url(), 'checkout_sessions')) {
                return Http::response([], 200);
            }
            $captured = $request->data();

            return Http::response(['data' => ['id' => 'cs_w', 'attributes' => ['status' => 'active', 'checkout_url' => 'https://checkout.paymongo.com/cs_w']]], 200);
        };
        $order = $this->ride();
        $fare = (float) $order->subtotal;
        $this->waitAndStart($order, 400); // 220 s past the free 180 → one 180 s unit → ₱2

        $status = $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")->assertOk();
        $status->assertJsonPath('data.ride_fare', $fare)
            ->assertJsonPath('data.charges_total', 2)
            ->assertJsonPath('data.fare', round($fare + 2, 2))
            ->assertJsonPath('data.additional_charges.0.label', 'Pickup waiting')
            ->assertJsonPath('data.pickup_waiting.free_seconds', 180)
            ->assertJsonPath('data.pickup_waiting.charged_seconds', 400);

        $this->step($order, 'arrived_destination')->assertOk();
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])->assertOk();
        $lines = $captured['data']['attributes']['line_items'];
        $this->assertSame(['Ride Fare', 'Pickup waiting'], array_column($lines, 'name'));
        $this->assertSame((int) round($fare * 100), $lines[0]['amount']);
        $this->assertSame(200, $lines[1]['amount']);
        $this->assertSame((int) round(($fare + 2) * 100), array_sum(array_column($lines, 'amount')));
    }

    public function test_no_confirmed_arrival_means_no_waiting_fee(): void
    {
        // A ride already at the pickup from before this change (no confirmation event).
        $order = $this->ride('gcash', 'arrived_pickup');
        $this->travelTo(now()->addMinutes(20));
        $this->step($order, 'picked_up')->assertOk();
        $this->assertSame(0, RideAdditionalCharge::count());
    }

    public function test_cancelling_while_the_rider_waits_charges_nothing(): void
    {
        $order = $this->ride();
        $this->fix(self::PICKUP[0], self::PICKUP[1]);
        $this->step($order, 'arrived_pickup')->assertOk();
        $this->travelTo(now()->addMinutes(12));
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/cancel", ['reason' => 'changed_plans'])->assertOk();
        $this->assertSame('cancelled', $order->fresh()->status);
        $this->assertSame(0, RideAdditionalCharge::count());
    }

    public function test_a_changed_destination_keeps_its_cap_and_the_waiting_fee_stays_on_top(): void
    {
        $order = $this->ride();
        $this->waitAndStart($order, 540); // ₱4
        // Drive north ~1.1 km with fixes, then change the destination.
        for ($i = 1; $i <= 20; $i++) {
            $this->fix(self::PICKUP[0] + 0.0005 * $i, self::PICKUP[1], 0);
            $this->travelTo(now()->addSeconds(10));
        }
        $preview = $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/destination-change/preview", [
            'destination_name' => 'Tambangan', 'destination_lat' => 12.53, 'destination_lng' => 121.31,
        ])->assertOk()->json('data');
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/destination-change", [
            'quote_token' => $preview['quote_token'], 'idempotency_key' => 'key-wait-change',
        ])->assertCreated();
        for ($i = 21; $i <= 40; $i++) {
            $this->fix(self::PICKUP[0] + 0.0005 * $i, self::PICKUP[1], 0);
            $this->travelTo(now()->addSeconds(10));
        }

        $this->step($order, 'arrived_destination')->assertOk();
        $change = RideDestinationChange::sole();
        $order->refresh();
        $this->assertLessThanOrEqual($change->max_fare, $change->final_fare, 'The cap covers the ride fare only.');
        $this->assertSame($change->final_fare, (float) $order->subtotal);
        $this->assertSame(round($change->final_fare + 4, 2), (float) $order->total, 'The waiting fee stays on top of the final fare.');
        $this->assertSame(round(max(20, ($change->final_fare + 4) * 0.4), 2), (float) $this->delivery($order)->rider_commission);
        $this->assertTrue($this->check($order, 'ride_final_fare')['ok']);
        $this->assertTrue($this->check($order, 'ride_charges')['ok'], json_encode($this->check($order, 'ride_charges')));
    }
}
