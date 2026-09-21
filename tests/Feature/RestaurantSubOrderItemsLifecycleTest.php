<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderCredit;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Tests TrackTour's two levels of grouping and item-level readiness rules:
 * 1. Group Order (customer checkout) containing multiple Restaurant Sub-Orders.
 * 2. Restaurant Sub-Order containing items belonging to one specific restaurant.
 * 3. A restaurant sub-order CANNOT become 'ready' (READY_FOR_PICKUP) until ALL items
 *    belonging to that restaurant are ready.
 * 4. Restaurants proceed independently (Restaurant B can become READY_FOR_PICKUP
 *    while Restaurant A is still PREPARING).
 * 5. Exactly 1 physical delivery + 1 rider assignment per GROUP checkout
 *    (never per restaurant sub-order; never per food item).
 * 6. Clean COD accounting per restaurant sub-order.
 */
class RestaurantSubOrderItemsLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private User $ownerA;
    private User $ownerB;
    private User $customer;
    private User $riderA;
    private User $riderB;
    private Business $restaurantA;
    private Business $restaurantB;
    private GroupOrderService $groupService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->ownerA = User::create([
            'name' => 'Owner A',
            'email' => 'owner-a@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->ownerB = User::create([
            'name' => 'Owner B',
            'email' => 'owner-b@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->customer = User::create([
            'name' => 'John Tourist',
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
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
            [['open' => '00:00', 'close' => '23:59']]
        );

        $this->restaurantA = Business::create([
            'owner_id' => $this->ownerA->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant A',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);

        $this->restaurantB = Business::create([
            'owner_id' => $this->ownerB->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant B',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.52,
            'longitude' => 121.32,
        ]);

        $this->riderA = $this->makeRider('rider-a@example.com', 'Rider A', $this->restaurantA);
        $this->riderB = $this->makeRider('rider-b@example.com', 'Rider B', $this->restaurantB);

        $nearestRiderMock = new class(app(\App\Services\FirebaseService::class)) extends NearestRiderService {
            public function __construct($firebase)
            {
                parent::__construct($firebase);
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
                    ->each(fn ($u) => $u->setAttribute('distance_km', 1.0))
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
                    'distance_km' => 1.0,
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

    private function makeRider(string $email, string $name, Business $business): User
    {
        $rider = User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'online',
            'current_service' => 'food',
            'municipality_id' => $business->municipality_id,
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderCredit::create([
            'rider_id' => $rider->id,
            'total_credits' => 10000,
            'reserved_credits' => 0,
        ]);

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => $business->latitude,
            'longitude' => $business->longitude,
            'recorded_at' => now(),
        ]);

        return $rider;
    }

    private function authHeaders(User $user): array
    {
        $token = $user->createToken('test-token')->plainTextToken;
        return [
            'Authorization' => "Bearer {$token}",
            'Accept' => 'application/json',
        ];
    }

    private function dispatchService(): NearestRiderService
    {
        return $this->app->make(NearestRiderService::class);
    }

    private function assertRiderAccepted(Delivery $delivery, User $rider): void
    {
        $result = $this->dispatchService()->handleRiderResponse($delivery->id, $rider->id, 'accepted');
        $this->assertTrue($result['success'] ?? false, 'Rider accepts the delivery offer.');
        $this->assertSame($rider->id, $delivery->fresh()->rider_id, 'Delivery assigned to the accepting rider.');
    }

    public function test_restaurant_sub_order_readiness_and_independent_dispatch_rules(): void
    {
        // 1. Create food offerings for Restaurant A and Restaurant B
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);
        $fries = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Fries', 'price' => 80.00, 'is_available' => true, 'status' => 'available']);
        $coke = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Coke', 'price' => 50.00, 'is_available' => true, 'status' => 'available']);

        $pizza = Offering::create(['business_id' => $this->restaurantB->id, 'name' => 'Pizza', 'price' => 350.00, 'is_available' => true, 'status' => 'available']);
        $pasta = Offering::create(['business_id' => $this->restaurantB->id, 'name' => 'Pasta', 'price' => 220.00, 'is_available' => true, 'status' => 'available']);

        // 2. Customer places 1 group order via COD
        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55,
            'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash',
            'rider_tip' => 40.00,
            'restaurants' => [
                [
                    'business_id' => $this->restaurantA->id,
                    'items' => [
                        ['offering_id' => $burger->id, 'quantity' => 1],
                        ['offering_id' => $fries->id, 'quantity' => 1],
                        ['offering_id' => $coke->id, 'quantity' => 1],
                    ],
                ],
                [
                    'business_id' => $this->restaurantB->id,
                    'items' => [
                        ['offering_id' => $pizza->id, 'quantity' => 1],
                        ['offering_id' => $pasta->id, 'quantity' => 1],
                    ],
                ],
            ],
        ]);

        $this->assertSame('pending', $group->status);
        $this->assertCount(2, $group->orders);

        $subOrderA = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $subOrderB = $group->orders()->where('business_id', $this->restaurantB->id)->first();

        // Level 2 Grouping: Exactly 1 sub-order per restaurant
        $this->assertNotNull($subOrderA);
        $this->assertNotNull($subOrderB);
        $this->assertCount(3, $subOrderA->items);
        $this->assertCount(2, $subOrderB->items);

        // 3. P11.2 dispatch-at-creation: THE GROUP's single physical delivery is
        // created and offered to a rider as soon as the COD group is placed
        // (before the restaurants accept), and a rider must accept before
        // preparation starts. Sub-orders never spawn their own delivery.
        $this->assertNull($subOrderA->fresh()->delivery, 'Sub-order A owns no per-restaurant delivery.');
        $this->assertNull($subOrderB->fresh()->delivery, 'Sub-order B owns no per-restaurant delivery.');
        $delivery = $group->fresh()->delivery;
        $this->assertNotNull($delivery, 'The group owns exactly one shared delivery.');
        $this->assertNull($delivery->order_id);
        $this->assertSame($group->id, $delivery->group_checkout_id);
        $this->assertSame('notified', $delivery->dispatch_status, 'Shared trip offered at group creation.');
        $this->assertSame(1, BookingDispatchLog::count());

        // Exactly ONE rider for the shared trip. The single outstanding offer
        // went to rider A (deterministic mock, lowest id); rider B has no offer.
        $this->assertSame($this->riderA->id, BookingDispatchLog::where('delivery_id', $delivery->id)->first()->rider_id);
        $unoffered = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderB->id, 'accepted');
        $this->assertFalse($unoffered['success'] ?? true, 'Rider without an offer cannot claim the shared trip.');
        $this->assertRiderAccepted($delivery->fresh(), $this->riderA);

        // Restaurants accept only after a rider is assigned (P11.2 rider-gate).
        $this->postJson("/api/business-owner/orders/{$subOrderA->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertOk();

        $this->postJson("/api/business-owner/orders/{$subOrderB->id}/accept", [], $this->authHeaders($this->ownerB))
            ->assertOk();

        $subOrderA->refresh();
        $subOrderB->refresh();

        $this->assertSame('preparing', $subOrderA->status);
        $this->assertSame('preparing', $subOrderB->status);

        // 4. Restaurant A: Burger = READY, Coke = READY, Fries remains PREPARING
        $itemBurger = $subOrderA->items()->where('product_name', 'Burger')->first();
        $itemFries = $subOrderA->items()->where('product_name', 'Fries')->first();
        $itemCoke = $subOrderA->items()->where('product_name', 'Coke')->first();

        $this->patchJson("/api/business-owner/orders/{$subOrderA->id}/items/{$itemBurger->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerA))->assertOk();

        $this->patchJson("/api/business-owner/orders/{$subOrderA->id}/items/{$itemCoke->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerA))->assertOk();

        $subOrderA->refresh();

        // RULE: Restaurant sub-order A CANNOT become ready/READY_FOR_PICKUP because Fries is not ready
        $this->assertSame('preparing', $subOrderA->status, 'Sub-order A stays PREPARING because Fries is still preparing.');
        $this->assertSame($this->riderA->id, $subOrderA->activeDelivery()?->rider_id, 'Delivery A stays assigned to its accepted rider.');

        // 5. Restaurant B: Pizza = READY, Pasta = READY -> ALL items for B are ready!
        $itemPizza = $subOrderB->items()->where('product_name', 'Pizza')->first();
        $itemPasta = $subOrderB->items()->where('product_name', 'Pasta')->first();

        $this->patchJson("/api/business-owner/orders/{$subOrderB->id}/items/{$itemPizza->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerB))->assertOk();

        $this->patchJson("/api/business-owner/orders/{$subOrderB->id}/items/{$itemPasta->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerB))->assertOk();

        $subOrderB->refresh();

        // RULE: Restaurant B becomes READY_FOR_PICKUP independently
        $this->assertSame('ready', $subOrderB->status, 'Sub-order B becomes READY because all its items are ready.');
        $this->assertSame($this->riderA->id, $subOrderB->activeDelivery()?->rider_id, 'Sub-order B resolves its rider via the shared trip.');

        // Restaurant A did NOT have to wait for Restaurant B, and Restaurant B did not wait for Restaurant A!
        $subOrderA->refresh();
        $this->assertSame('preparing', $subOrderA->status, 'Restaurant A is still PREPARING.');

        // 6. Restaurant A completes Fries -> ALL items for Restaurant A are now ready!
        $this->patchJson("/api/business-owner/orders/{$subOrderA->id}/items/{$itemFries->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerA))->assertOk();

        $subOrderA->refresh();

        // RULE: Now that all items are ready, Restaurant Sub-Order A becomes READY_FOR_PICKUP!
        $this->assertSame('ready', $subOrderA->status, 'Sub-order A transitions to READY once all items are ready.');
        $this->assertSame($this->riderA->id, $subOrderA->activeDelivery()?->rider_id, 'Delivery A remains assigned to its accepted rider.');

        // 7. COD Accounting Verification:
        // Each restaurant sub-order has its own independent cash amount, delivery fee, and tip
        $this->assertSame('cash', $subOrderA->payment_method);
        $this->assertSame('cash', $subOrderB->payment_method);
        $this->assertGreaterThan(0, (float) $subOrderA->total);
        $this->assertGreaterThan(0, (float) $subOrderB->total);
        $this->assertEquals(
            round((float) $subOrderA->total + (float) $subOrderB->total, 2),
            round((float) $group->grand_total, 2),
            'Sum of sub-order totals equals the unified group checkout grand total.'
        );
    }
}
