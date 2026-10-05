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
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Item-level readiness rules under the ONE-ORDER group-checkout architecture
 * (AGENTS.md §4.1):
 * 1. A group checkout spanning multiple restaurants creates ONE canonical order
 *    whose items carry the owning restaurant's business_id.
 * 2. The order CANNOT become 'ready' (READY_FOR_PICKUP) until ALL active items
 *    across every participating restaurant are ready.
 * 3. Restaurants progress their own item groups independently (Restaurant B's
 *    items can all be 'ready' while Restaurant A's group is still preparing).
 * 4. Exactly 1 physical delivery + 1 rider assignment per group checkout,
 *    anchored on the canonical order and the group (never one per restaurant).
 * 5. Clean COD accounting is unified on the single order / single shared trip.
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

public function test_one_order_item_readiness_gate_and_shared_delivery_rules(): void
    {
        // 1. Restaurant-owned menu items.
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);
        $fries = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Fries', 'price' => 80.00, 'is_available' => true, 'status' => 'available']);
        $coke = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Coke', 'price' => 50.00, 'is_available' => true, 'status' => 'available']);

        $pizza = Offering::create(['business_id' => $this->restaurantB->id, 'name' => 'Pizza', 'price' => 350.00, 'is_available' => true, 'status' => 'available']);
        $pasta = Offering::create(['business_id' => $this->restaurantB->id, 'name' => 'Pasta', 'price' => 220.00, 'is_available' => true, 'status' => 'available']);

        // 2. A 2-restaurant COD group checkout is ONE canonical order (Rule 4.1).
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
        $this->assertCount(1, $group->orders, 'Never one orders row per restaurant/item for a group checkout.');

        $order = $group->orders()->sole()->load('items');
        $this->assertSame($this->restaurantA->id, $order->business_id, 'Canonical order is anchored on the first restaurant.');
        $this->assertCount(5, $order->items);
        $this->assertSame(3, $order->items->where('business_id', $this->restaurantA->id)->count(), 'Restaurant A owns its 3 items.');
        $this->assertSame(2, $order->items->where('business_id', $this->restaurantB->id)->count(), 'Restaurant B owns its 2 items.');
        $this->assertEquals(round((float) $group->grand_total, 2), round((float) $order->total, 2), 'One order total equals the group grand total.');

        // 3. ONE shared physical delivery offered at creation (P11.2 gate).
        $delivery = $group->fresh()->delivery;
        $this->assertNotNull($delivery, 'The group owns exactly one shared delivery.');
        $this->assertSame($order->id, $delivery->order_id, 'Shared delivery references the canonical order.');
        $this->assertSame($group->id, $delivery->group_checkout_id, 'Shared delivery is anchored on the group checkout.');
        $this->assertSame('notified', $delivery->dispatch_status, 'Shared trip offered at group creation.');
        $this->assertSame(1, BookingDispatchLog::count());

        // Exactly ONE rider for the shared trip. The single outstanding offer
        // went to rider A (deterministic mock, lowest id); rider B has no offer.
        $this->assertSame($this->riderA->id, BookingDispatchLog::where('delivery_id', $delivery->id)->first()->rider_id);
        $unoffered = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderB->id, 'accepted');
        $this->assertFalse($unoffered['success'] ?? true, 'Rider without an offer cannot claim the shared trip.');
        $this->assertRiderAccepted($delivery->fresh(), $this->riderA);

        // 4. Acceptance is a single order-level action once a rider is assigned.
        $this->postJson("/api/business-owner/orders/{$order->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertOk();

        $this->postJson("/api/business-owner/orders/{$order->id}/accept", [], $this->authHeaders($this->ownerB))
            ->assertStatus(422, 'A second restaurant cannot accept the already-preparing canonical order.');

        $order->refresh();
        $this->assertSame('preparing', $order->status, 'Accepting auto-starts preparation for the whole shared order.');

        $itemBurger = $order->items->firstWhere('product_name', 'Burger');
        $itemFries = $order->items->firstWhere('product_name', 'Fries');
        $itemCoke = $order->items->firstWhere('product_name', 'Coke');
        $itemPizza = $order->items->firstWhere('product_name', 'Pizza');
        $itemPasta = $order->items->firstWhere('product_name', 'Pasta');

        // 5. Restaurant A readies Burger + Coke; Fries stays preparing.
        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemBurger->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerA))->assertOk();

        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemCoke->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerA))->assertOk();

        // RULE: the shared order cannot flip to READY while any active item is not ready.
        $this->assertSame('preparing', $order->refresh()->status, 'Order stays PREPARING because Fries is still preparing.');

        // 6. Restaurant B readies its ENTIRE item group independently, but the
        //    order must STILL stay PREPARING because Restaurant A's group is
        //    still incomplete (readiness is order-wide, one order).
        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemPizza->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerB))->assertOk();

        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemPasta->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerB))->assertOk();

        $this->assertSame('preparing', $order->refresh()->status, 'Restaurant B finishing its item group does NOT flip the shared order.');

        // 7. Restaurant A completes Fries -> ALL items of every restaurant are
        //    now ready -> the single order becomes READY_FOR_PICKUP.
        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemFries->id}/status", [
            'status' => 'ready',
        ], $this->authHeaders($this->ownerA))->assertOk();

        $this->assertSame('ready', $order->refresh()->status, 'The shared order transitions to READY only once every restaurant item is ready.');
        $this->assertSame($this->riderA->id, $order->activeDelivery()?->rider_id, 'The shared trip stays bound to its accepted rider.');

        // 8. COD accounting is unified on the single order / shared trip.
        $this->assertSame('cash', $order->payment_method);
        $this->assertGreaterThan(0, (float) $order->total);
        $this->assertSame(1, BookingDispatchLog::count(), 'One shared trip, one dispatch offer.');
    }
}
