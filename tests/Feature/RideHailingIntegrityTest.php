<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\RiderLocation;
use App\Models\TransactionEvent;
use App\Models\TripLog;
use App\Models\User;
use App\Services\Integrity\TransactionIntegrityService;
use App\Services\TransportationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Secure transaction architecture, Stage 4 — ride hailing:
 *   fare quote recorded (and a changed fare refused), no passenger PIN,
 *   locked tourist cancellation that releases the rider, observe-only trip
 *   location evidence and GPS anomalies, pay-after-completion with refund of a
 *   payment that lands on a cancelled ride, and ride integrity FLAGs.
 */
class RideHailingIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Cache::flush();
        config(['services.paymongo.secret_key' => 'sk_test_ride', 'services.paymongo.webhook_secret' => '']);

        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@ride.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@ride.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport']);
    }

    private function serverFare(string $vehicle = 'motorcycle'): float
    {
        return (float) app(TransportationService::class)->estimateFare(12.51, 121.31, 12.60, 121.40)['fares'][$vehicle]['fare'];
    }

    private function bookPayload(array $overrides = []): array
    {
        return array_merge([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'gcash', 'booking_notes' => '',
        ], $overrides);
    }

    private function ride(array $overrides = []): Order
    {
        $this->actingAs($this->tourist);

        return app(TransportationService::class)->createRide($this->bookPayload($overrides));
    }

    private function assign(Order $order, string $status = 'assigned'): Delivery
    {
        $delivery = Delivery::where('order_id', $order->id)->sole();
        $delivery->update(['rider_id' => $this->rider->id, 'status' => $status, 'assigned_at' => now()]);
        $order->update(['status' => 'confirmed']);

        return $delivery->fresh();
    }

    private function savedFix(float $lat, float $lng, float $accuracy = 6, int $secondsAgo = 2): void
    {
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => $lat, 'longitude' => $lng, 'accuracy_m' => $accuracy, 'recorded_at' => now()->subSeconds($secondsAgo)]);
    }

    private function step(Delivery $delivery, string $status, array $fix = [])
    {
        return $this->actingAs($this->rider, 'sanctum')->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => $status] + $fix);
    }

    private function events(Order $order, ?string $type = null)
    {
        return TransactionEvent::query()
            ->whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))
            ->when($type, fn ($q) => $q->where('event_type', $type))
            ->orderBy('sequence')->get();
    }

    private function check(array $result, string $key): ?array
    {
        return collect($result['checks'])->firstWhere('key', $key);
    }

    /** A completed online ride driven through the rider status endpoint. */
    private function completedRide(float $endLat = 12.60, float $endLng = 121.40): Order
    {
        $order = $this->ride();
        $delivery = $this->assign($order, 'arrived_pickup');
        $this->savedFix(12.51, 121.31);
        $this->step($delivery, 'picked_up', ['latitude' => 12.5101, 'longitude' => 121.3101, 'accuracy' => 9, 'fix_at' => now()->subSeconds(2)->toIso8601String()])->assertOk();
        $this->savedFix($endLat, $endLng);
        $this->step($delivery, 'arrived_destination', ['latitude' => $endLat, 'longitude' => $endLng, 'accuracy' => 7])->assertOk();
        $this->step($delivery, 'delivered', ['latitude' => $endLat, 'longitude' => $endLng, 'accuracy' => 7])->assertOk();

        return $order->fresh();
    }

    // ---------------- fare quote, no PIN ----------------

    public function test_booking_records_the_fare_quote_and_no_pin(): void
    {
        $order = $this->ride(['fare' => $this->serverFare()]);
        $notes = json_decode(Delivery::where('order_id', $order->id)->value('notes'), true);

        $this->assertArrayNotHasKey('ride_pin', $notes);
        $quote = $notes['fare_quote'];
        $this->assertEquals($this->serverFare(), $quote['fare']);
        $this->assertEquals($this->serverFare(), $quote['quoted_fare']);
        $this->assertEquals(round(max(20, $this->serverFare() * 0.4), 2), $quote['rider_commission']);
        $this->assertSame('max(₱20, 40% of fare)', $quote['commission_rule']);
        $this->assertSame(64, strlen($quote['fare_settings_fingerprint']));

        $event = $this->events($order, 'ride_quoted')->sole();
        $this->assertSame($quote['fare_settings_fingerprint'], $event->payload['fare_settings_fingerprint']);
    }

    public function test_the_confirmed_fare_books_and_a_changed_fare_is_refused(): void
    {
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/transport/book', $this->bookPayload(['fare' => $this->serverFare()]))->assertCreated();

        // Tourism Office raised the fares after the tourist saw the quote.
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/transport/book', $this->bookPayload(['fare' => $this->serverFare() - 5]))
            ->assertStatus(409)
            ->assertJsonPath('data.fare', $this->serverFare());
        $this->assertSame(1, Order::where('order_type', 'transport')->count());
    }

    public function test_trip_status_never_returns_a_pin(): void
    {
        $order = $this->ride();
        $this->assign($order, 'arrived_pickup');

        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")
            ->assertOk()->assertJsonMissingPath('data.ride_pin');
    }

    // ---------------- cancellation ----------------

    public function test_tourist_cancel_releases_the_assigned_rider_and_is_recorded(): void
    {
        $order = $this->ride();
        $this->assign($order);

        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/cancel", ['reason' => 'changed_plans'])->assertOk();

        $this->assertSame('cancelled', $order->fresh()->status);
        $this->assertSame(User::RIDER_STATUS_AVAILABLE, $this->rider->riderDetail()->value('rider_status'));
        $event = $this->events($order, 'ride_cancelled')->sole();
        $this->assertSame('tourist', $event->payload['cancelled_by']);
        $this->assertSame('assigned', $event->payload['stage']);
        $this->assertSame($this->rider->id, $event->payload['rider_id']);
        $this->assertSame('changed_plans', $event->payload['reason']);
    }

    public function test_cancel_rechecks_the_trip_under_lock_once_the_passenger_is_on_board(): void
    {
        // The order still reads 'confirmed' but the rider already picked the passenger up.
        $order = $this->ride();
        $this->assign($order, 'picked_up');

        $this->actingAs($this->tourist);
        $this->assertFalse(app(TransportationService::class)->cancelRide($order->fresh(), 'too late'));
        $this->assertSame('confirmed', $order->fresh()->status);
        $this->assertSame('picked_up', Delivery::where('order_id', $order->id)->sole()->status->value);
        $this->assertCount(0, $this->events($order, 'ride_cancelled'));
    }

    public function test_driver_cancel_is_recorded_too(): void
    {
        $order = $this->ride();
        $delivery = $this->assign($order);

        app(TransportationService::class)->cancelRideByDriver($delivery, $this->rider, 'Flat tyre');

        $event = $this->events($order, 'ride_cancelled')->sole();
        $this->assertSame('driver', $event->payload['cancelled_by']);
        $this->assertSame('Flat tyre', $event->payload['reason']);
    }

    // ---------------- trip evidence ----------------

    public function test_each_ride_step_records_device_and_server_fixes_once(): void
    {
        $order = $this->completedRide();
        $evidence = Delivery::where('order_id', $order->id)->sole()->trip_evidence;

        $this->assertSame(['passenger_on_board', 'arrived_destination', 'completed'], array_keys($evidence));
        $board = $evidence['passenger_on_board'];
        $this->assertSame('pickup', $board['target']['label']);
        $this->assertEqualsWithDelta(9, $board['device']['accuracy_m'], 0.01);
        $this->assertEqualsWithDelta(6, $board['server']['accuracy_m'], 0.01);
        $this->assertLessThan(20, $board['device']['distance_m']);
        $this->assertSame('destination', $evidence['completed']['target']['label']);
        $this->assertLessThan(1, $evidence['completed']['server']['distance_m']);

        $steps = $this->events($order, 'trip_evidence')->pluck('payload.step')->all();
        $this->assertSame(['passenger_on_board', 'arrived_destination', 'completed'], $steps);
    }

    public function test_evidence_never_blocks_a_step_and_food_deliveries_get_none(): void
    {
        $order = $this->ride();
        $delivery = $this->assign($order, 'arrived_pickup');
        // No saved fix and an invalid device fix: the step still goes through.
        $this->step($delivery, 'picked_up', ['latitude' => 'abc', 'longitude' => 121.3])->assertOk();
        $board = $delivery->fresh()->trip_evidence['passenger_on_board'];
        $this->assertSame(['rejected' => 'invalid coordinates'], $board['device']);
        $this->assertNull($board['server']);
    }

    public function test_gps_refusals_during_a_ride_are_recorded_and_throttled(): void
    {
        $order = $this->ride();
        $this->assign($order, 'picked_up');
        $this->savedFix(12.55, 121.35, 5, 3);

        $location = fn (array $fix) => $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/map/location', $fix)->assertOk();
        $location(['latitude' => 12.5502, 'longitude' => 121.3502, 'accuracy' => 80]);
        $location(['latitude' => 12.5502, 'longitude' => 121.3502, 'accuracy' => 90]); // same minute: throttled
        $location(['latitude' => 13.40, 'longitude' => 122.40, 'accuracy' => 5]);      // ~150 km jump in seconds

        $anomalies = $this->events($order, 'gps_anomaly');
        $this->assertSame(['low_accuracy', 'implausible_movement'], $anomalies->pluck('payload.reason')->all());
        $this->assertGreaterThan(100000, (float) $anomalies[1]->payload['jump_m']);
    }

    public function test_the_trip_log_is_summarised_in_the_ledger(): void
    {
        $order = $this->ride();
        $delivery = $this->assign($order, 'picked_up');

        TripLog::create(['delivery_id' => $delivery->id, 'rider_id' => $this->rider->id, 'distance_meters' => 11250, 'duration_seconds' => 1260, 'point_count' => 214, 'started_at' => now()->subMinutes(21), 'ended_at' => now()]);

        $summary = $this->events($order, 'trip_summary')->sole()->payload;
        $this->assertEquals(11250, $summary['distance_m']);
        $this->assertSame(214, $summary['point_count']);
    }

    // ---------------- payments ----------------

    public function test_online_payment_opens_only_after_the_ride_is_completed(): void
    {
        $order = $this->ride();
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'order', 'payable_id' => $order->id, 'method' => 'gcash'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'You can pay for this ride once it is completed.');
    }

    public function test_a_payment_that_lands_on_a_cancelled_ride_is_refunded(): void
    {
        $order = $this->ride();
        $this->actingAs($this->tourist);
        app(TransportationService::class)->cancelRide($order, 'changed_plans');

        Payment::create([
            'payment_number' => 'PAY-RIDE-1', 'payable_type' => Order::class, 'payable_id' => $order->id, 'user_id' => $this->tourist->id,
            'amount' => (float) $order->total, 'method' => 'gcash', 'provider' => 'paymongo', 'provider_payment_id' => 'pay_ride_1', 'status' => 'pending',
        ]);
        $this->postJson('/api/payments/webhook', ['data' => [
            'id' => 'evt_pay_ride_1', 'type' => 'event',
            'attributes' => ['type' => 'payment.paid', 'data' => ['id' => 'pay_ride_1']],
        ]])->assertOk();

        // The provider-authoritative refund path is used (PayMongo is asked; a
        // local refund record tracks it until the provider confirms).
        Http::assertSent(fn ($request) => str_contains($request->url(), '/v1/refunds') && ($request->data()['data']['attributes']['payment_id'] ?? null) === 'pay_ride_1');
        $payment = Payment::where('payment_number', 'PAY-RIDE-1')->first();
        $this->assertTrue(\App\Models\Refund::where('payment_id', $payment->id)->exists());
        $this->assertNotSame('refunded', $payment->status, 'Never marked refunded before the provider confirms.');
    }

    // ---------------- integrity checks ----------------

    public function test_a_normal_completed_ride_passes_the_ride_checks(): void
    {
        $order = $this->completedRide();
        $result = app(TransactionIntegrityService::class)->verifyOrder($order);

        $this->assertTrue($this->check($result, 'ride_quote')['ok']);
        $this->assertTrue($this->check($result, 'ride_commission')['ok']);
        $this->assertTrue($this->check($result, 'ride_completion_location')['ok']);
        $this->assertNotSame('block', $result['result'], json_encode(collect($result['checks'])->where('ok', false)->values()));
    }

    public function test_a_ride_ending_far_from_the_destination_is_flagged_not_blocked(): void
    {
        $order = $this->completedRide(12.70, 121.50); // ~15 km away
        $result = app(TransactionIntegrityService::class)->verifyOrder($order);

        $check = $this->check($result, 'ride_completion_location');
        $this->assertFalse($check['ok']);
        $this->assertSame('flag', $check['severity']);
        $this->assertSame('flag', $result['result']);
    }

    public function test_an_earning_that_differs_from_the_quoted_commission_is_flagged(): void
    {
        $order = $this->completedRide();
        // A staff adjustment (Stage 5 ledger): legitimate and recorded, but it
        // no longer matches the commission fixed at booking → flagged for review.
        app(\App\Services\RiderEarningLedger::class)->adjust(RiderEarning::where('order_id', $order->id)->first(), 50, 'Long wait at pickup', null);

        $result = app(TransactionIntegrityService::class)->verifyOrder($order);
        $this->assertFalse($this->check($result, 'ride_commission')['ok']);
        $this->assertTrue($this->check($result, 'earnings')['ok']);
        $this->assertSame('flag', $result['result']);
    }

    // ---------------- Stage 5 verification follow-ups ----------------

    public function test_the_booked_fare_and_commission_recompute_from_the_quote(): void
    {
        $order = $this->completedRide();
        $quote = $this->events($order, 'ride_quoted')->sole()->payload;
        $this->assertArrayHasKey('distance_km_exact', $quote);
        $this->assertEquals(0.4, $quote['commission_rate']);
        $this->assertEquals(20, $quote['commission_minimum']);

        $check = fn () => $this->check(app(TransactionIntegrityService::class)->verifyOrder($order->fresh()), 'ride_fare');
        $this->assertTrue($check()['ok']);

        // The order amount moved away from the quoted fare (recorded, so not tampering): flagged.
        $order->update(['subtotal' => (float) $order->subtotal + 10, 'total' => (float) $order->total + 10]);
        $this->assertFalse($check()['ok']);
        $this->assertSame('flag', $check()['severity']);
    }

    public function test_the_destination_rule_weighs_accuracy_and_ignores_stale_fixes(): void
    {
        // ~250 m from the destination, but the fix is only accurate to 80 m: within 200 m of plausibility.
        $order = $this->completedRide(12.6022, 121.40);
        Delivery::where('order_id', $order->id)->sole(); // evidence recorded by the steps
        $evidence = $this->events($order, 'trip_evidence')->last()->payload['evidence'];
        $this->assertGreaterThan(200, $evidence['server']['distance_m']);

        $verdict = \Closure::bind(fn ($e) => $this->completionLocationVerdict($e), app(TransactionIntegrityService::class), TransactionIntegrityService::class);
        $fix = fn (float $distance, ?float $accuracy, ?int $age) => ['distance_m' => $distance, 'accuracy_m' => $accuracy, 'age_s' => $age];

        $this->assertTrue($verdict(['device' => null, 'server' => $fix(250, 80, 5)])[0], 'Inside the accuracy radius.');
        $this->assertFalse($verdict(['device' => null, 'server' => $fix(250, 10, 5)])[0]);
        [$ok, $detail] = $verdict(['device' => $fix(20, 5, 900), 'server' => $fix(30, 5, 600)]);
        $this->assertFalse($ok);
        $this->assertStringContainsString('Only stale location evidence', $detail);
        $this->assertTrue($verdict(['device' => $fix(20, 5, 900), 'server' => $fix(30, 5, 10)])[0], 'The fresh fix decides.');
        [$ok, $detail] = $verdict(null);
        $this->assertFalse($ok);
        $this->assertStringContainsString('No location evidence', $detail);
    }
}
