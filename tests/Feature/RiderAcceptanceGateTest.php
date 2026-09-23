<?php

namespace Tests\Feature;

use App\Events\OrderStatusChanged;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\Staff;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P11.2 — Rider-Acceptance Gate.
 *
 * The critical rule under test:
 *
 *     NO ACCEPTED RIDER  ⇒  NO PREPARATION
 *
 * A delivery order may only be prepared / marked ready once the delivery is
 * dispatched and a rider has ACCEPTED it. The restaurant has NO accept or
 * reject action anymore: rider acceptance itself performs
 * waiting_restaurant → preparing (with the countdown timer), and the timer
 * auto-completes to ready at 00:00. Every prep-reaching endpoint must reject
 * with 422 until rider acceptance, then stay authorized afterwards:
 *
 *     tourist places order → restaurant order created → rider offer
 *         → rider accepts → preparation starts automatically → ready
 *         → pickup → delivered
 *
 * Also covered: group orders resolve the gate through their single shared
 * delivery (never per-restaurant), permanent binding of a delivery to its
 * accepted rider, one-offer-per delivery (a rider can only claim a delivery
 * actually offered to them), reject/decline re-offer to the next eligible
 * rider, and no-rider-available blocking.
 */
class RiderAcceptanceGateTest extends TestCase
{
    use RefreshDatabase;

    private User $ownerA;
    private User $ownerB;
    private User $customer;
    private User $riderA;
    private User $riderB;
    private User $staffA;
    private Business $restaurantA;
    private Business $restaurantB;
    private GroupOrderService $groupService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->ownerA = User::create([
            'name' => 'Owner A', 'email' => 'owner-a@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner', 'account_status' => 'approved',
        ]);

        $this->ownerB = User::create([
            'name' => 'Owner B', 'email' => 'owner-b@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner', 'account_status' => 'approved',
        ]);

        $this->customer = User::create([
            'name' => 'John Tourist', 'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist', 'account_status' => 'approved',
        ]);

        $this->staffA = User::create([
            'name' => 'Staff A', 'email' => 'staff-a@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'staff', 'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro',
            'latitude' => 12.5, 'longitude' => 121.3,
        ]);

        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59'], ['open' => '23:59', 'close' => '00:00']]
        );

        $this->restaurantA = Business::create([
            'owner_id' => $this->ownerA->id, 'business_category_id' => $category->id,
            'municipality_id' => $municipality->id, 'business_name' => 'Restaurant A',
            'status' => 'approved', 'force_closed' => false, 'business_hours' => $allDays,
            'latitude' => 12.51, 'longitude' => 121.31,
        ]);

        $this->restaurantB = Business::create([
            'owner_id' => $this->ownerB->id, 'business_category_id' => $category->id,
            'municipality_id' => $municipality->id, 'business_name' => 'Restaurant B',
            'status' => 'approved', 'force_closed' => false, 'business_hours' => $allDays,
            'latitude' => 12.52, 'longitude' => 121.32,
        ]);

        Staff::create([
            'business_id' => $this->restaurantA->id,
            'user_id' => $this->staffA->id,
            'status' => 'active',
        ]);

        $this->riderA = $this->makeRider('rider-a@example.com', 'Rider A', $this->restaurantA);
        $this->riderB = $this->makeRider('rider-b@example.com', 'Rider B', $this->restaurantB);

        // Faithful NearestRiderService mock: determinstic (lowest id first),
        // but - like the real service - never re-offers a delivery to a rider
        // who was already offered it (UNIQUE (delivery_id, rider_id) backstop).
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
                    ->get()
                    ->each(fn ($u) => $u->setAttribute('distance_km', 1.0))
                    ->sortBy('id')
                    ->values();
            }

            public function dispatchToNearest(Delivery $delivery, string $serviceType = 'food', ?int $municipalityId = null): ?User
            {
                $alreadyOffered = BookingDispatchLog::where('delivery_id', $delivery->id)->pluck('rider_id');

                $rider = User::where('role', User::ROLE_RIDER)
                    ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
                    ->whereNotIn('id', $alreadyOffered)
                    ->whereHas('riderDetail', function ($q) use ($serviceType) {
                        $q->whereIn('rider_status', [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE])
                          ->where('current_service', $serviceType);
                    })
                    ->orderBy('id')
                    ->first();

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
            'name' => $name, 'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider', 'account_status' => 'approved',
            'rider_status' => 'available', 'current_service' => 'food',
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

    /**
     * Create a single-restaurant COD delivery order. The delivery is created
     * and offered to the nearest rider at waiting_restaurant (P11.2).
     */
    private function createOrder(): Order
    {
        $burger = Offering::create([
            'business_id' => $this->restaurantA->id,
            'name' => 'Burger', 'price' => 120.00,
            'is_available' => true, 'status' => 'available',
        ]);

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
                    ],
                ],
            ],
        ]);

        return $group->orders()->where('business_id', $this->restaurantA->id)->first();
    }

    /**
     * Create a single-restaurant COD delivery order with TWO pending items.
     * The delivery is created and offered to the nearest rider at
     * waiting_restaurant (P11.2).
     */
    private function createMultiItemOrder(): Order
    {
        $burger = Offering::create([
            'business_id' => $this->restaurantA->id,
            'name' => 'Burger', 'price' => 120.00,
            'is_available' => true, 'status' => 'available',
        ]);

        $fries = Offering::create([
            'business_id' => $this->restaurantA->id,
            'name' => 'Fries', 'price' => 80.00,
            'is_available' => true, 'status' => 'available',
        ]);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55,
            'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash',
            'restaurants' => [
                [
                    'business_id' => $this->restaurantA->id,
                    'items' => [
                        ['offering_id' => $burger->id, 'quantity' => 1],
                        ['offering_id' => $fries->id, 'quantity' => 1],
                    ],
                ],
            ],
        ]);

        return $group->orders()->where('business_id', $this->restaurantA->id)->first();
    }

    public function test_preparation_endpoints_are_blocked_until_rider_accepts_then_authorized(): void
    {
        $order = $this->createOrder();
        $item = $order->items->first();

        $this->assertNotNull($order->activeDelivery(), 'Delivery created at group creation.');
        $this->assertSame('notified', $order->activeDelivery()->dispatch_status, 'Rider offer pending.');
        $this->assertNull($order->activeDelivery()->rider_id, 'No rider accepted yet.');

        // No accepted rider → every prep-reaching endpoint returns 422.
        // (The restaurant accept/accept-all endpoints no longer exist at all —
        // they are covered as 404s in RestaurantPreparationTimerTest.)
        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->postJson("/api/business-owner/orders/{$order->id}/mark-ready", [], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'preparing'], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'ready'], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->patchJson("/api/business-owner/kitchen/orders/{$order->id}/status", ['status' => 'preparing'], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->patchJson("/api/business-owner/kitchen/orders/{$order->id}/items/{$item->id}/status", ['status' => 'preparing'], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->patchJson("/api/staff/orders/{$order->id}/status", ['status' => 'preparing'], $this->authHeaders($this->staffA))
            ->assertStatus(422);

        $this->assertSame('waiting_restaurant', $order->fresh()->status, 'Order untouched by blocked preparation attempts.');

        // Rider accepts → preparation starts automatically (no restaurant call).
        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);
        $this->assertSame('preparing', $order->fresh()->status, 'Rider acceptance auto-started preparation.');

        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->postJson("/api/business-owner/orders/{$order->id}/mark-ready", [], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'ready'], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->patchJson("/api/business-owner/kitchen/orders/{$order->id}/status", ['status' => 'preparing'], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->patchJson("/api/staff/orders/{$order->id}/status", ['status' => 'preparing'], $this->authHeaders($this->staffA))
            ->assertOk();
    }

    /**
     * The retired restaurant Accept flow used to be the only way an order
     * reached 'accepted' WITHOUT a rider. That path no longer exists: while
     * an order sits in 'Finding Rider' (waiting_restaurant) no manual status
     * update can move it toward preparation, and rider acceptance performs
     * the transition itself.
     */
    public function test_manual_status_paths_cannot_leave_finding_rider_without_a_rider(): void
    {
        $order = $this->createOrder();
        $item = $order->items->first();

        $this->patchJson("/api/business-owner/orders/{$order->id}/status", ['status' => 'accepted'], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->patchJson("/api/business-owner/orders/{$order->id}/status", ['status' => 'preparing'], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'preparing'], $this->authHeaders($this->ownerA))
            ->assertStatus(422);

        $this->assertSame('waiting_restaurant', $order->fresh()->status, 'Finding-Rider orders cannot be advanced manually.');
        $this->assertNull($order->fresh()->activeDelivery()->rider_id);

        // Rider acceptance performs the transition itself — no restaurant call.
        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);
        $this->assertSame('preparing', $order->fresh()->status, 'Rider acceptance auto-starts preparation.');
    }

    public function test_only_the_offered_rider_can_claim_a_delivery(): void
    {
        $order = $this->createOrder();
        $delivery = $order->activeDelivery();

        // Offer went to rider A; rider B has no pending offer → rejected.
        $result = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderB->id, 'accepted');
        $this->assertFalse($result['success'] ?? true, 'Rider without an offer cannot claim the delivery.');
        $this->assertNull($delivery->fresh()->rider_id);

        $this->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id], $this->authHeaders($this->riderB))
            ->assertStatus(409);

        // Rider A (offered) claims it exactly once.
        $this->assertRiderAccepted($delivery->fresh(), $this->riderA);
        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id);

        // Rider B attempts again after assignment → still rejected (conflict).
        $this->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id], $this->authHeaders($this->riderB))
            ->assertStatus(409);

        // A second accept attempt by the winning rider is a no-op (already assigned).
        $second = $this->dispatchService()->handleRiderResponse($delivery->fresh()->id, $this->riderA->id, 'accepted');
        $this->assertFalse($second['success'] ?? true);
    }

    /** One order with two restaurant item groups uses one shared delivery. */
    public function test_group_order_prep_gate_shares_one_delivery_and_stays_bound(): void
    {
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);
        $pizza = Offering::create(['business_id' => $this->restaurantB->id, 'name' => 'Pizza', 'price' => 350.00, 'is_available' => true, 'status' => 'available']);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55,
            'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash',
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1]]],
                ['business_id' => $this->restaurantB->id, 'items' => [['offering_id' => $pizza->id, 'quantity' => 1]]],
            ],
        ]);

        $order = $group->orders()->sole();

        // ONE physical delivery belongs to the canonical order.
        $delivery = $group->fresh()->delivery;
        $this->assertNotNull($delivery, 'The order owns exactly one delivery.');
        $this->assertSame($order->id, $delivery->order_id);
        $this->assertSame($group->id, $delivery->group_checkout_id);

        // Neither restaurant can prepare while the rider is still pending.
        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerB))
            ->assertStatus(422);

        // The single outstanding offer went to rider A (deterministic mock) —
        // rider B has no offer and cannot claim the shared trip (conflict).
        $this->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id], $this->authHeaders($this->riderB))
            ->assertStatus(409);

        // Rider A claims the shared trip: all restaurant item groups may now prepare.
        $this->assertRiderAccepted($delivery->fresh(), $this->riderA);

        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->assertSame('preparing', $order->fresh()->status);

        // The shared delivery stays permanently bound to its accepted rider.
        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id);

        // Rider B still cannot claim a trip already claimed by rider A (conflict).
        $this->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id], $this->authHeaders($this->riderB))
            ->assertStatus(409);

        // Every item group resolves through the same accepted rider.
        $this->assertSame($this->riderA->id, $order->fresh()->activeDelivery()?->rider_id);
        $this->assertTrue($order->fresh()->hasAcceptedRider());
    }

    public function test_rider_decline_reoffers_delivery_to_next_eligible_rider(): void
    {
        $order = $this->createOrder();
        $delivery = $order->activeDelivery();

        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertNotNull(
            BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $this->riderA->id)->where('response', 'pending')->exists(),
            'Rider A holds the initial pending offer.'
        );

        // Rider A rejects; the delivery is re-offered to the next eligible rider.
        $declined = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderA->id, 'declined');
        $this->assertTrue($declined['success'] ?? false, 'Decline accepted by the system.');

        $declinedLog = BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $this->riderA->id)->first();
        $this->assertSame('declined', $declinedLog->response, 'Original offer recorded as declined.');

        $offerB = BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $this->riderB->id)->first();
        $this->assertNotNull($offerB, 'Delivery re-offered to rider B.');
        $this->assertSame('pending', $offerB->response);
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $this->riderA->id)->count(), 'No duplicate offer to rider A (UNIQUE delivery/rider backstop).');
        $this->assertSame('notified', $delivery->fresh()->dispatch_status);

        // Still no accepted rider → preparation stays blocked.
        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerA))
            ->assertStatus(422);

        // Rider B accepts; the restaurant becomes authorized.
        $this->assertRiderAccepted($delivery->fresh(), $this->riderB);
        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerA))
            ->assertOk();
    }

    public function test_no_rider_available_keeps_preparation_blocked(): void
    {
        $order = $this->createOrder();
        $delivery = $order->activeDelivery();

        // Simulate all riders exhausted / offline: the delivery is unreserved.
        $delivery->update(['dispatch_status' => 'no_rider_available']);

        $this->assertNull($delivery->fresh()->rider_id);
        $this->postJson("/api/business-owner/orders/{$order->id}/start-preparation", [], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        $this->postJson("/api/business-owner/orders/{$order->id}/mark-ready", [], $this->authHeaders($this->ownerA))
            ->assertStatus(422);
        // The retired accept-all endpoint is gone entirely — 404, not 422.
        // It cannot touch order state, so the gate above (start-preparation
        // / mark-ready → 422) is what actually keeps preparation blocked.
        $this->postJson("/api/business-owner/orders/{$order->id}/accept-all", [], $this->authHeaders($this->ownerA))
            ->assertStatus(404);

        $this->assertSame('waiting_restaurant', $order->fresh()->status, 'Restaurant remains unable to prepare.');
    }

    /**
     * Regression (updated for the restaurant order redesign): the old
     * item-accept endpoint could flip a multi-item delivery order into
     * 'preparing' with NO accepted rider via Order::refreshStatusFromItems
     * rule 3 (sibling item still 'pending'). The endpoint no longer exists —
     * it returns 404 and cannot touch item or order state at all — so the
     * premature-preparing defect it guarded is now structurally impossible.
     */
    public function test_removed_item_accept_endpoint_never_causes_preparing(): void
    {
        Event::fake([OrderStatusChanged::class]);

        $order = $this->createMultiItemOrder();
        $item1 = $order->items->first();
        $item2 = $order->items->last();

        $this->assertCount(2, $order->items, 'Seed data: exactly two pending items.');
        $this->assertSame('waiting_restaurant', $order->status);
        $this->assertNull($order->activeDelivery()->rider_id, 'No rider accepted yet.');

        // Listener contract for OrderStatusChanged: an event fake also
        // disables the bridge/notifier listeners — irrelevant to this test.
        $this->postJson("/api/business-owner/orders/{$order->id}/items/{$item1->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertStatus(404);

        Event::assertNotDispatched(OrderStatusChanged::class, function (OrderStatusChanged $event) {
            return $event->newStatus === 'preparing';
        });

        $item1->refresh();
        $item2->refresh();
        $this->assertSame('pending', $item1->status, 'Removed endpoint cannot touch item state.');
        $this->assertSame('pending', $item2->status, 'Sibling item stays pending.');

        $order->refresh();
        $this->assertNotSame('preparing', $order->status, 'Order must never enter preparing without an accepted rider.');
        $this->assertSame('waiting_restaurant', $order->status);
        $this->assertNull($order->activeDelivery()->rider_id);
    }

    /**
     * Regression (updated for the restaurant order redesign): the old
     * item-reject endpoint (per-dish out-of-stock refund flow) must never
     * flip the order to 'preparing'. The endpoint was removed with the
     * accept/reject retirement — it now returns 404 and cannot touch item
     * or order state in any order status.
     */
    public function test_removed_item_reject_endpoint_never_causes_preparing(): void
    {
        Event::fake([OrderStatusChanged::class]);

        $order = $this->createMultiItemOrder();
        $item1 = $order->items->first();
        $item2 = $order->items->last();

        $this->assertNull($order->activeDelivery()->rider_id, 'No rider accepted yet.');
        $this->assertSame('pending', $item1->status);
        $this->assertSame('pending', $item2->status);

        $this->postJson(
            "/api/business-owner/orders/{$order->id}/items/{$item1->id}/reject",
            ['reason' => 'Item unavailable'],
            $this->authHeaders($this->ownerA)
        )->assertStatus(404);

        Event::assertNotDispatched(OrderStatusChanged::class, function (OrderStatusChanged $event) {
            return $event->newStatus === 'preparing';
        });

        $item1->refresh();
        $item2->refresh();
        $this->assertSame('pending', $item1->status, 'Removed endpoint cannot touch item state.');
        $this->assertSame('pending', $item2->status, 'Sibling item stays pending.');

        $order->refresh();
        $this->assertSame('waiting_restaurant', $order->status, 'Rejection can never cause a preparing transition.');
        $this->assertNull($order->activeDelivery()->rider_id);
    }

    /**
     * Sanity: once a rider HAS accepted, preparation is already running and
     * the remaining per-item workflow (mark ready) proceeds normally on top
     * of it — one item ready keeps the order preparing, all items ready
     * completes it.
     */
    public function test_multi_item_workflow_proceeds_after_rider_acceptance(): void
    {
        $order = $this->createMultiItemOrder();
        $item1 = $order->items->first();
        $item2 = $order->items->last();

        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status, 'Rider acceptance auto-started preparation.');
        $this->assertSame('preparing', $order->items->firstWhere('id', $item1->id)->status);
        $this->assertSame('preparing', $order->items->firstWhere('id', $item2->id)->status);

        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$item1->id}/status", ['status' => 'ready'], $this->authHeaders($this->ownerA))
            ->assertOk();

        $order->refresh();
        $this->assertSame('preparing', $order->status, 'Sibling item is still cooking.');
        $this->assertTrue($order->hasAcceptedRider(), 'Rider remains bound to the delivery.');
        $this->assertNotSame('cancelled', $order->status);

        $this->patchJson("/api/business-owner/orders/{$order->id}/items/{$item2->id}/status", ['status' => 'ready'], $this->authHeaders($this->ownerA))
            ->assertOk();

        $this->assertSame('ready', $order->refresh()->status, 'All items ready completes the order.');
    }

    /**
     * Restaurant-order redesign regression: rider acceptance is the ONLY
     * event that may perform waiting_restaurant → preparing, and it performs
     * it exactly once. (The removed item-accept endpoint could previously
     * reach order states through partial item acceptance.)
     */
    public function test_rider_acceptance_is_the_single_trigger_for_the_preparing_transition(): void
    {
        Event::fake([OrderStatusChanged::class]);

        $order = $this->createMultiItemOrder();
        $item1 = $order->items->first();
        $item2 = $order->items->last();

        $this->assertNull($order->activeDelivery()->rider_id, 'No rider accepted yet.');
        $this->assertSame('waiting_restaurant', $order->status);

        // Nothing may start preparation before the rider accepts.
        $this->postJson("/api/business-owner/orders/{$order->id}/items/{$item1->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertStatus(404);
        Event::assertNotDispatched(OrderStatusChanged::class, fn (OrderStatusChanged $event) => $event->newStatus === 'preparing');

        // Rider accepts → exactly ONE waiting → preparing transition.
        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $preparingEvents = Event::dispatched(
            OrderStatusChanged::class,
            fn (OrderStatusChanged $event) => $event->newStatus === 'preparing'
        );
        $this->assertCount(1, $preparingEvents, 'Rider acceptance performs the single preparing transition.');

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertSame('preparing', $order->items->firstWhere('id', $item1->id)->status, 'Item workflow starts with preparation.');
        $this->assertSame('preparing', $order->items->firstWhere('id', $item2->id)->status);
    }

    // test_multi_item_reject_with_accepted_rider_never_causes_preparing was
    // retired with the restaurant order redesign: the item-reject endpoint no
    // longer exists (404 — see test_removed_item_reject_endpoint_never_causes_
    // preparing), and with rider acceptance auto-starting preparation the
    // 'reject keeps waiting_restaurant' scenario cannot be constructed anymore.

    /**
     * P11.6 invariant carried onto the new canonical path: starting
     * preparation (now triggered by rider acceptance) must NOT stamp
     * payment_status='paid'. COD is paid only when the rider settles the
     * cash at delivery; 'paid' requires an actually-captured online payment.
     * (The former acceptAll variant was retired with the accept-all
     * endpoint — this single canonical path now covers both.)
     */
    public function test_rider_acceptance_starting_preparation_keeps_cod_payment_pending(): void
    {
        $order = $this->createMultiItemOrder();

        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status, 'Rider acceptance auto-started preparation.');
        $this->assertSame('pending', $order->payment_status, 'COD order is not paid just because preparation started.');
    }

    /**
     * P11.6 positive control: when an AUTHORIZED online payment exists, the
     * preparation-start path (now triggered by rider acceptance) captures it
     * ('paid') exactly like the removed accept endpoints did — the
     * payment_status conditioning must not break the prepaid flow.
     */
    public function test_prepaid_rider_acceptance_captures_authorized_payment(): void
    {
        $order = $this->createMultiItemOrder();

        $payment = Payment::create([
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $order->user_id,
            'payment_number' => 'PAY-'.Str::upper(Str::random(10)),
            'amount' => $order->total,
            'currency' => 'PHP',
            'method' => 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'pm_'.Str::random(20),
            'status' => 'authorized',
        ]);

        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status, 'Rider acceptance auto-started preparation.');
        $this->assertSame('paid', $order->payment_status, 'Prepaid order becomes paid when preparation starts.');
        $this->assertSame('paid', $payment->fresh()->status, 'The authorized payment row is captured.');
    }
}