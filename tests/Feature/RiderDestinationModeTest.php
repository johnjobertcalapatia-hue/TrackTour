<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\RiderDestinationService;
use App\Services\WebsocketNotifierService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Rider "My Destination" (2026-11-11): while set, offers are limited to jobs
 * whose pickup(s) and drop-off lie within 2 km of the rider's route to the
 * destination and bring the rider closer. Off on arrival (300 m) or after
 * 3 hours. The board still lists every job and marks those on the way.
 *
 * Geometry (Bansud): rider at Poblacion (12.865, 121.452), heading home 9.5 km
 * north to (12.950, 121.460).
 */
class RiderDestinationModeTest extends TestCase
{
    use RefreshDatabase;

    private const RIDER = [12.865, 121.452];

    private const HOME = [12.950, 121.460];

    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $municipality = Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro', 'latitude' => 12.86, 'longitude' => 121.45]);
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Poblacion Eatery',
            'status' => 'approved',
            'latitude' => 12.870,
            'longitude' => 121.452,
        ]);

        // Radar fallback (live socket positions) has no riders in these tests.
        $this->mock(WebsocketNotifierService::class, function ($mock) {
            $mock->shouldReceive('getOnlineRidersFromBridge')->andReturn([]);
            $mock->shouldIgnoreMissing();
        });
    }

    private function rider(string $email, ?array $home = null, ?string $expiresAt = null): User
    {
        $rider = User::create([
            'name' => $email,
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);
        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
            'destination_label' => $home ? 'Home' : null,
            'destination_latitude' => $home[0] ?? null,
            'destination_longitude' => $home[1] ?? null,
            'destination_set_at' => $home ? now() : null,
            'destination_expires_at' => $home ? ($expiresAt ?? now()->addHours(3)) : null,
        ]);
        RiderLocation::create(['rider_id' => $rider->id, 'latitude' => self::RIDER[0], 'longitude' => self::RIDER[1], 'recorded_at' => now()]);

        return $rider;
    }

    /** An online-paid food delivery picked up at $pickup and dropped at $dropoff. */
    private function delivery(array $dropoff, ?array $pickup = null): Delivery
    {
        $pickup ??= [12.870, 121.452];
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)),
            'business_id' => $this->business->id,
            'customer_name' => 'Tourist',
            'customer_email' => 'tourist@example.com',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 60,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 360,
            'delivery_latitude' => $dropoff[0],
            'delivery_longitude' => $dropoff[1],
            'delivery_address' => 'Drop-off',
        ]);

        return Delivery::create([
            'order_id' => $order->id,
            'status' => 'waiting',
            'delivery_fee' => 60,
            'rider_commission' => 40,
            'pickup_address' => 'Poblacion Eatery',
            'delivery_address' => 'Drop-off',
            'pickup_latitude' => $pickup[0],
            'pickup_longitude' => $pickup[1],
            'delivery_latitude' => $dropoff[0],
            'delivery_longitude' => $dropoff[1],
        ]);
    }

    private function service(): RiderDestinationService
    {
        return app(RiderDestinationService::class);
    }

    private function home(): array
    {
        return ['latitude' => self::HOME[0], 'longitude' => self::HOME[1]];
    }

    // ---------- matching rule ----------

    public function test_a_job_on_the_way_home_matches(): void
    {
        $job = $this->delivery([12.920, 121.457]);

        $this->assertTrue($this->service()->onTheWay(self::RIDER[0], self::RIDER[1], $this->home(), $job));
    }

    public function test_a_drop_off_that_takes_the_rider_away_from_home_does_not_match(): void
    {
        $south = $this->delivery([12.800, 121.450]);

        $this->assertFalse($this->service()->onTheWay(self::RIDER[0], self::RIDER[1], $this->home(), $south));
    }

    public function test_a_pickup_more_than_2_km_off_the_route_does_not_match(): void
    {
        // Pickup ~3 km east of the route, drop-off on the way.
        $detour = $this->delivery([12.920, 121.457], [12.880, 121.480]);

        $this->assertFalse($this->service()->onTheWay(self::RIDER[0], self::RIDER[1], $this->home(), $detour));
        $this->assertGreaterThan(2, $this->service()->distanceToRouteKm([12.880, 121.480], self::RIDER, self::HOME));
    }

    public function test_a_drop_off_more_than_2_km_off_the_route_does_not_match(): void
    {
        // Closer to home as the crow flies, but ~4 km west of the route.
        $wide = $this->delivery([12.930, 121.420]);

        $this->assertFalse($this->service()->onTheWay(self::RIDER[0], self::RIDER[1], $this->home(), $wide));
    }

    public function test_unknown_rider_position_does_not_match(): void
    {
        $this->assertFalse($this->service()->onTheWay(null, null, $this->home(), $this->delivery([12.920, 121.457])));
    }

    // ---------- dispatch ----------

    private function useMysqlCandidates(): NearestRiderService
    {
        $mock = new class() extends NearestRiderService {
            public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
            {
                return User::where('role', User::ROLE_RIDER)
                    ->with(['locations' => fn ($q) => $q->latest('recorded_at')->limit(1)])
                    ->orderBy('id')
                    ->get()
                    ->each(fn ($u) => $u->setAttribute('distance_km', 0.6));
            }
        };
        $this->app->instance(NearestRiderService::class, $mock);

        return $mock;
    }

    public function test_dispatch_offers_a_job_off_the_route_only_to_riders_without_a_destination(): void
    {
        $free = $this->rider('free@example.com');
        $homeward = $this->rider('home@example.com', self::HOME);
        $dispatch = $this->useMysqlCandidates();

        $south = $this->delivery([12.800, 121.450]);
        $ids = array_column($dispatch->targetedCandidates($south, 'food', null, [], 5), 'rider_id');
        $this->assertSame([$free->id], $ids);

        $onTheWay = $this->delivery([12.920, 121.457]);
        $ids = array_column($dispatch->targetedCandidates($onTheWay, 'food', null, [], 5), 'rider_id');
        $this->assertSame([$free->id, $homeward->id], $ids);
    }

    public function test_an_expired_destination_no_longer_filters_offers(): void
    {
        $rider = $this->rider('expired@example.com', self::HOME, now()->subMinute()->toDateTimeString());
        $dispatch = $this->useMysqlCandidates();

        $ids = array_column($dispatch->targetedCandidates($this->delivery([12.800, 121.450]), 'food', null, [], 5), 'rider_id');

        $this->assertSame([$rider->id], $ids);
    }

    public function test_radar_candidates_are_filtered_by_the_same_rule(): void
    {
        $homeward = $this->rider('radar@example.com', self::HOME);

        $this->assertFalse($this->service()->allows($homeward->id, self::RIDER[0], self::RIDER[1], $this->delivery([12.800, 121.450])));
        $this->assertTrue($this->service()->allows($homeward->id, self::RIDER[0], self::RIDER[1], $this->delivery([12.920, 121.457])));
        // A rider without a destination is never filtered.
        $free = $this->rider('radar-free@example.com');
        $this->assertTrue($this->service()->allows($free->id, self::RIDER[0], self::RIDER[1], $this->delivery([12.800, 121.450])));
    }

    // ---------- rider API ----------

    public function test_rider_sets_shows_and_turns_off_my_destination(): void
    {
        $rider = $this->rider('api@example.com');

        $this->actingAs($rider, 'sanctum')->getJson('/api/rider/destination')
            ->assertOk()->assertJsonPath('data.active', false)->assertJsonPath('data.corridor_km', 2);

        $data = $this->actingAs($rider, 'sanctum')
            ->putJson('/api/rider/destination', ['latitude' => self::HOME[0], 'longitude' => self::HOME[1], 'label' => 'Home'])
            ->assertOk()
            ->json('data');
        $this->assertTrue($data['active']);
        $this->assertSame('Home', $data['destination']['label']);
        $expires = \Carbon\Carbon::parse($data['destination']['expires_at']);
        $this->assertEqualsWithDelta(180, now()->diffInMinutes($expires), 1);

        $this->actingAs($rider, 'sanctum')->deleteJson('/api/rider/destination')
            ->assertOk()->assertJsonPath('data.active', false);
        $this->assertNull($rider->riderDetail->fresh()->destination_latitude);
    }

    public function test_destination_is_validated_and_rider_only(): void
    {
        $rider = $this->rider('val@example.com');
        $this->actingAs($rider, 'sanctum')->putJson('/api/rider/destination', ['latitude' => 0, 'longitude' => 121.4])
            ->assertStatus(422)->assertJsonValidationErrors('latitude');
        $this->actingAs($rider, 'sanctum')->putJson('/api/rider/destination', ['latitude' => 95, 'longitude' => 121.4])
            ->assertStatus(422);

        $tourist = User::create(['email' => 't@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->actingAs($tourist, 'sanctum')->putJson('/api/rider/destination', ['latitude' => self::HOME[0], 'longitude' => self::HOME[1]])
            ->assertForbidden();
    }

    public function test_it_switches_off_when_the_rider_arrives(): void
    {
        $rider = $this->rider('arrive@example.com', self::HOME);
        RiderLocation::where('rider_id', $rider->id)->update(['latitude' => 12.9485, 'longitude' => 121.460, 'recorded_at' => now()->subMinute()]);

        // Still ~500 m away: stays on.
        $this->actingAs($rider, 'sanctum')
            ->postJson('/api/rider/map/location', ['latitude' => 12.9455, 'longitude' => 121.460, 'accuracy' => 10])
            ->assertOk()->assertJsonPath('data.destination_ended', null);
        $this->assertNotNull($rider->riderDetail->fresh()->destination_latitude);

        // Within 300 m: off.
        RiderLocation::where('rider_id', $rider->id)->update(['recorded_at' => now()->subMinute()]);
        $this->actingAs($rider, 'sanctum')
            ->postJson('/api/rider/map/location', ['latitude' => 12.9490, 'longitude' => 121.460, 'accuracy' => 10])
            ->assertOk()->assertJsonPath('data.destination_ended', 'arrived');
        $this->assertNull($rider->riderDetail->fresh()->destination_latitude);
    }

    public function test_it_switches_off_after_three_hours(): void
    {
        $rider = $this->rider('late@example.com', self::HOME, now()->subSecond()->toDateTimeString());

        $this->actingAs($rider, 'sanctum')->getJson('/api/rider/destination')
            ->assertOk()->assertJsonPath('data.active', false);
        $this->assertNull($rider->riderDetail->fresh()->destination_latitude);
    }

    // ---------- board ----------

    public function test_board_lists_every_job_and_marks_the_ones_on_the_way(): void
    {
        $rider = $this->rider('board@example.com', self::HOME);
        $onTheWay = $this->delivery([12.920, 121.457]);
        $behind = $this->delivery([12.860, 121.450]);
        foreach ([$onTheWay, $behind] as $delivery) {
            BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $rider->id, 'distance_km' => 0.6, 'response' => 'pending', 'dispatched_at' => now()]);
        }

        $data = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board')->assertOk()->json('data');

        $marks = collect($data['orders'])->pluck('on_your_way', 'delivery_id');
        $this->assertTrue($marks[$onTheWay->id]);
        $this->assertFalse($marks[$behind->id]);
        $this->assertSame('Home', $data['destination']['label']);
    }

    public function test_board_has_no_marks_when_my_destination_is_off(): void
    {
        $rider = $this->rider('board-off@example.com');
        $delivery = $this->delivery([12.920, 121.457]);
        BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $rider->id, 'distance_km' => 0.6, 'response' => 'pending', 'dispatched_at' => now()]);

        $data = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board')->assertOk()->json('data');

        $this->assertNull($data['orders'][0]['on_your_way']);
        $this->assertNull($data['destination']);
    }
}
