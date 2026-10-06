<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\TransportationService;
use App\Services\WebsocketNotifierService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\TestCase;

/**
 * Tourist transport API contract.
 *
 * Protects the broken-integration fixes (B5–B8):
 *   - book() must return 201 + a plain-string redirect (no dead route name → 500)
 *   - tripStatus() must return the rich ride-status payload, NOT a bare Order
 *   - estimate() validates the canonical destination_lat/destination_lng names
 *   - cancelTrip() lifecycle guard: pre-start cancels + cancellation_fee,
 *     in-progress/completed trips are rejected with 422
 *   - ride_status derives from the delivery lifecycle (assigned → arriving,
 *     arrived_pickup → driver_arrived), never stuck at order 'pending'
 *   - the server is the fare authority (spec §64): book() re-derives the fare
 *     server-side and ignores any client-supplied fare/distance/duration
 *
 * NearestRiderService is mocked ONLY at the candidate-finder seam so the REAL
 * dispatch/accept code runs unmocked (same pattern as RideHailingAcceptanceTest).
 */
class TouristTransportContractTest extends TestCase
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
            'email' => 'contract-owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->makeBusiness('Contract Test Business');

        $this->tourist = User::create([
            'name' => 'Contract Tourist',
            'email' => 'contract-tourist@example.com',
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

    /**
     * createRide() reads Auth::user() for customer_name/email, so it must be
     * invoked while acting as the tourist even when called directly (not via HTTP).
     */
    private function createRideForTourist(array $payload = []): Order
    {
        $this->actingAs($this->tourist);

        return app(TransportationService::class)->createRide($payload ?: $this->bookPayload());
    }

    private function bookPayload(array $overrides = []): array
    {
        return array_merge([
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
        ], $overrides);
    }

    /**
     * The authoritative motorcycle fare the server derives for the canonical
     * contract-test coordinates. Never hardcoded: kept in lockstep with the
     * fare model so a fare-table change cannot silently invalidate the test.
     */
    private function expectedMotorcycleFare(): float
    {
        return (float) app(TransportationService::class)
            ->estimateFare(12.51, 121.31, 12.60, 121.40)['fares']['motorcycle']['fare'];
    }

    // ---------- 1. book ----------

    public function test_json_book_returns_201_with_string_redirect_and_creates_ride(): void
    {
        $response = $this->postJson('/api/tourist/transport/book', $this->bookPayload(), $this->authHeaders($this->tourist));

        $response->assertCreated()
            ->assertJsonPath('data.order_id', fn ($value) => is_int($value))
            ->assertJsonPath('data.redirect', '/tourist/transport/tracking/'.$response->json('data.order_id'));

        $order = Order::find($response->json('data.order_id'));
        $this->assertNotNull($order);
        $this->assertSame('transport', $order->order_type);
        $this->assertNotNull($order->delivery);
        $this->assertStringContainsString('Ride:', $order->items()->first()->product_name);
    }

    public function test_book_recomputes_authoritative_fare_ignoring_client_value(): void
    {
        $response = $this->postJson('/api/tourist/transport/book', $this->bookPayload([
            'fare' => 1,
            'distance_km' => 0.5,
            'duration_min' => 1,
        ]), $this->authHeaders($this->tourist));

        $response->assertCreated();

        $order = Order::find($response->json('data.order_id'));
        $expectedFare = $this->expectedMotorcycleFare();

        $this->assertSame($expectedFare, (float) $response->json('data.fare'));
        $this->assertSame($expectedFare, (float) $order->total);
        $this->assertSame($expectedFare, (float) $order->subtotal);
        $this->assertSame(1.0, (float) $order->items()->first()->quantity);
        $this->assertSame($expectedFare, (float) $order->items()->first()->unit_price);

        $notes = json_decode($order->delivery->notes, true);
        $this->assertSame($expectedFare, (float) $notes['fare']);
        $this->assertGreaterThan(1, (float) $notes['estimated_distance_km']);
    }

    public function test_book_accepts_payload_without_client_fare_fields(): void
    {
        $payload = $this->bookPayload();
        unset($payload['fare'], $payload['distance_km'], $payload['duration_min']);

        $response = $this->postJson('/api/tourist/transport/book', $payload, $this->authHeaders($this->tourist));

        $response->assertCreated();

        $order = Order::find($response->json('data.order_id'));
        $this->assertSame($this->expectedMotorcycleFare(), (float) $order->total);
    }

    // ---------- 2. estimate ----------

    public function test_estimate_accepts_canonical_field_names(): void
    {
        $response = $this->postJson('/api/tourist/transport/estimate', [
            'pickup_lat' => 12.51,
            'pickup_lng' => 121.31,
            'destination_lat' => 12.60,
            'destination_lng' => 121.40,
        ], $this->authHeaders($this->tourist));

        $response->assertOk();
        $fare = $response->json('data.fares.motorcycle');
        $this->assertNotNull($fare, 'motorcycle fare block must exist');
        $this->assertSame(50.0, (float) $fare['base_fare']);
        $this->assertSame(15.0, (float) $fare['per_km']);
    }

    public function test_estimate_rejects_legacy_dest_field_names(): void
    {
        $this->postJson('/api/tourist/transport/estimate', [
            'pickup_lat' => 12.51,
            'pickup_lng' => 121.31,
            'dest_lat' => 12.60,
            'dest_lng' => 121.40,
        ], $this->authHeaders($this->tourist))
            ->assertUnprocessable();
    }

    // ---------- 3/4. tripStatus ----------

    public function test_trip_status_returns_rich_payload_and_resolves_arriving_after_accept(): void
    {
        $rider = $this->makeRider('contract-rider@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $delivery = $order->delivery;
        $outcome = $this->service->handleRiderResponse($delivery->id, $rider->id, 'accepted');
        $this->assertTrue($outcome['success']);

        $response = $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist));

        $response->assertOk()
            ->assertJsonPath('data.status', 'arriving')
            ->assertJsonPath('data.vehicle_type', 'motorcycle')
            ->assertJsonPath('data.fare', $this->expectedMotorcycleFare())
            ->assertJsonPath('data.is_rated', false)
            ->assertJsonPath('data.rider.name', 'Rider')
            ->assertJsonPath('data.rider.plate_number', 'ABC 1234');
    }

    public function test_trip_status_maps_arrived_pickup_to_driver_arrived(): void
    {
        $rider = $this->makeRider('contract-arrived@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $delivery = $order->delivery;
        $this->service->handleRiderResponse($delivery->id, $rider->id, 'accepted');
        $delivery->update(['status' => 'arrived_pickup']);

        $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist))
            ->assertOk()
            ->assertJsonPath('data.status', 'driver_arrived')
            ->assertJsonPath('data.ride_pin', fn ($value) => is_string($value));
    }

    public function test_trip_status_is_visible_only_to_ride_owner(): void
    {
        $order = $this->createRideForTourist();

        $intruder = User::create([
            'name' => 'Intruder',
            'email' => 'contract-intruder@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($intruder))
            ->assertNotFound();
    }

    // ---------- 5/6. cancelTrip ----------

    public function test_cancel_trip_before_start_cancels_order_and_delivery(): void
    {
        $order = $this->createRideForTourist();

        $response = $this->postJson('/api/tourist/transport/trip/'.$order->id.'/cancel', [
            'reason' => 'changed_plans',
        ], $this->authHeaders($this->tourist));

        $response->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancellation_fee', 0);

        $this->assertSame('cancelled', $order->fresh()->status);
        $this->assertSame('cancelled', $order->delivery->fresh()->status->value);
        $this->assertNull($order->delivery->fresh()->dispatch_status);
        $this->assertSame('changed_plans', $order->fresh()->cancellation_reason);
    }

    public function test_cancel_trip_rejected_after_trip_started(): void
    {
        $rider = $this->makeRider('contract-started@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $delivery = $order->delivery;
        $this->service->handleRiderResponse($delivery->id, $rider->id, 'accepted');
        $delivery->update(['status' => 'picked_up']);

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/cancel', [
            'reason' => 'late',
        ], $this->authHeaders($this->tourist))
            ->assertUnprocessable();

        $this->assertNotSame('cancelled', $order->fresh()->status);
    }

    public function test_cancel_trip_rejected_for_completed_trip(): void
    {
        $order = $this->createRideForTourist();
        $order->update(['status' => 'completed', 'completed_at' => now()]);
        $order->delivery->update(['status' => 'completed']);

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/cancel', [], $this->authHeaders($this->tourist))
            ->assertUnprocessable();

        $this->assertSame('completed', $order->fresh()->status);
    }

    public function test_cancel_trip_visible_only_to_ride_owner(): void
    {
        $order = $this->createRideForTourist();

        $intruder = User::create([
            'name' => 'Intruder',
            'email' => 'contract-intruder2@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/cancel', [], $this->authHeaders($intruder))
            ->assertNotFound();
    }

    // ---------- 7. live tracking (rider_location + trip token) ----------

    public function test_book_sets_user_id_on_ride_order_for_socket_token_subject(): void
    {
        $response = $this->postJson('/api/tourist/transport/book', $this->bookPayload(), $this->authHeaders($this->tourist));

        $response->assertCreated();

        $order = Order::find($response->json('data.order_id'));
        $this->assertNotNull($order);
        $this->assertSame($this->tourist->id, $order->user_id);
    }

    public function test_trip_status_exposes_live_tracking_block_and_rider_location_after_accept(): void
    {
        config(['socket.bridge_secret' => 'fixture-secret']);

        $rider = $this->makeRider('contract-track@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $delivery = $order->delivery;
        $outcome = $this->service->handleRiderResponse($delivery->id, $rider->id, 'accepted');
        $this->assertTrue($outcome['success']);
        $this->assertSame($order->user_id, $this->tourist->id);

        $response = $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist));

        $response->assertOk();

        $tracking = $response->json('data.tracking');
        $this->assertNotNull($tracking, 'tracking block must exist once a rider is assigned');
        $this->assertSame($delivery->id, $tracking['delivery_id']);
        $this->assertSame('trip:'.$delivery->id, $tracking['room']);
        $this->assertSame('customer', $tracking['role']);
        $this->assertIsString($tracking['token']);
        $this->assertNotSame('', $tracking['token']);

        $location = $response->json('data.rider_location');
        $this->assertNotNull($location, 'rider_location must resolve to the assigned rider');
        $this->assertSame(12.51, (float) $location['latitude']);
        $this->assertSame(121.31, (float) $location['longitude']);
    }

    public function test_trip_status_tracking_null_while_searching_for_driver(): void
    {
        $order = $this->createRideForTourist();

        $response = $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist));

        $response->assertOk()
            ->assertJsonPath('data.status', 'searching')
            ->assertJsonPath('data.tracking', null)
            ->assertJsonPath('data.rider_location', null);
    }

    public function test_trip_status_tracking_null_when_bridge_secret_missing(): void
    {
        config(['socket.bridge_secret' => '']);

        $rider = $this->makeRider('contract-nosecret@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $delivery = $order->delivery;
        $this->service->handleRiderResponse($delivery->id, $rider->id, 'accepted');

        $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist))
            ->assertOk()
            ->assertJsonPath('data.tracking', null);
    }

    // ---------- 8. Phase 5 — payment state + rating ----------

    public function test_trip_status_exposes_payment_state_and_allowed_rating_tags(): void
    {
        $order = $this->createRideForTourist();

        $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist))
            ->assertOk()
            ->assertJsonPath('data.payment_method', 'gcash')
            ->assertJsonPath('data.payment_status', 'pending')
            ->assertJsonPath('data.paid_amount', 0)
            ->assertJsonPath('data.rating_tags', [])
            ->assertJsonPath('data.allowed_rating_tags', TransportationService::RATING_TAGS);
    }

    public function test_trip_status_reflects_paid_state_after_successful_payment(): void
    {
        $order = $this->createRideForTourist();
        $order->update([
            'payment_status' => 'paid',
            'paid_amount' => $order->total,
            'payment_method' => 'gcash',
        ]);

        $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist))
            ->assertOk()
            ->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.paid_amount', (float) $order->fresh()->total);
    }

    public function test_trip_status_receipt_math_line_items_sum_to_fare(): void
    {
        $order = $this->createRideForTourist();

        $data = $this->getJson('/api/tourist/transport/trip/'.$order->id.'/status', $this->authHeaders($this->tourist))
            ->assertOk()
            ->json('data');

        $this->assertSame((float) $order->fresh()->total, (float) $data['fare'], 'Booked fare is the authoritative total.');
        $this->assertSame($data['base_fare'] + $data['distance_fare'], $data['fare'], 'Base + distance must sum to the fare.');
        $this->assertSame($data['estimate_fare'], $data['fare'], 'Estimate equals final in the single-fare MVP.');
        $this->assertSame((float) config('delivery.service_fee', 0.00), (float) $data['service_fee'], 'service_fee stays out of the total.');
    }

    public function test_rate_trip_accepts_rating_review_and_tags_on_completed_ride(): void
    {
        $order = $this->createRideForTourist();
        $order->update(['status' => 'completed', 'completed_at' => now()]);
        $order->delivery->update(['status' => 'completed']);

        $response = $this->postJson('/api/tourist/transport/trip/'.$order->id.'/rate', [
            'rating' => 5,
            'review' => 'Great ride',
            'tags' => ['friendly', 'safe_driving'],
        ], $this->authHeaders($this->tourist));

        $response->assertOk();

        $fresh = $order->fresh();
        $this->assertSame(5, (int) $fresh->rating);
        $this->assertSame('Great ride', $fresh->review);
        $this->assertSame(['friendly', 'safe_driving'], $fresh->rating_tags);

        // A ride has no owning restaurant (business_id = NULL), so rating it
        // must NOT create a business review row (canonical ride isolation).
        $this->assertNull($fresh->business_id, 'Rides must never carry a restaurant business_id.');
        $this->assertDatabaseMissing('reviews', [
            'user_id' => $this->tourist->id,
            'rating' => 5,
        ]);
    }

    public function test_rate_trip_rejects_ride_that_is_not_completed(): void
    {
        $rider = $this->makeRider('contract-rate-active@example.com', ['current_service' => 'transport']);
        $this->setCandidates([$rider]);

        $order = $this->createRideForTourist();
        $delivery = $order->delivery;
        $this->service->handleRiderResponse($delivery->id, $rider->id, 'accepted');
        $delivery->update(['status' => 'picked_up']);

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/rate', [
            'rating' => 5,
        ], $this->authHeaders($this->tourist))
            ->assertUnprocessable();

        $this->assertNull($order->fresh()->rating);
    }

    public function test_rate_trip_blocks_duplicate_rating(): void
    {
        $order = $this->createRideForTourist();
        $order->update(['status' => 'completed', 'completed_at' => now()]);
        $order->delivery->update(['status' => 'completed']);

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/rate', [
            'rating' => 5,
        ], $this->authHeaders($this->tourist))
            ->assertOk();

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/rate', [
            'rating' => 3,
        ], $this->authHeaders($this->tourist))
            ->assertUnprocessable();

        $this->assertSame(5, (int) $order->fresh()->rating);
    }

    public function test_rate_trip_rejects_unknown_tags(): void
    {
        $order = $this->createRideForTourist();
        $order->update(['status' => 'completed', 'completed_at' => now()]);

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/rate', [
            'rating' => 5,
            'tags' => ['not_a_real_tag'],
        ], $this->authHeaders($this->tourist))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tags.0']);

        $this->assertNull($order->fresh()->rating_tags);
    }

    public function test_rate_trip_is_visible_only_to_ride_owner(): void
    {
        $order = $this->createRideForTourist();
        $order->update(['status' => 'completed', 'completed_at' => now()]);

        $intruder = User::create([
            'name' => 'Intruder',
            'email' => 'contract-rated-intruder@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/rate', [
            'rating' => 5,
        ], $this->authHeaders($intruder))
            ->assertNotFound();
    }

    public function test_cancel_trip_records_cancelled_at(): void
    {
        $order = $this->createRideForTourist();

        $this->postJson('/api/tourist/transport/trip/'.$order->id.'/cancel', [
            'reason' => 'changed_plans',
        ], $this->authHeaders($this->tourist))
            ->assertOk();

        $this->assertNotNull($order->fresh()->cancelled_at);
    }

    public function test_create_intent_uses_ride_fare_line_item_for_transport_order(): void
    {
        config(['services.paymongo.secret_key' => 'sk_test_ride_label']);

        $capturedPayload = null;

        Http::fake([
            'api.paymongo.com/v1/checkout_sessions' => function ($request) use (&$capturedPayload) {
                $capturedPayload = $request->data();

                return Http::response([
                    'data' => [
                        'id' => 'cs_ride_label',
                        'attributes' => [
                            'status' => 'active',
                            'checkout_url' => 'https://checkout.paymongo.com/cs_ride_label',
                        ],
                    ],
                ], 200);
            },
        ]);

        $order = $this->createRideForTourist();

        $this->postJson('/api/payments/create-intent', [
            'payable_type' => 'order',
            'payable_id' => $order->id,
            'method' => 'gcash',
        ], $this->authHeaders($this->tourist))
            ->assertOk();

        $attributes = $capturedPayload['data']['attributes'] ?? [];
        $this->assertSame('Ride Fare', $attributes['line_items'][0]['name']);
        $this->assertSame((int) round($order->total * 100), $attributes['line_items'][0]['amount']);
        $this->assertCount(1, $attributes['line_items'], 'A ride is a single-fare line item.');
        $this->assertSame(['gcash'], $attributes['payment_method_types']);
    }

    public function test_create_intent_rejects_payment_for_cancelled_ride(): void
    {
        config(['services.paymongo.secret_key' => 'sk_test_ride_cancel']);

        Http::fake();

        $order = $this->createRideForTourist();
        $order->update(['status' => 'cancelled', 'cancelled_at' => now()]);
        $order->delivery->update(['status' => 'cancelled']);

        $this->postJson('/api/payments/create-intent', [
            'payable_type' => 'order',
            'payable_id' => $order->id,
            'method' => 'gcash',
        ], $this->authHeaders($this->tourist))
            ->assertStatus(422);

        $this->assertDatabaseMissing('payments', [
            'payable_type' => Order::class,
            'payable_id' => $order->id,
        ]);
    }

    public function test_checkout_webhook_marks_ride_paid_without_food_fanout(): void
    {
        config(['services.paymongo.webhook_secret' => '']);

        $order = $this->createRideForTourist();

        Payment::create([
            'payment_number' => 'PAY-RIDE-WH01',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => $order->total,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'cs_ride_wh_session',
        ]);

        $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'checkout_session.completed',
                    'data' => [
                        'id' => 'cs_ride_wh_session',
                        'status' => 'completed',
                    ],
                ],
            ],
        ])->assertOk();

        $this->assertDatabaseHas('payments', [
            'payment_number' => 'PAY-RIDE-WH01',
            'status' => 'paid',
        ]);

        $fresh = $order->fresh();
        $this->assertSame('paid', $fresh->payment_status);
        $this->assertSame((float) $order->total, (float) $fresh->paid_amount);
        $this->assertNotSame('waiting_restaurant', $fresh->status, 'A ride must never enter the kitchen flow.');
        $this->assertNotSame('preparing', $fresh->status, 'A ride must never enter the kitchen flow.');
        $this->assertSame('pending', $fresh->status, 'Ride order status is finalized by the delivery, not payment.');
    }

    public function test_checkout_webhook_never_resurrects_a_cancelled_ride(): void
    {
        config(['services.paymongo.webhook_secret' => '']);

        $order = $this->createRideForTourist();
        $order->update(['status' => 'cancelled', 'cancelled_at' => now()]);
        $order->delivery->update(['status' => 'cancelled']);

        Payment::create([
            'payment_number' => 'PAY-RIDE-WH02',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => $order->total,
            'method' => 'gcash',
            'status' => 'pending',
            'provider_payment_id' => 'cs_ride_wh_cancelled',
        ]);

        $this->postJson('/api/payments/webhook', [
            'data' => [
                'attributes' => [
                    'type' => 'checkout_session.completed',
                    'data' => [
                        'id' => 'cs_ride_wh_cancelled',
                        'status' => 'completed',
                    ],
                ],
            ],
        ])->assertOk();

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'payment_status' => 'paid',
            'status' => 'cancelled',
        ]);
    }
}