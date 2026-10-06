<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * P5 — Grouped pickup/routing: the prep-ordered grouped pickup route is a
 * canonical, payment-method-independent surface of an assigned delivery.
 *
 * A multi-restaurant trip (COD or prepaid) routes the rider through EVERY
 * fulfilling restaurant in ascending preparation time (shortest prep first),
 * exposes the longest-prep restaurant as the drop-off route origin, and the
 * tourist destination as the drop-off point. The rider-facing endpoint
 * GET /rider/deliveries/{delivery}/pickup-route serves it; COD stops keep
 * their purchasing-cash ledger row attached so the cash panel + ALL-COLLECTED
 * gate stay unchanged, while prepaid stops carry none.
 */
class GroupPickupRouteTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $riderA;
    private User $riderB;
    private Business $restaurantA;
    private Business $restaurantB;
    private GroupOrderService $groupService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-pickup-route@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59'], ['open' => '23:59', 'close' => '00:00']]
        );

        $this->restaurantA = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant A',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.51,
            'longitude' => 121.31,
            'address' => 'Restaurant A St',
        ]);

        $this->restaurantB = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant B',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.52,
            'longitude' => 121.32,
            'address' => 'Restaurant B St',
        ]);

        $this->riderA = $this->makeRider('ridera-pickup-route@example.com', 'Rider A');
        $this->riderB = $this->makeRider('riderb-pickup-route@example.com', 'Rider B');

        $nearestRiderMock = new class() extends NearestRiderService {
            public function __construct()
            {
                parent::__construct();
            }

            public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
            {
                return User::where('role', User::ROLE_RIDER)
                    ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
                    ->whereHas('riderDetail', fn ($q) => $q
                        ->whereIn('rider_status', [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE])
                        ->where('current_service', $serviceType))
                    ->with(['locations' => fn ($q) => $q->latest('recorded_at')->limit(1)])
                    ->get()
                    ->each(fn ($u) => $u->setAttribute('distance_km', 1.5))
                    ->sortBy('id')
                    ->values();
            }

            public function dispatchToNearest(Delivery $delivery, string $serviceType = 'food', ?int $municipalityId = null): ?User
            {
                $rider = $this->findNearestAvailableRiders(
                    (float) $delivery->pickup_latitude,
                    (float) $delivery->pickup_longitude,
                    $serviceType,
                    5,
                    $municipalityId
                )->first();

                if (! $rider) {
                    $delivery->update(['dispatch_status' => 'no_rider_available']);
                    return null;
                }

                BookingDispatchLog::create([
                    'delivery_id' => $delivery->id,
                    'rider_id' => $rider->id,
                    'distance_km' => 1.5,
                    'response' => 'pending',
                    'dispatched_at' => now(),
                ]);

                $delivery->update([
                    'dispatch_status' => 'notified',
                    'dispatch_expires_at' => now()->addSeconds(NearestRiderService::DISPATCH_TIMEOUT_SECONDS),
                ]);

                return $rider;
            }
        };

        $this->app->instance(NearestRiderService::class, $nearestRiderMock);

        $this->groupService = $this->app->make(GroupOrderService::class);
    }

    private function makeRider(string $email, string $name): User
    {
        $rider = User::create([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
            'municipality_id' => $this->restaurantA->municipality_id,
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => $this->restaurantA->latitude,
            'longitude' => $this->restaurantA->longitude,
            'recorded_at' => now(),
        ]);

        return $rider;
    }

    private function makeOffering(Business $business, string $name, float $price, ?int $prepTime = null): Offering
    {
        return Offering::create([
            'business_id' => $business->id,
            'name' => $name,
            'price' => $price,
            'is_available' => true,
            'status' => 'available',
            'preparation_time' => $prepTime,
        ]);
    }

    private function basePayload(array $restaurants, string $paymentMethod = 'gcash'): array
    {
        return [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'delivery_address' => '123 Test St',
            'payment_method' => $paymentMethod,
            'rider_tip' => 40.00,
            'notes' => null,
            'restaurants' => $restaurants,
        ];
    }

    private function createAndDispatchGroup(array $restaurants, string $paymentMethod = 'gcash'): Delivery
    {
        $group = $this->groupService->createGroup($this->owner, $this->basePayload($restaurants, $paymentMethod));
        app(\App\Services\SmartDispatchService::class)->scheduleGroupDispatch($group->fresh());
        $delivery = $group->fresh()->delivery;
        $this->assertNotNull($delivery, 'Group owns exactly one shared delivery.');

        return $delivery;
    }

    private function acceptDelivery(Delivery $delivery): void
    {
        $result = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderA->id, 'accepted');
        $this->assertTrue($result['success'] ?? false, 'Rider A accepts the shared trip.');
        $delivery->refresh();
    }

    private function dispatchService(): NearestRiderService
    {
        return $this->app->make(NearestRiderService::class);
    }

    private function twoRestaurantItems(): array
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00, 5);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 80.00, 10);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00, 20);
        $pasta = $this->makeOffering($this->restaurantB, 'Pasta', 250.00, 25);

        return [
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
                ['offering_id' => $fries->id, 'quantity' => 1, 'notes' => null],
            ]],
            ['business_id' => $this->restaurantB->id, 'items' => [
                ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
                ['offering_id' => $pasta->id, 'quantity' => 1, 'notes' => null],
            ]],
        ];
    }

    private function pickupRoutePayload(Delivery $delivery): array
    {
        return $this->be($this->riderA)
            ->getJson('/api/rider/deliveries/' . $delivery->id . '/pickup-route')
            ->assertOk()
            ->json('data');
    }

    public function test_prepaid_group_delivery_exposes_ordered_pickup_route_with_origin_and_dropoff(): void
    {
        $delivery = $this->createAndDispatchGroup($this->twoRestaurantItems(), 'gcash');
        $this->acceptDelivery($delivery);

        $route = $this->pickupRoutePayload($delivery);

        $this->assertSame($delivery->id, $route['delivery_id']);
        $this->assertFalse($route['is_cod'], 'Prepaid trip has no purchasing-cash flow.');
        $this->assertCount(2, $route['stops']);

        // Fastest prep is picked up first: Restaurant A (10 min max) before B (25 min max).
        $first = $route['stops'][0];
        $second = $route['stops'][1];

        $this->assertSame($this->restaurantA->id, $first['business_id']);
        $this->assertSame('Restaurant A', $first['business_name']);
        $this->assertSame(1, $first['sequence']);
        $this->assertSame(10, $first['preparation_time']);
        $this->assertEquals((float) $this->restaurantA->latitude, (float) $first['pickup_lat']);
        $this->assertEquals((float) $this->restaurantA->longitude, (float) $first['pickup_lng']);
        $this->assertSame('Restaurant A St', $first['pickup_address']);
        $this->assertNull($first['cod_purchase'], 'Prepaid stops carry no purchasing-cash ledger row.');

        $this->assertSame($this->restaurantB->id, $second['business_id']);
        $this->assertSame(2, $second['sequence']);
        $this->assertSame(25, $second['preparation_time']);

        // Longest prep is the drop-off route origin.
        $origin = $route['pickup_origin'];
        $this->assertNotNull($origin);
        $this->assertSame($this->restaurantB->id, $origin['business_id']);
        $this->assertSame('Restaurant B', $origin['business_name']);
        $this->assertEquals((float) $this->restaurantB->latitude, (float) $origin['latitude']);
        $this->assertEquals((float) $this->restaurantB->longitude, (float) $origin['longitude']);

        // The drop-off point is the tourist destination + address.
        $this->assertEquals(12.6, (float) $route['dropoff']['latitude']);
        $this->assertEquals(121.4, (float) $route['dropoff']['longitude']);
        $this->assertSame('123 Test St', $route['dropoff']['address']);
    }

    public function test_prepaid_single_restaurant_delivery_has_one_stop_route(): void
    {
        $soup = $this->makeOffering($this->restaurantA, 'Soup', 150.00, 15);
        $delivery = $this->createAndDispatchGroup([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $soup->id, 'quantity' => 1, 'notes' => null],
            ]],
        ], 'gcash');
        $this->acceptDelivery($delivery);

        $route = $this->pickupRoutePayload($delivery);

        $this->assertCount(1, $route['stops']);
        $this->assertSame($this->restaurantA->id, $route['stops'][0]['business_id']);
        $this->assertSame(1, $route['stops'][0]['sequence']);
        $this->assertSame(15, $route['stops'][0]['preparation_time']);

        // For a single pick-up the origin IS the restaurant the rider collects from.
        $this->assertSame($this->restaurantA->id, $route['pickup_origin']['business_id']);
        $this->assertEquals((float) $this->restaurantA->latitude, (float) $route['pickup_origin']['latitude']);

        $this->assertEquals(12.6, (float) $route['dropoff']['latitude']);
    }

    public function test_cod_pickup_route_matches_the_purchases_ledger_and_orders_stops(): void
    {
        $delivery = $this->createAndDispatchGroup($this->twoRestaurantItems(), 'cash');
        $this->acceptDelivery($delivery);

        $this->be($this->riderA);
        $route = $this->getJson('/api/rider/deliveries/' . $delivery->id . '/pickup-route')->assertOk()->json('data');
        $purchases = $this->getJson('/api/rider/deliveries/' . $delivery->id . '/purchases')->assertOk()->json('data');

        $this->assertTrue($route['is_cod']);
        $this->assertSame($delivery->id, $route['delivery_id']);

        // The route stop set mirrors the purchasing-cash ledger 1:1 and the
        // ordering is identical (ascending preparation time).
        $this->assertSame(
            collect($purchases['purchases'])->pluck('business_id')->all(),
            collect($route['stops'])->pluck('business_id')->all()
        );

        // COD stops carry their cod_purchases row (amount, status, purchase
        // number) so the cash panel and the ALL-COLLECTED gate keep working.
        foreach ($route['stops'] as $stop) {
            $this->assertNotNull($stop['cod_purchase'], 'COD stops carry their ledger row.');
            $ledger = collect($purchases['purchases'])->firstWhere('business_id', $stop['business_id']);
            $this->assertNotNull($ledger);
            $this->assertSame($ledger['id'], $stop['cod_purchase']['id']);
            $this->assertEquals((float) $ledger['purchase_amount'], (float) $stop['cod_purchase']['purchase_amount']);
            $this->assertSame($ledger['status'], $stop['cod_purchase']['status']);
        }

        $total = round(array_sum(array_map(fn ($s) => (float) $s['cod_purchase']['purchase_amount'], $route['stops'])), 2);
        $this->assertEquals((float) $delivery->fresh()->purchasing_cash, $total, 'Stops sum to the auto-issued purchasing cash.');

        $this->assertSame($purchases['pickup_origin']['business_id'], $route['pickup_origin']['business_id']);
        $this->assertEquals((float) $purchases['dropoff']['latitude'], (float) $route['dropoff']['latitude']);
    }

    public function test_pickup_route_denies_unauthorized_rider_and_guest(): void
    {
        $delivery = $this->createAndDispatchGroup($this->twoRestaurantItems(), 'gcash');
        $this->acceptDelivery($delivery);

        // Guests hit the token fence before any role/ownership checks.
        $this->getJson('/api/rider/deliveries/' . $delivery->id . '/pickup-route')->assertStatus(401);

        // The other rider is not assigned to this trip.
        $this->be($this->riderB);
        $this->getJson('/api/rider/deliveries/' . $delivery->id . '/pickup-route')->assertStatus(403);
    }
}