<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Notification;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\TransportationService;
use App\Services\WebsocketNotifierService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Ride-hailing Phase 6 — notifications + driver-cancelled handler.
 *
 * Protects:
 *   - every ride transition point persists an in-app Notification row for the
 *     tourist with ride-aware wording (assignment, arrived, picked_up,
 *     arrived_destination, cancellation)
 *   - a driver may cancel an accepted ride BEFORE pickup only (assigned /
 *     en_route_pickup / arrived_pickup); after pickup it is blocked
 *   - driver cancel is bound to the assigned rider (403 otherwise) and is
 *     transport-scoped (food deliveries → 422)
 *   - driver cancel releases the rider back to 'available' and notifies the
 *     tourist via the canonical OrderStatusChanged event
 *
 * NearestRiderService is mocked ONLY at the candidate-finder seam so the REAL
 * dispatch/accept code runs unmocked (same pattern as RideHailingAcceptanceTest).
 */
class TransportRideNotificationsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $tourist;
    private NearestRiderService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'notify-owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->makeBusiness('Notifications Test Business');

        $this->tourist = User::create([
            'name' => 'Notifications Tourist',
            'email' => 'notify-tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->app->instance(NearestRiderService::class, new class() extends NearestRiderService {
            public Collection $candidates;

            public function __construct()
            {
                parent::__construct();
                $this->candidates = collect();
            }

            public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
            {
                return $this->candidates
                    ->filter(fn (User $rider) => $rider->account_status === User::ACCOUNT_STATUS_APPROVED
                        && in_array($rider->riderDetail?->rider_status, [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE], true)
                        && $rider->riderDetail?->current_service === $serviceType)
                    ->sortBy('distance_km')
                    ->take($limit)
                    ->values();
            }

            public function findNearestEligibleCodRiders(Delivery $delivery, float $pickupLat, float $pickupLng, string $serviceType, int $limit, ?int $municipalityId): Collection
            {
                return $this->candidates
                    ->filter(fn (User $rider) => $rider->account_status === User::ACCOUNT_STATUS_APPROVED
                        && $rider->riderDetail?->rider_status === User::RIDER_STATUS_AVAILABLE
                        && $rider->riderDetail?->current_service === $serviceType)
                    ->sortBy('distance_km')
                    ->take($limit)
                    ->values();
            }
        });

        $this->service = app(NearestRiderService::class);

        $this->mock(WebsocketNotifierService::class, function ($mock) {
            $mock->shouldReceive('notifyDispatch')->andReturn(true);
            $mock->shouldReceive('notifyTripAssigned')->andReturn(true);
            $mock->shouldReceive('notifyTripCancelled')->andReturn(true);
            $mock->shouldReceive('getOnlineRidersFromBridge')->andReturn([]);
            $mock->shouldReceive('notifyStatusEvent')->andReturn(true);
        });
    }

    // ---------- helpers ----------

    private function makeBusiness(string $name): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            [
                'district' => '1st',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.5,
                'longitude' => 121.3,
            ]
        );

        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeRider(string $email, array $overrides = []): User
    {
        $rider = User::create(array_merge([
            'name' => 'Rider',
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ], $overrides));

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => $overrides['rider_status'] ?? 'available',
            'current_service' => $overrides['current_service'] ?? 'transport',
            'vehicle_type' => 'Motorcycle',
            'vehicle_plate_number' => 'ABC 1234',
        ]);

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => 12.51,
            'longitude' => 121.31,
            'recorded_at' => now(),
        ]);

        return $rider;
    }

    private function setCandidates(array $riders): void
    {
        $candidates = collect($riders);
        $candidates->each(function (User $rider, int $i) {
            $rider->setAttribute('distance_km', 1.0 + $i);
        });

        $this->service->candidates = $candidates->values();
    }

    private function authHeaders(User $user): array
    {
        $token = $user->createToken('test-token')->plainTextToken;

        return [
            'Authorization' => "Bearer {$token}",
            'Accept' => 'application/json',
        ];
    }

    private function createRideForTourist(): Order
    {
        $this->actingAs($this->tourist);

        return app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51,
            'pickup_lng' => 121.31,
            'pickup_address' => 'Pickup St',
            'destination_lat' => 12.60,
            'destination_lng' => 121.40,
            'destination_address' => 'Destination St',
            'vehicle_type' => 'motorcycle',
            'passenger_count' => 1,
            'fare' => 150,
            'distance_km' => 3.5,
            'duration_min' => 12,
            'payment_method' => 'gcash',
            'booking_notes' => '',
        ]);
    }

    private function acceptRide(Order $order, User $rider): bool
    {
        $outcome = $this->service->handleRiderResponse($order->delivery->id, $rider->id, 'accepted');

        return (bool) ($outcome['success'] ?? false);
    }

    private function touristNotifications(Order $order): \Illuminate\Database\Eloquent\Collection
    {
        return Notification::where('user_id', $this->tourist->id)
            ->where('type', 'ride_status_changed')
            ->orderBy('id')
            ->get();
    }

    // ---------- assignment notification ----------

    public function test_ride_assignment_persists_tourist_notification(): void
    {
        $rider = $this->makeRider('notify-rider-a@example.com');
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $this->assertTrue($this->acceptRide($order, $rider), 'the ride must be accepted');

        $rows = $this->touristNotifications($order);

        $this->assertCount(1, $rows, 'accepting the ride must create exactly one tourist notification');
        $this->assertStringContainsString('Your driver', $rows->first()->message);
        $this->assertStringContainsString('on the way to your pickup location', $rows->first()->message);
        $this->assertSame('Ride Status Updated', $rows->first()->title);

        // The rider still receives the canonical assignment notification.
        $this->assertDatabaseHas('notifications', [
            'user_id' => $rider->id,
            'type' => 'delivery_assigned',
        ]);
    }

    // ---------- driver-cancelled handler ----------

    public function test_driver_cancels_accepted_ride(): void
    {
        $rider = $this->makeRider('notify-rider-b@example.com');
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $this->assertTrue($this->acceptRide($order, $rider));
        $delivery = $order->delivery->fresh();
        $this->assertSame('assigned', $delivery->status->value);
        $this->assertSame('busy', $rider->riderDetail->fresh()->rider_status);

        $response = $this->postJson(
            "/api/rider/deliveries/{$delivery->id}/cancel-ride",
            ['reason' => 'Bike breakdown'],
            $this->authHeaders($rider)
        );

        $response->assertOk();

        $freshOrder = $order->fresh();
        $this->assertSame('cancelled', $freshOrder->status);
        $this->assertSame($rider->id, $freshOrder->cancelled_by);
        $this->assertSame('Bike breakdown', $freshOrder->cancellation_reason);
        $this->assertNotNull($freshOrder->cancelled_at);

        $freshDelivery = $delivery->fresh();
        $this->assertSame('cancelled', $freshDelivery->status->value);
        $this->assertNull($freshDelivery->dispatch_status);

        // The driver is released for the next offer.
        $this->assertSame('available', $rider->riderDetail->fresh()->rider_status);

        // The tourist receives a ride-aware cancelled notification.
        $latest = $this->touristNotifications($order)->last();
        $this->assertNotNull($latest);
        $this->assertStringContainsString('cancelled', $latest->message);
    }

    public function test_driver_cancel_is_blocked_after_pickup(): void
    {
        $rider = $this->makeRider('notify-rider-c@example.com');
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $this->assertTrue($this->acceptRide($order, $rider));

        $delivery = $order->delivery->fresh();
        $delivery->update(['status' => 'picked_up', 'picked_up_at' => now()]);

        $response = $this->postJson(
            "/api/rider/deliveries/{$delivery->id}/cancel-ride",
            [],
            $this->authHeaders($rider)
        );

        $response->assertStatus(422);
        $this->assertNotEquals('cancelled', $order->fresh()->status);
        $this->assertNotEquals('cancelled', $delivery->fresh()->status->value);
    }

    public function test_driver_cancel_requires_the_assigned_rider(): void
    {
        $assigned = $this->makeRider('notify-rider-owner@example.com');
        $other = $this->makeRider('notify-rider-other@example.com');
        $this->setCandidates([$assigned]);

        $order = $this->createRideForTourist();
        $this->assertTrue($this->acceptRide($order, $assigned));

        $response = $this->postJson(
            "/api/rider/deliveries/{$order->delivery->id}/cancel-ride",
            [],
            $this->authHeaders($other)
        );

        $response->assertForbidden();
        $this->assertNotEquals('cancelled', $order->fresh()->status);
    }

    public function test_driver_cancel_rejects_food_deliveries(): void
    {
        $rider = $this->makeRider('notify-rider-food@example.com');

        $foodOrder = Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'business_id' => Business::first()->id,
            'customer_name' => 'Customer',
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'preparing',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'total' => 340,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_address' => '123 Test St',
        ]);

        $delivery = Delivery::create([
            'order_id' => $foodOrder->id,
            'delivery_fee' => 40,
            'distance_km' => 1.5,
            'status' => 'assigned',
            'rider_id' => $rider->id,
            'pickup_address' => 'Restaurant St',
            'pickup_latitude' => 12.51,
            'pickup_longitude' => 121.31,
            'delivery_address' => $foodOrder->delivery_address,
            'delivery_latitude' => $foodOrder->delivery_latitude,
            'delivery_longitude' => $foodOrder->delivery_longitude,
            'rider_commission' => 20,
        ]);

        $response = $this->postJson(
            "/api/rider/deliveries/{$delivery->id}/cancel-ride",
            [],
            $this->authHeaders($rider)
        );

        $response->assertStatus(422);
        $this->assertNotEquals('cancelled', $foodOrder->fresh()->status);
    }

    // ---------- transition wording ----------

    public function test_ride_transitions_persist_ride_aware_notifications(): void
    {
        $rider = $this->makeRider('notify-rider-d@example.com');
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $this->assertTrue($this->acceptRide($order, $rider));
        $delivery = $order->delivery->fresh();

        $patchStatus = function (string $status) use ($rider, $delivery) {
            $response = $this->patchJson(
                "/api/rider/deliveries/{$delivery->id}/status",
                ['status' => $status],
                $this->authHeaders($rider)
            );
            $response->assertOk();
        };

        $patchStatus('arrived_pickup');
        $patchStatus('picked_up');
        $patchStatus('arrived_destination');

        $messages = $this->touristNotifications($order)->map(fn ($n) => $n->message)->all();

        $this->assertCount(4, $messages, 'assignment + 3 trip transitions each persist a notification');
        $this->assertStringContainsString('on the way to your pickup location', $messages[0]);
        $this->assertStringContainsString('has arrived at your pickup location', $messages[1]);
        $this->assertStringContainsString('on its way to your destination', $messages[2]);
        $this->assertStringContainsString('You have arrived at your destination', $messages[3]);

        $this->assertSame(['Ride Status Updated', 'Ride Status Updated', 'Ride Status Updated', 'Ride Status Updated'], $this->touristNotifications($order)->pluck('title')->all());
    }
}