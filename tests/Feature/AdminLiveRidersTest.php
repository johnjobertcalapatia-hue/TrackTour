<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Admin live map: GET /admin/live/riders lists on-duty riders with their
 * latest GPS fix and live trip (stage, pickups, drop-off) for the route.
 */
class AdminLiveRidersTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Municipality $bansud;

    private Business $grill;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->admin = $this->user('bansud_tourism_office', 'Bansud Admin');
        $owner = $this->user('business_owner', 'Owner');
        $this->grill = Business::create([
            'owner_id' => $owner->id, 'municipality_id' => $this->bansud->id, 'business_name' => 'Bansud Grill',
            'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.45,
        ]);
    }

    public function test_lists_on_duty_riders_with_latest_location_and_trip(): void
    {
        $idle = $this->rider('Idle Rider', User::RIDER_STATUS_AVAILABLE);
        $this->fix($idle, 12.80, 121.40, now()->subMinutes(5));
        $this->fix($idle, 12.81, 121.41, now()->subMinute());

        $food = $this->rider('Food Rider', User::RIDER_STATUS_BUSY);
        $this->fix($food, 12.85, 121.44, now());
        $this->trip($food, 'delivery', 'en_route_pickup', 'FOOD-1');

        $ride = $this->rider('Ride Rider', User::RIDER_STATUS_BUSY);
        $this->trip($ride, 'transport', 'in_transit', 'RIDE-1');

        $this->rider('Off Rider', User::RIDER_STATUS_OFFLINE);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/riders')->assertOk();
        $rows = collect($res->json('data'))->keyBy('name');

        $this->assertEqualsCanonicalizing(['Idle Rider', 'Food Rider', 'Ride Rider'], $rows->keys()->all());

        $this->assertSame('available', $rows['Idle Rider']['activity']);
        $this->assertEquals(['lat' => 12.81, 'lng' => 121.41], array_intersect_key($rows['Idle Rider']['location'], ['lat' => 0, 'lng' => 0]));
        $this->assertNull($rows['Idle Rider']['trip']);
        $this->assertSame('Bansud', $rows['Idle Rider']['municipality']);

        $foodTrip = $rows['Food Rider']['trip'];
        $this->assertSame('delivering', $rows['Food Rider']['activity']);
        $this->assertSame('food', $foodTrip['type']);
        $this->assertSame('to_pickup', $foodTrip['stage']);
        $this->assertSame('Bansud Grill', $foodTrip['pickups'][0]['name']);
        $this->assertEquals(12.86, $foodTrip['pickups'][0]['lat']);
        $this->assertEquals(12.9, $foodTrip['dropoff']['lat']);

        $this->assertSame('transporting', $rows['Ride Rider']['activity']);
        $this->assertSame('to_dropoff', $rows['Ride Rider']['trip']['stage']);
        $this->assertNull($rows['Ride Rider']['location']);
    }

    public function test_map_data_has_town_markers_with_coordinates_and_logo(): void
    {
        $this->bansud->update(['latitude' => 12.8667, 'longitude' => 121.45]);
        Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.97, 'longitude' => 121.47, 'logo' => 'municipalities/gloria.png']);
        \App\Models\TourismSetting::create(['municipality_id' => null, 'key' => 'office_logo', 'value' => '/storage/office/logo/bansud.jpg']);

        $towns = collect($this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/map-data')->assertOk()->json('data.municipalities'))->keyBy('name');

        $this->assertEquals(12.8667, $towns['Bansud']['lat']);
        // Bansud has no municipality logo: it falls back to the office logo.
        $this->assertSame('/storage/office/logo/bansud.jpg', $towns['Bansud']['logo']);
        $this->assertSame('municipalities/gloria.png', $towns['Gloria']['logo']);
    }

    public function test_map_data_reports_open_closed_status(): void
    {
        $owner = $this->user('business_owner', 'Owner 2');
        Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->bansud->id, 'business_name' => 'Shut Diner', 'status' => 'approved', 'latitude' => 12.8, 'longitude' => 121.4, 'force_closed' => true]);
        Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->bansud->id, 'business_name' => 'Always Diner', 'status' => 'approved', 'latitude' => 12.81, 'longitude' => 121.41, 'opening_time' => '00:00', 'closing_time' => '23:59']);

        $rows = collect($this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/map-data')->assertOk()->json('data.businesses'))->keyBy('name');

        $this->assertSame('temporarily_closed', $rows['Shut Diner']['open_status']['status']);
        // Bansud Grill has no hours set: neutral, never reported as "closed".
        $this->assertSame('no_hours', $rows['Bansud Grill']['open_status']['status']);
        $this->assertContains($rows['Always Diner']['open_status']['status'], ['open', 'closed']);
    }

    public function test_only_the_bansud_admin_can_read_live_riders(): void
    {
        foreach (['tourism_office', 'rider', 'tourist', 'business_owner'] as $role) {
            $this->actingAs($this->user($role, ucfirst($role)), 'sanctum')->getJson('/api/admin/live/riders')->assertForbidden();
        }
    }

    private function user(string $role, string $name): User
    {
        return User::create([
            'name' => $name, 'email' => Str::lower($role.'.'.Str::random(8)).'@example.com', 'password' => 'Password123!',
            'role' => $role, 'account_status' => 'approved', 'municipality_id' => $this->bansud->id,
        ]);
    }

    private function rider(string $name, string $status): User
    {
        $rider = $this->user('rider', $name);
        $rider->riderDetail()->create(['current_service' => User::SERVICE_FOOD, 'rider_status' => $status]);

        return $rider;
    }

    private function fix(User $rider, float $lat, float $lng, $at): void
    {
        RiderLocation::create(['rider_id' => $rider->id, 'latitude' => $lat, 'longitude' => $lng, 'recorded_at' => $at]);
    }

    private function trip(User $rider, string $type, string $status, string $number): Delivery
    {
        $order = Order::create([
            'order_number' => $number, 'customer_name' => 'Ana Customer', 'order_type' => $type, 'total' => 300, 'subtotal' => 250,
            'business_id' => $type === 'transport' ? null : $this->grill->id,
        ]);

        return Delivery::create([
            'order_id' => $order->id, 'status' => $status, 'rider_id' => $rider->id,
            'pickup_address' => 'Pag-asa, Bansud', 'delivery_address' => 'Poblacion, Bansud',
            'pickup_latitude' => $type === 'transport' ? 12.83 : null, 'pickup_longitude' => $type === 'transport' ? 121.43 : null,
            'delivery_latitude' => 12.9, 'delivery_longitude' => 121.5,
        ]);
    }
}
