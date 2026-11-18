<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\RideVehicles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Ride-hailing vehicle types come from riders' registered vehicles:
 * - a tourist can book only vehicle types a registered ride-hailing rider has;
 * - a ride is offered to / accepted by only a rider with the booked vehicle;
 * - a bicycle may do food delivery but never ride-hailing.
 */
class RideVehicleRulesTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $bansud;
    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->tourist = $this->user('tourist', 'approved');
    }

    public function test_bookable_vehicle_types_follow_registered_ride_hailing_riders(): void
    {
        $this->rider('motorcycle', 'transport');
        $this->rider('bicycle', 'food');                   // food only: never bookable
        $this->rider('car', 'transport', 'pending_review'); // not approved yet

        $types = collect($this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/transport/vehicle-types')->assertOk()->json('data'))->keyBy('slug');
        $this->assertTrue($types['motorcycle']['available']);
        $this->assertSame(1, $types['motorcycle']['riders_registered']);
        $this->assertFalse($types['car']['available']);
        $this->assertFalse($types->has('bicycle'));

        $estimate = $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/transport/estimate', $this->coords())->assertOk()->json('data');
        $this->assertSame(['motorcycle'], array_keys($estimate['fares']));

        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/transport/book', $this->booking('car'))
            ->assertStatus(422)->assertJsonValidationErrors('vehicle_type');
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/transport/book', $this->booking('motorcycle'))->assertCreated();
    }

    public function test_a_ride_can_be_accepted_only_with_the_booked_vehicle(): void
    {
        $motorcycle = $this->rider('motorcycle', 'transport');
        $car = $this->rider('car', 'transport');
        $carRide = $this->ride('car');

        $dispatch = app(NearestRiderService::class);
        $this->assertFalse($dispatch->validateRiderAcceptance($carRide, $motorcycle->id));
        $this->assertTrue($dispatch->validateRiderAcceptance($carRide->fresh(), $car->id));

        $this->assertFalse(RideVehicles::riderMatches('motorcycle', $carRide));
        $this->assertTrue(RideVehicles::riderMatches('car', $carRide));
        $this->assertTrue(RideVehicles::riderMatches('bicycle', $this->foodDelivery())); // food: any vehicle
    }

    public function test_the_rider_board_lists_a_ride_only_to_riders_with_the_booked_vehicle(): void
    {
        $motorcycle = $this->rider('motorcycle', 'transport');
        $car = $this->rider('car', 'transport');
        $carRide = $this->ride('car');
        $carRide->update(['dispatch_status' => 'no_rider_available', 'dispatch_phase' => 'manual']);

        $ids = fn (User $r) => collect($this->actingAs($r, 'sanctum')->getJson('/api/rider/dispatch/board')->assertOk()->json('data.orders'))->pluck('delivery_id')->filter()->all();
        $this->assertNotContains($carRide->id, $ids($motorcycle));
        $this->assertContains($carRide->id, $ids($car));
    }

    public function test_the_board_shows_a_ride_as_a_ride_not_a_food_delivery(): void
    {
        // 2026-11-18: the rider saw "Restaurant · 1 item" for a ride request.
        $car = $this->rider('car', 'transport');
        $carRide = $this->ride('car');
        $carRide->update(['dispatch_status' => 'no_rider_available', 'dispatch_phase' => 'manual']);

        $row = collect($this->actingAs($car, 'sanctum')->getJson('/api/rider/dispatch/board')->assertOk()->json('data.orders'))
            ->firstWhere('delivery_id', $carRide->id);
        $this->assertNotNull($row);
        $this->assertTrue($row['is_ride']);
        $this->assertSame('transport', $row['order_type']);
        $this->assertSame('car', $row['vehicle_type']);
        $this->assertSame(1, $row['passenger_count']);
        $this->assertNotNull($row['passenger_name']);
        $this->assertEquals((float) $carRide->order->total, $row['fare']);
        $this->assertSame([], $row['restaurants'], 'A ride has no restaurant stops.');
    }

    public function test_a_bicycle_is_food_delivery_only(): void
    {
        Storage::fake('local');
        $applicant = $this->user('rider', 'pending_review');

        $this->actingAs($applicant, 'sanctum')->post('/api/rider/onboarding/application', [
            'requested_services' => ['food', 'transport'], 'vehicle_type' => 'bicycle',
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors('requested_services');

        // Food only: no plate, driver's license or OR/CR needed for a bicycle.
        $this->actingAs($applicant, 'sanctum')->post('/api/rider/onboarding/application', [
            'requested_services' => ['food'], 'vehicle_type' => 'bicycle',
        ], ['Accept' => 'application/json'])->assertOk();
        $this->assertSame('bicycle', $applicant->riderDetail()->value('vehicle_type'));

        // An approved bicycle rider cannot switch to or go online for ride-hailing.
        $cyclist = $this->rider('bicycle', 'food');
        $this->actingAs($cyclist, 'sanctum')->postJson('/api/rider/service', ['service' => 'transport'])->assertForbidden();
        $this->assertFalse($cyclist->isEligibleForService('transport'));
        $this->assertTrue($cyclist->isEligibleForService('food'));
    }

    public function test_the_office_records_a_riders_vehicle_and_a_bicycle_leaves_ride_hailing(): void
    {
        $admin = $this->user('bansud_tourism_office', 'approved');
        $legacy = $this->user('rider', 'approved');
        RiderDetail::create(['user_id' => $legacy->id, 'rider_status' => 'online', 'current_service' => 'transport']);
        $this->assertFalse($legacy->isEligibleForService('transport')); // no registered vehicle yet

        $this->actingAs($admin, 'sanctum')->putJson("/api/admin/riders/{$legacy->id}/vehicle", ['vehicle_type' => 'car'])
            ->assertStatus(422)->assertJsonValidationErrors('vehicle_plate_number');
        $this->actingAs($admin, 'sanctum')->putJson("/api/admin/riders/{$legacy->id}/vehicle", ['vehicle_type' => 'motorcycle', 'vehicle_plate_number' => 'abc 1234'])
            ->assertOk()->assertJsonPath('data.vehicle_type', 'motorcycle')->assertJsonPath('data.vehicle_plate', 'ABC 1234')->assertJsonPath('data.can_ride_hail', true);
        $this->assertTrue($legacy->fresh()->isEligibleForService('transport'));
        $this->assertDatabaseHas('activity_logs', ['action' => 'rider.vehicle_updated']);

        $this->actingAs($admin, 'sanctum')->putJson("/api/admin/riders/{$legacy->id}/vehicle", ['vehicle_type' => 'bicycle'])
            ->assertOk()->assertJsonPath('data.can_ride_hail', false);
        $detail = $legacy->riderDetail()->first();
        $this->assertSame('food', $detail->current_service);
        $this->assertSame('offline', $detail->rider_status);

        $detail->update(['rider_status' => 'busy']);
        $this->actingAs($admin, 'sanctum')->putJson("/api/admin/riders/{$legacy->id}/vehicle", ['vehicle_type' => 'motorcycle', 'vehicle_plate_number' => 'X1'])->assertStatus(422);

        $this->actingAs($this->user('tourism_office', 'approved'), 'sanctum')->putJson("/api/admin/riders/{$legacy->id}/vehicle", ['vehicle_type' => 'car', 'vehicle_plate_number' => 'X'])->assertForbidden();
    }

    // ------------------------------------------------------------------

    private function user(string $role, string $status): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4), 'email' => Str::lower($role.'.'.Str::random(8)).'@example.com',
            'password' => 'Password123!', 'role' => $role, 'account_status' => $status, 'municipality_id' => $this->bansud->id,
        ]);
    }

    private function rider(string $vehicle, string $service, string $status = 'approved'): User
    {
        $rider = $this->user('rider', $status);
        RiderDetail::create(['user_id' => $rider->id, 'rider_status' => 'available', 'current_service' => $service, 'vehicle_type' => $vehicle]);
        RiderLocation::create(['rider_id' => $rider->id, 'latitude' => 12.511, 'longitude' => 121.311, 'recorded_at' => now()]);

        return $rider;
    }

    private function coords(): array
    {
        return ['pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'destination_lat' => 12.55, 'destination_lng' => 121.35];
    }

    private function booking(string $vehicle): array
    {
        return $this->coords() + ['pickup_address' => 'Poblacion', 'destination_address' => 'Pag-asa', 'vehicle_type' => $vehicle, 'passenger_count' => 1, 'payment_method' => 'cash'];
    }

    private function ride(string $vehicle): Delivery
    {
        $order = Order::create(['order_number' => 'TRP-'.Str::random(6), 'customer_name' => 'T', 'order_type' => 'transport', 'status' => 'pending', 'total' => 100, 'subtotal' => 100, 'payment_method' => 'cash']);

        return Delivery::create([
            'order_id' => $order->id, 'status' => 'waiting', 'dispatch_status' => 'waiting_for_rider',
            'pickup_latitude' => 12.51, 'pickup_longitude' => 121.31, 'delivery_latitude' => 12.55, 'delivery_longitude' => 121.35,
            'notes' => json_encode(['vehicle_type' => $vehicle, 'passenger_count' => 1, 'payment_method' => 'cash']),
        ]);
    }

    private function foodDelivery(): Delivery
    {
        $order = Order::create(['order_number' => 'ORD-'.Str::random(6), 'customer_name' => 'T', 'order_type' => 'delivery', 'total' => 100, 'subtotal' => 100]);

        return Delivery::create(['order_id' => $order->id, 'status' => 'waiting']);
    }
}
