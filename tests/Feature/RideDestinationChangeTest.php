<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RideDestinationChange;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\RiderLocation;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\GpsService;
use App\Services\Integrity\TransactionIntegrityService;
use App\Services\RideDestinationChangeService;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Ride hailing — one-time destination change (owner decisions 2026-11-17):
 * once per trip after pickup; preview stores nothing; a signed quote and an
 * idempotency key make the confirm exact and repeat-safe; the final fare is
 * the verified GPS distance × the booked rates, capped at 115% of the
 * confirmed estimate; commission max(₱20, 40%) of the final fare; gaps,
 * jumps and jitter are never charged.
 */
class RideDestinationChangeTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private CarbonImmutable $t0;

    /** HTTP stub (OSRM router, socket bridge); a test may replace it. */
    private \Closure $http;

    /** Pickup and the booked destination (bookPayload). */
    private const PICKUP = [12.51, 121.31];

    /** The new destination: ~2.2 km north of the pickup. */
    private const NEW_DEST = [12.53, 121.31];

    /** Each track step moves ~55.6 m north. */
    private const STEP = 0.0005;

    protected function setUp(): void
    {
        parent::setUp();
        $this->http = fn () => Http::response([], 200);
        Http::fake(fn (HttpRequest $r) => ($this->http)($r));
        Cache::flush();
        $this->t0 = CarbonImmutable::parse('2026-11-17 08:00:00');
        $this->travelTo($this->t0);

        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@dest.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@dest.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);
    }

    // ───────────── helpers ─────────────

    private function onBoardRide(string $payment = 'gcash'): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => self::PICKUP[0], 'pickup_lng' => self::PICKUP[1], 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => $payment, 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update([
            'rider_id' => $this->rider->id, 'status' => 'picked_up', 'assigned_at' => $this->t0->subMinutes(5),
            'arrived_pickup_at' => $this->t0->subMinute(), 'picked_up_at' => $this->t0,
        ]);
        $order->update(['status' => 'confirmed']);

        return $order->fresh();
    }

    /** Saved fixes every 10 s, each STEP further north, for steps $from..$to (t0 + 10 s × step). */
    private function drive(int $from, int $to, float $accuracy = 6): void
    {
        for ($i = $from; $i <= $to; $i++) {
            $this->fix(self::PICKUP[0] + self::STEP * $i, self::PICKUP[1], $this->t0->addSeconds(10 * $i), $accuracy);
        }
    }

    private function fix(float $lat, float $lng, CarbonImmutable $at, float $accuracy = 6): void
    {
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => $lat, 'longitude' => $lng, 'accuracy_m' => $accuracy, 'recorded_at' => $at]);
    }

    private function metersBetweenSteps(int $from, int $to): float
    {
        $gps = app(GpsService::class);
        $sum = 0.0;
        for ($i = $from; $i < $to; $i++) {
            $sum += $gps->distanceMeters(self::PICKUP[0] + self::STEP * $i, self::PICKUP[1], self::PICKUP[0] + self::STEP * ($i + 1), self::PICKUP[1]);
        }

        return $sum;
    }

    private function preview(Order $order, array $dest = self::NEW_DEST)
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/destination-change/preview", [
            'destination_name' => 'Tambangan Falls', 'destination_address' => 'Tambangan, Bansud',
            'destination_lat' => $dest[0], 'destination_lng' => $dest[1],
        ]);
    }

    private function confirm(Order $order, string $token, string $key = 'key-aaaaaaaa')
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/destination-change", [
            'quote_token' => $token, 'idempotency_key' => $key,
        ]);
    }

    private function step(Order $order, string $status, array $extra = [])
    {
        $delivery = Delivery::where('order_id', $order->id)->sole();

        return $this->actingAs($this->rider, 'sanctum')->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => $status] + $extra);
    }

    /** GCash at the drop-off (2026-11-18): the payment is verified, then the rider confirms it. */
    private function payAndComplete(Order $order)
    {
        $order->refresh()->update(['payment_status' => 'paid', 'paid_amount' => $order->total]);

        return $this->step($order, 'delivered', ['payment_confirmed' => true]);
    }

    private function events(Order $order, string $type)
    {
        return TransactionEvent::query()->whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))->where('event_type', $type)->orderBy('sequence')->get();
    }

    private function check(Order $order, string $key): ?array
    {
        return collect(app(TransactionIntegrityService::class)->verifyOrder($order)['checks'])->firstWhere('key', $key);
    }

    /** Booked, on board, 20 steps driven, now at t0 + 205 s: preview + confirm the change. */
    private function changedRide(string $payment = 'gcash'): array
    {
        $order = $this->onBoardRide($payment);
        $this->drive(1, 20);
        $this->travelTo($this->t0->addSeconds(205));
        $preview = $this->preview($order)->assertOk();
        $this->confirm($order, $preview->json('data.quote_token'))->assertCreated();

        return [$order, $preview->json('data')];
    }

    // ───────────── eligibility ─────────────

    public function test_no_change_before_the_passenger_is_picked_up(): void
    {
        $order = $this->onBoardRide();
        Delivery::where('order_id', $order->id)->update(['status' => 'arrived_pickup', 'picked_up_at' => null]);
        $this->fix(12.51, 121.31, $this->t0);

        $this->preview($order)->assertStatus(422)->assertJsonPath('message', 'You can change the destination once your driver has picked you up.');
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")
            ->assertOk()->assertJsonPath('data.destination_change_allowed', false)->assertJsonPath('data.destination_changes_left', 1);
        $this->assertSame(0, RideDestinationChange::count());
    }

    public function test_no_change_after_completion_or_cancellation(): void
    {
        $order = $this->onBoardRide();
        $this->drive(1, 3);
        $order->update(['status' => 'completed']);
        $this->preview($order)->assertStatus(422)->assertJsonPath('message', 'This ride is already completed.');

        $cancelled = $this->onBoardRide();
        $cancelled->update(['status' => 'cancelled']);
        $this->preview($cancelled)->assertStatus(422)->assertJsonPath('message', 'This ride was cancelled.');
        $this->assertSame(0, RideDestinationChange::count());
    }

    public function test_another_tourist_cannot_preview_or_change_the_ride(): void
    {
        $order = $this->onBoardRide();
        $this->drive(1, 2);
        $other = User::create(['name' => 'Other', 'email' => 'other@dest.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->actingAs($other, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/destination-change/preview", [
            'destination_lat' => 12.53, 'destination_lng' => 121.31,
        ])->assertNotFound();
    }

    // ───────────── preview → confirm ─────────────

    public function test_preview_shows_the_revised_route_and_fare_and_stores_nothing(): void
    {
        $order = $this->onBoardRide();
        $this->drive(1, 20);
        $this->travelTo($this->t0->addSeconds(205));

        $data = $this->preview($order)->assertOk()->json('data');

        $notes = json_decode(Delivery::where('order_id', $order->id)->value('notes'), true);
        $base = (float) $notes['fare_quote']['base_fare'];
        $perKm = (float) $notes['fare_quote']['per_km'];
        $traveled = round($this->metersBetweenSteps(0, 20) / 1000, 3);
        $this->assertEqualsWithDelta($traveled, $data['traveled_km'], 0.0005);
        // OSRM is down in tests → straight line from the latest fix, labelled as such.
        $this->assertSame('straight_line', $data['route_source']);
        $expected = app(RideDestinationChangeService::class)->fare($base, $perKm, $data['traveled_km'] + $data['remaining_km']);
        $this->assertSame($expected, $data['estimated_fare']);
        $this->assertSame(round($expected * 1.15, 2), $data['max_fare']);
        $this->assertSame(1, $data['changes_left']);
        $this->assertNotEmpty($data['quote_token']);
        $this->assertCount(2, $data['route']);

        $this->assertSame(0, RideDestinationChange::count(), 'A preview never uses the change.');
        $this->assertSame('Pagasa', Delivery::where('order_id', $order->id)->value('delivery_address'));
    }

    public function test_the_revised_estimate_uses_the_road_route_when_available(): void
    {
        $this->http = fn (HttpRequest $r) => str_contains($r->url(), 'route/v1')
            ? Http::response(['code' => 'Ok', 'routes' => [['distance' => 1500, 'duration' => 240, 'geometry' => ['coordinates' => [[121.31, 12.52], [121.312, 12.525], [121.31, 12.53]]]]]])
            : Http::response([], 200);
        $order = $this->onBoardRide();
        $this->drive(1, 20);
        $this->travelTo($this->t0->addSeconds(205));

        $data = $this->preview($order)->assertOk()->json('data');
        $this->assertSame('osrm', $data['route_source']);
        $this->assertSame(1.5, $data['remaining_km']);
        $this->assertCount(3, $data['route']);
    }

    public function test_a_confirmed_change_updates_the_trip_keeps_the_original_and_tells_the_rider(): void
    {
        [$order, $preview] = $this->changedRide();

        $change = RideDestinationChange::sole();
        $delivery = Delivery::where('order_id', $order->id)->sole();
        // The same trip now goes to the new destination; the original is kept.
        $this->assertSame('Tambangan, Bansud', $delivery->delivery_address);
        $this->assertEqualsWithDelta(12.53, (float) $delivery->delivery_latitude, 0.0000001);
        $this->assertSame('Pagasa', $change->original_address);
        $this->assertEqualsWithDelta(12.60, $change->original_latitude, 0.0000001);
        $this->assertSame($this->tourist->id, (int) $change->requested_by);
        $this->assertSame($preview['estimated_fare'], $change->estimated_fare);
        $this->assertSame($preview['max_fare'], $change->max_fare);
        $this->assertSame((float) $order->total, $change->original_fare);
        $this->assertSame(1, Order::where('order_type', 'transport')->count(), 'No second booking.');
        $this->assertSame(1, Delivery::count(), 'No second trip.');

        // Ledger: the booking quote is untouched, the change is recorded.
        $this->assertCount(1, $this->events($order, 'ride_quoted'));
        $event = $this->events($order, 'ride_destination_changed')->sole();
        $this->assertSame('Pagasa', $event->payload['original']['address']);
        $this->assertEquals($preview['max_fare'], (float) $event->payload['max_fare']);

        // Realtime push to the rider, recorded separately from acknowledgement.
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/event')
            && $r['eventName'] === 'ride.destination.changed' && in_array('user:'.$this->rider->id, $r['rooms'], true));
        $this->assertSame('sent', $change->rider_notification_status);
        $this->assertNotNull($change->rider_notified_at);
        $this->assertNull($change->rider_acknowledged_at);

        // The tourist sees it, with no change left.
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")->assertOk()
            ->assertJsonPath('data.destination_address', 'Tambangan, Bansud')
            ->assertJsonPath('data.destination_change.original.address', 'Pagasa')
            ->assertJsonPath('data.destination_change.max_fare', $preview['max_fare'])
            ->assertJsonPath('data.destination_change_allowed', false)
            ->assertJsonPath('data.destination_changes_left', 0);
    }

    public function test_a_second_change_is_refused(): void
    {
        [$order] = $this->changedRide();
        $this->preview($order, [12.54, 121.31])->assertStatus(422)->assertJsonPath('message', 'You have already changed the destination of this ride.');
        $this->assertSame(1, RideDestinationChange::count());
    }

    public function test_two_simultaneous_requests_change_the_destination_once(): void
    {
        $order = $this->onBoardRide();
        $this->drive(1, 20);
        $this->travelTo($this->t0->addSeconds(205));
        $a = $this->preview($order)->assertOk()->json('data.quote_token');
        $b = $this->preview($order, [12.54, 121.31])->assertOk()->json('data.quote_token');

        $this->confirm($order, $a, 'key-first-1')->assertCreated();
        $this->confirm($order, $b, 'key-second-2')->assertStatus(409)->assertJsonPath('message', 'You have already changed the destination of this ride.');
        // The same request repeated (double tap / retry) returns the same change.
        $this->confirm($order, $a, 'key-first-1')->assertOk()->assertJsonPath('data.replayed', true);

        $this->assertSame(1, RideDestinationChange::count());
        $this->assertCount(1, $this->events($order, 'ride_destination_changed'));
        $this->assertEqualsWithDelta(12.53, (float) Delivery::where('order_id', $order->id)->value('delivery_latitude'), 0.0000001);

        // The database itself refuses a second change for the trip.
        $this->expectException(UniqueConstraintViolationException::class);
        RideDestinationChange::create(RideDestinationChange::sole()->only([
            'order_id', 'delivery_id', 'requested_by', 'original_latitude', 'original_longitude', 'new_latitude', 'new_longitude',
            'original_fare', 'original_commission', 'vehicle_type', 'base_fare', 'per_km', 'traveled_km_at_change',
            'remaining_km_estimate', 'remaining_route_source', 'estimated_fare', 'max_fare',
        ]) + ['idempotency_key' => 'key-race-3']);
    }

    public function test_a_rejected_or_expired_request_does_not_use_the_change(): void
    {
        $order = $this->onBoardRide();
        $this->drive(1, 20);
        $this->travelTo($this->t0->addSeconds(205));
        $token = $this->preview($order)->assertOk()->json('data.quote_token');

        // Tampered estimate.
        $this->confirm($order, 'not-a-real-quote', 'key-bad-1')->assertStatus(422);
        // A quote forged for a cheaper fare cannot be built without the app key.
        $forged = json_decode(Crypt::decryptString($token), true);
        $forged['user_id'] = 999;
        $this->confirm($order, Crypt::encryptString(json_encode($forged)), 'key-bad-2')->assertStatus(422);
        // Expired after 3 minutes.
        $this->travelTo($this->t0->addSeconds(205 + 181));
        $this->confirm($order, $token, 'key-late-3')->assertStatus(422)->assertJsonPath('message', 'This estimate has expired. Review the new destination again to see the current fare.');

        $this->assertSame(0, RideDestinationChange::count());
        $this->assertSame('Pagasa', Delivery::where('order_id', $order->id)->value('delivery_address'));

        // The allowance is still there.
        $this->fix(12.52, 121.31, $this->t0->addSeconds(205 + 180));
        $fresh = $this->preview($order)->assertOk()->json('data.quote_token');
        $this->confirm($order, $fresh, 'key-good-4')->assertCreated();
    }

    public function test_a_failed_rider_push_keeps_the_change_and_records_the_failure(): void
    {
        $this->http = fn (HttpRequest $r) => str_ends_with($r->url(), '/event') ? Http::response('down', 500) : Http::response([], 200);
        [$order] = $this->changedRide();

        $change = RideDestinationChange::sole();
        $this->assertSame('failed', $change->rider_notification_status);
        $this->assertNull($change->rider_notified_at);
        $this->assertSame('Tambangan, Bansud', Delivery::where('order_id', $order->id)->value('delivery_address'));
    }

    // ───────────── rider ─────────────

    public function test_the_rider_gets_the_new_destination_and_acknowledges_it(): void
    {
        [$order] = $this->changedRide();
        $delivery = Delivery::where('order_id', $order->id)->sole();

        $row = collect($this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/map/location')->assertOk()->json('data.deliveries'))->firstWhere('id', $delivery->id);
        $this->assertEqualsWithDelta(12.53, $row['delivery_lat'], 0.0000001);
        $this->assertSame('Tambangan, Bansud', $row['delivery_address']);
        $this->assertSame('Pagasa', $row['destination_change']['original']['address']);
        $this->assertNull($row['destination_change']['rider_acknowledged_at']);

        $intruder = User::create(['name' => 'Other Rider', 'email' => 'r2@dest.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->actingAs($intruder, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/destination-change/acknowledge")->assertForbidden();

        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/destination-change/acknowledge")->assertOk();
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/destination-change/acknowledge")->assertOk();
        $this->assertNotNull(RideDestinationChange::sole()->rider_acknowledged_at);
        $this->assertCount(1, $this->events($order, 'ride_destination_acknowledged'), 'Recorded once.');
    }

    // ───────────── final fare ─────────────

    public function test_the_final_fare_is_the_verified_distance_and_everything_reconciles(): void
    {
        [$order, $preview] = $this->changedRide();
        $this->drive(21, 40);
        $this->travelTo($this->t0->addSeconds(405));

        $this->step($order, 'arrived_destination')->assertOk();
        $change = RideDestinationChange::sole();
        $service = app(RideDestinationChangeService::class);

        $verified = round($this->metersBetweenSteps(0, 40) / 1000, 3);
        $this->assertEqualsWithDelta($verified, $change->verified_km, 0.0005);
        $this->assertEqualsWithDelta(0.0, $change->unverified_km, 0.0005);
        $expected = $service->fare($change->base_fare, $change->per_km, $change->verified_km);
        $this->assertSame($expected, $change->computed_fare);
        $this->assertSame(min($expected, $preview['max_fare']), $change->final_fare);
        $this->assertSame('ok', $change->fare_review_status);
        $commission = round(max(20, $change->final_fare * 0.4), 2);
        $this->assertSame($commission, $change->final_commission);

        // Order, ride item and commission follow the final fare; the booking is kept.
        $order->refresh();
        $this->assertSame($change->final_fare, (float) $order->total);
        $this->assertSame($change->final_fare, (float) $order->subtotal);
        $this->assertSame($change->final_fare, (float) $order->items()->first()->unit_price);
        $this->assertSame($commission, (float) Delivery::where('order_id', $order->id)->value('rider_commission'));
        $this->assertNotSame($change->original_fare, $change->final_fare);
        $this->assertEquals($change->original_fare, (float) $this->events($order, 'ride_quoted')->sole()->payload['fare']);

        // GCash: paid at the drop-off (the final fare), confirmed, completed → the rider earns the final commission.
        $this->payAndComplete($order)->assertOk();
        $this->assertSame($commission, (float) RiderEarning::where('order_id', $order->id)->sole()->total_earning);

        // The tourist sees and pays the final fare.
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")->assertOk()
            ->assertJsonPath('data.fare', $change->final_fare)
            ->assertJsonPath('data.destination_change.final_fare', $change->final_fare);

        // Ledger + integrity agree.
        $final = $this->events($order, 'ride_fare_finalized')->sole()->payload;
        $this->assertEquals($change->final_fare, (float) $final['final_fare']);
        $this->assertEquals($commission, (float) $final['rider_commission']);
        foreach (['amounts', 'ride_quote', 'ride_fare', 'ride_final_fare', 'ride_commission', 'ride_fare_gps'] as $key) {
            $this->assertTrue($this->check($order, $key)['ok'], $key.': '.json_encode($this->check($order, $key)));
        }
    }

    public function test_a_closer_destination_gives_a_lower_fare_than_the_booking(): void
    {
        $order = $this->onBoardRide();
        $this->drive(1, 4);
        $this->travelTo($this->t0->addSeconds(45));
        $token = $this->preview($order, [12.5025, 121.31] /* behind: ~0.8 km back */)->assertOk()->json('data.quote_token');
        $this->confirm($order, $token)->assertCreated();
        $this->fix(12.5075, 121.31, $this->t0->addSeconds(55));
        $this->fix(12.505, 121.31, $this->t0->addSeconds(65));
        $this->fix(12.5025, 121.31, $this->t0->addSeconds(75));
        $this->travelTo($this->t0->addSeconds(80));

        $this->step($order, 'arrived_destination')->assertOk();
        $change = RideDestinationChange::sole();
        $this->assertLessThan($change->original_fare, $change->final_fare);
        $this->assertGreaterThanOrEqual($change->base_fare, $change->final_fare);
    }

    public function test_the_final_fare_never_exceeds_115_percent_of_the_confirmed_estimate(): void
    {
        [$order, $preview] = $this->changedRide();
        // A long detour (still plausible speed): 40 steps east then back.
        for ($i = 1; $i <= 40; $i++) {
            $this->fix(12.52, 121.31 + self::STEP * $i, $this->t0->addSeconds(200 + 10 * $i));
        }
        for ($i = 39; $i >= 0; $i--) {
            $this->fix(12.52 + (40 - $i) * 0.00025, 121.31 + self::STEP * $i, $this->t0->addSeconds(600 + 10 * (40 - $i)));
        }
        $this->travelTo($this->t0->addSeconds(1005));

        $this->step($order, 'arrived_destination')->assertOk();
        $change = RideDestinationChange::sole();
        $this->assertGreaterThan($preview['max_fare'], $change->computed_fare);
        $this->assertSame($preview['max_fare'], $change->final_fare);
        $this->assertSame(round($change->computed_fare - $preview['max_fare'], 2), $change->cap_adjustment);
        $this->assertSame($preview['max_fare'], (float) $order->fresh()->total);
        $this->assertTrue($this->check($order, 'ride_final_fare')['ok']);
    }

    public function test_jitter_jumps_and_gaps_are_never_charged_and_flag_the_fare_for_review(): void
    {
        [$order] = $this->changedRide();
        // Standing still: jitter inside the GPS error adds nothing.
        foreach ([1, -1, 2, -2, 1] as $k => $wiggle) {
            $this->fix(12.52 + 0.00002 * $wiggle, 121.31, $this->t0->addSeconds(205 + 2 * $k));
        }
        // An impossible jump (5 km in 5 s) and back: excluded.
        $this->fix(12.565, 121.31, $this->t0->addSeconds(220));
        $this->fix(12.5205, 121.31, $this->t0->addSeconds(225));
        // A 3-minute gap covering ~1 km: not verified, not charged.
        $this->fix(12.529, 121.31, $this->t0->addSeconds(405));
        $this->fix(12.5295, 121.31, $this->t0->addSeconds(415));
        $this->fix(12.53, 121.31, $this->t0->addSeconds(425));
        $this->travelTo($this->t0->addSeconds(430));

        $this->step($order, 'arrived_destination')->assertOk();
        $change = RideDestinationChange::sole();
        $gps = app(GpsService::class);
        // Verified: pickup → 12.52 (20 steps), then 12.529 → 12.53 after the gap. The
        // jump out (12.52 → 12.565) and back (→ 12.5205) and the gap are excluded.
        $expected = ($this->metersBetweenSteps(0, 20)
            + $gps->distanceMeters(12.529, 121.31, 12.5295, 121.31)
            + $gps->distanceMeters(12.5295, 121.31, 12.53, 121.31)) / 1000;
        $this->assertEqualsWithDelta(round($expected, 3), $change->verified_km, 0.002);
        $this->assertGreaterThan(9.0, $change->unverified_km, 'The jump out and back and the gap are unverified.');
        $this->assertSame(2, $change->track_summary['jumps_excluded']);
        $this->assertSame(1, $change->track_summary['gap_count']);
        $this->assertGreaterThanOrEqual(3, $change->track_summary['jitter_fixes_ignored']);
        $this->assertSame('needs_review', $change->fare_review_status);
        $this->assertSame(app(RideDestinationChangeService::class)->fare($change->base_fare, $change->per_km, $change->verified_km), $change->final_fare);
        $this->assertTrue(ActivityLog::where('action', 'escalation.ride_fare_review')->exists());
        $this->assertFalse($this->check($order, 'ride_fare_gps')['ok']);
        $this->assertTrue($this->check($order, 'ride_final_fare')['ok']);
    }

    public function test_a_cash_ride_collects_the_final_fare(): void
    {
        [$order] = $this->changedRide('cash');
        $this->drive(21, 40);
        $this->travelTo($this->t0->addSeconds(405));

        $this->step($order, 'arrived_destination')->assertOk();
        $final = RideDestinationChange::sole()->final_fare;
        $this->step($order, 'delivered', ['payment_confirmed' => true])->assertOk();
        $delivery = Delivery::where('order_id', $order->id)->sole();
        $this->assertSame($final, (float) $delivery->cash_due, 'The cash to collect is the final fare.');

        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/settle-cod", ['cash_received' => $final])->assertOk();
        $this->assertSame(round(max(20, $final * 0.4), 2), (float) RiderEarning::where('order_id', $order->id)->sole()->total_earning);
    }

    public function test_a_ride_without_a_change_keeps_its_booked_fare(): void
    {
        $order = $this->onBoardRide();
        $booked = (float) $order->total;
        $this->drive(1, 40);
        $this->travelTo($this->t0->addSeconds(405));

        $this->step($order, 'arrived_destination')->assertOk();
        $this->payAndComplete($order)->assertOk();
        $this->assertSame($booked, (float) $order->fresh()->total);
        $this->assertCount(0, $this->events($order, 'ride_fare_finalized'));
    }
}
