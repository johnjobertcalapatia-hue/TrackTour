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
use App\Services\TransportationService;
use App\Services\WebsocketNotifierService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;

/**
 * Ride-hailing (transport) service gating.
 *
 * A rider whose Service Type is Ride Hailing (rider_details.current_service =
 * 'transport') must receive AND be able to ACCEPT a transportation booking.
 *
 * The acceptance gate derives the required service from order.order_type:
 *
 *     $serviceType = order_type === 'transport' ? 'transport' : 'food';
 *
 * so a ride persisted as 'delivery' demanded current_service === 'food' and the
 * transport rider's accept was rejected as 'ineligible'. createRide() also
 * wrote the order item with non-fillable keys (description / price) against the
 * NOT NULL product_name / unit_price columns, so ride booking failed outright.
 *
 * Covered:
 *   A ride persists as order_type 'transport' with a valid item + delivery
 *   B a transport rider is offered AND accepts a non-COD (gcash) ride
 *   C a food rider is offered nothing and cannot accept a ride
 *   D a transport rider cannot accept a food delivery (gating not weakened)
 *   E the ride lists under the transport history tab, never the food tab
 *
 * NearestRiderService is mocked ONLY at the candidate-finder seam so the REAL
 * dispatch wave and the REAL atomic accept transaction run unmocked.
 */
class RideHailingAcceptanceTest extends TestCase
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
            'email' => 'ride-owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        // createRide() hardcodes business_id = 1, so the first business created
        // here must take id 1.
        $this->makeBusiness('Ride Test Business');

        $this->tourist = User::create([
            'name' => 'Ride Tourist',
            'email' => 'ride-tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        // Real dispatch + real accept transaction; only the SQLite-unsafe
        // candidate finders are replaced with a controllable collection.
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
            'current_service' => $overrides['current_service'] ?? 'food',
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

    private function createRide(array $overrides = []): Order
    {
        $this->actingAs($this->tourist);

        return app(TransportationService::class)->createRide(array_merge([
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
        ], $overrides));
    }

    /**
     * The authoritative fare the server derives for the canonical test
     * coordinates/vehicle (client-supplied fare values are advisory only).
     */
    private function expectedMotorcycleFare(): float
    {
        return (float) app(TransportationService::class)
            ->estimateFare(12.51, 121.31, 12.60, 121.40)['fares']['motorcycle']['fare'];
    }

    private function makeFoodOrder(): Order
    {
        return Order::create([
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
    }

    private function makeFoodDelivery(Order $order): Delivery
    {
        return Delivery::create([
            'order_id' => $order->id,
            'delivery_fee' => 40,
            'distance_km' => 1.5,
            'status' => 'waiting',
            'dispatch_status' => 'notified',
            'pickup_address' => 'Restaurant St',
            'pickup_latitude' => 12.51,
            'pickup_longitude' => 121.31,
            'delivery_address' => $order->delivery_address,
            'delivery_latitude' => $order->delivery_latitude,
            'delivery_longitude' => $order->delivery_longitude,
            'rider_commission' => 20,
        ]);
    }

    private function makePendingOffer(Delivery $delivery, User $rider): BookingDispatchLog
    {
        return BookingDispatchLog::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'distance_km' => 1.5,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);
    }

    private function pendingLog(Delivery $delivery, User $rider)
    {
        return BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('rider_id', $rider->id)
            ->where('response', 'pending');
    }

    private function authHeaders(User $user): array
    {
        $token = $user->createToken('test-token')->plainTextToken;

        return [
            'Authorization' => "Bearer {$token}",
            'Accept' => 'application/json',
        ];
    }

    // ---------- A ----------

    public function test_ride_persists_as_transport_order_with_item_and_delivery(): void
    {
        // A ride-hailing rider must be reachable so the ride enters the
        // transport dispatch pipeline (not the food one).
        $this->setCandidates([
            $this->makeRider('ride-candidate@example.com', ['current_service' => 'transport']),
        ]);

        $order = $this->createRide();

        $this->assertSame('transport', $order->order_type);
        $this->assertStringStartsWith('TRP-', $order->order_number);

        $item = $order->items()->first();
        $this->assertNotNull($item, 'the ride order item must persist');
        $this->assertStringContainsString('Ride:', $item->product_name);
        $expectedFare = $this->expectedMotorcycleFare();
        $this->assertEquals($expectedFare, (float) $item->unit_price);
        $this->assertEquals($expectedFare, (float) $order->total);

        $delivery = $order->delivery;
        $this->assertNotNull($delivery, 'the ride delivery must persist');
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertEquals(round(max(20, $expectedFare * 0.4), 2), (float) $delivery->rider_commission);
    }

    // ---------- B ----------

    public function test_transport_rider_is_offered_and_can_accept_a_gcash_ride(): void
    {
        $transportRider = $this->makeRider('ride-hailing@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$transportRider]);

        $order = $this->createRide(['payment_method' => 'gcash']);
        $delivery = $order->delivery;

        $this->assertTrue(
            $this->pendingLog($delivery, $transportRider)->exists(),
            'the dispatch wave must offer the ride to the ride-hailing rider'
        );

        $outcome = $this->service->handleRiderResponse($delivery->id, $transportRider->id, 'accepted');

        $this->assertTrue($outcome['success'], 'a ride-hailing rider must be able to accept a transport booking');
        $this->assertTrue($outcome['assigned'] ?? false);
        $this->assertSame($transportRider->id, $delivery->fresh()->rider_id);
        $this->assertSame('assigned', $delivery->fresh()->status->value);
        $this->assertSame('busy', $transportRider->riderDetail->fresh()->rider_status);
    }

    // ---------- C ----------

    public function test_food_rider_is_not_offered_and_cannot_accept_a_ride(): void
    {
        $foodRider = $this->makeRider('food-only@example.com', ['current_service' => 'food']);
        $this->setCandidates([$foodRider]);

        $order = $this->createRide(['payment_method' => 'gcash']);
        $delivery = $order->delivery;

        $this->assertFalse(
            $this->pendingLog($delivery, $foodRider)->exists(),
            'a food-service rider must never be offered a transport booking'
        );

        // Even a forged/stale offer must be refused by the accept-time gate.
        $this->makePendingOffer($delivery, $foodRider);
        $outcome = $this->service->handleRiderResponse($delivery->id, $foodRider->id, 'accepted');

        $this->assertFalse($outcome['success']);
        $this->assertNull($delivery->fresh()->rider_id);
        $this->assertSame('food', $foodRider->riderDetail->fresh()->current_service);
    }

    // ---------- D ----------

    public function test_transport_rider_cannot_accept_a_food_delivery(): void
    {
        $transportRider = $this->makeRider('ride-only@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$transportRider]);

        $delivery = $this->makeFoodDelivery($this->makeFoodOrder());

        $this->service->dispatchToNearest($delivery, 'food');
        $this->assertFalse(
            $this->pendingLog($delivery, $transportRider)->exists(),
            'a ride-hailing rider must not receive food delivery offers'
        );

        $this->makePendingOffer($delivery, $transportRider);
        $outcome = $this->service->handleRiderResponse($delivery->id, $transportRider->id, 'accepted');

        $this->assertFalse($outcome['success']);
        $this->assertNull($delivery->fresh()->rider_id);
    }

    // ---------- E ----------

    public function test_ride_lists_under_transport_history_tab_and_not_food_tab(): void
    {
        $order = $this->createRide();

        $transport = $this->getJson('/api/tourist/history?tab=transport', $this->authHeaders($this->tourist));
        $transport->assertOk();

        $transportIds = collect($transport->json('data.trips.data'))->pluck('id');
        $this->assertTrue(
            $transportIds->contains($order->id),
            'the ride must appear in the transport history tab'
        );

        $food = $this->getJson('/api/tourist/history?tab=food', $this->authHeaders($this->tourist));
        $food->assertOk();

        $foodIds = collect($food->json('data.orders.data'))->pluck('id');
        $this->assertFalse(
            $foodIds->contains($order->id),
            'the ride must never appear in the food history tab'
        );
    }
}
