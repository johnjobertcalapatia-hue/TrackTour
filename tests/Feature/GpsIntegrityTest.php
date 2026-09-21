<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P5.1 GPS integrity on the HTTP tracking ingress (POST /api/rider/map/location):
 * coordinate validation, accuracy filtering, authentication, and a teleport
 * guard that must not let an implausible jump trigger an arrival geofence.
 */
class GpsIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-gps@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);
    }

    private function makeBusiness(): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]
        );

        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'GPS Cafe',
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeRider(string $email = 'rider-gps@example.com'): User
    {
        $rider = User::create([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        return $rider;
    }

    private function makeOrder(Business $business): Order
    {
        return Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'preparing',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_address' => '123 Test St',
            'predicted_ready_at' => now()->addMinutes(15),
            'predicted_preparation_seconds' => 900,
            'acceptance_started_at' => now()->subMinutes(30),
            'accepted_at' => now()->subMinutes(20),
        ]);
    }

    private function makeAssignedDelivery(User $rider, Business $business): Delivery
    {
        $order = $this->makeOrder($business);
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery);

        $delivery->update([
            'rider_id' => $rider->id,
            'status' => 'assigned',
            'assigned_at' => now(),
            'dispatch_status' => null,
            'dispatch_expires_at' => null,
            'pickup_latitude' => $business->latitude,
            'pickup_longitude' => $business->longitude,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
        ]);

        return $delivery->fresh();
    }

    public function test_location_requires_authentication(): void
    {
        $this->postJson('/api/rider/map/location', ['latitude' => 12.5, 'longitude' => 121.3])
            ->assertUnauthorized();
    }

    public function test_valid_location_is_persisted(): void
    {
        $rider = $this->makeRider();
        $this->be($rider);

        $response = $this->postJson('/api/rider/map/location', [
            'latitude' => 12.52,
            'longitude' => 121.32,
        ]);

        $response->assertOk()->assertJsonPath('data.moved', true);
        $this->assertDatabaseHas('rider_locations', ['rider_id' => $rider->id]);
    }

    public function test_out_of_range_coordinates_are_rejected(): void
    {
        $rider = $this->makeRider();
        $this->be($rider);

        $this->postJson('/api/rider/map/location', [
            'latitude' => 200,
            'longitude' => 121.32,
        ])->assertStatus(422)->assertJsonValidationErrors('latitude');
    }

    public function test_low_accuracy_fix_is_ignored(): void
    {
        $rider = $this->makeRider();
        $this->be($rider);

        $this->postJson('/api/rider/map/location', [
            'latitude' => 12.52,
            'longitude' => 121.32,
            'accuracy' => 80,
        ])->assertOk()
            ->assertJsonPath('data.moved', false)
            ->assertJsonPath('data.reason', 'low_accuracy');

        $this->assertDatabaseCount('rider_locations', 0);
    }

    public function test_implausible_jump_does_not_trigger_arrival(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider();
        $delivery = $this->makeAssignedDelivery($rider, $business);

        // Previous fix 5s ago, far away from the restaurant.
        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => 12.7,
            'longitude' => 121.5,
            'recorded_at' => now()->subSeconds(5),
        ]);

        $this->be($rider);

        // Jump straight onto the pickup coordinates within the geofence radius.
        $this->postJson('/api/rider/map/location', [
            'latitude' => 12.51,
            'longitude' => 121.31,
        ])->assertOk()
            ->assertJsonPath('data.moved', false)
            ->assertJsonPath('data.reason', 'implausible_movement');

        $this->assertSame('assigned', $delivery->fresh()->status->value);
        $this->assertDatabaseCount('rider_locations', 1);
    }

    public function test_plausible_approach_still_triggers_arrival_geofence(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider();
        $delivery = $this->makeAssignedDelivery($rider, $business);

        // ~460m away, 30s ago -> ~55 km/h, a plausible approach.
        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => 12.513,
            'longitude' => 121.313,
            'recorded_at' => now()->subSeconds(30),
        ]);

        $this->be($rider);

        $this->postJson('/api/rider/map/location', [
            'latitude' => 12.51,
            'longitude' => 121.31,
        ])->assertOk();

        $this->assertSame('arrived_pickup', $delivery->fresh()->status->value);
    }
}
