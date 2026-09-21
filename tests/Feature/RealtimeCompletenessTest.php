<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\RiderCredit;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\Staff;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * P11.5 — Realtime Completeness.
 *
 * Laravel/MySQL remains the authoritative source of truth. The realtime
 * socket engine receives *canonical* status events through the authenticated
 * HTTP bridge (`/event`) plus terminal trip notifications (`/trip/cancel`,
 * `/trip/complete`). These tests fake the bridge and verify the exact room
 * lists Laravel routes to the engine:
 *
 *     business:{businessId}   restaurant / kitchen / POS
 *     user:{userId}           the tourist
 *     rider:{riderId}         the assigned rider
 *     trip:{deliveryId}       active live-tracking participants
 *
 * Coverage: dispatch of DeliveryAssigned on rider acceptance, order status
 * events at authoritative restaurant transitions, cancellation bridging,
 * duplicate acceptance no-ops, multi-restaurant/group-order isolation, and
 * socket-token authorization endpoints.
 */
class RealtimeCompletenessTest extends TestCase
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

        // Every realtime bridge POST is captured and answered — nothing may
        // leave this test suite over a real HTTP socket.
        Http::fake();

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

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro',
            'latitude' => 12.5, 'longitude' => 121.3,
        ]);

        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59']]
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

        $this->riderA = $this->makeRider('rider-a@example.com', 'Rider A', $this->restaurantA);
        $this->riderB = $this->makeRider('rider-b@example.com', 'Rider B', $this->restaurantB);

        // Faithful NearestRiderService mock: deterministic (lowest id first),
        // never re-offers to a rider already offered the delivery.
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

    /** All recorded bridge `/event` POSTs matching a predicate. */
    private function bridgeEvents(callable $predicate): Collection
    {
        return collect(Http::recorded())
            ->filter(fn ($pair) => str_ends_with((string) $pair[0]->url(), '/event'))
            ->filter(fn ($pair) => $predicate($pair[0]));
    }

    public function test_rider_acceptance_bridges_delivery_assigned_to_audience_rooms(): void
    {
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55,
            'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash',
            'rider_tip' => 0,
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1]]],
            ],
        ]);

        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $delivery = $group->fresh()->delivery;

        $this->assertRiderAccepted($delivery, $this->riderA);

        $this->assertTrue(
            $this->bridgeEvents(fn ($req) =>
                $req['eventName'] === 'delivery.assigned'
                && in_array('rider:'.$this->riderA->id, $req['rooms'], true)
                && in_array('trip:'.$delivery->id, $req['rooms'], true)
                && in_array('business:'.$this->restaurantA->id, $req['rooms'], true)
                && in_array('user:'.$this->customer->id, $req['rooms'], true)
                && $req['data']['order_id'] === $order->id
                && $req['data']['business_id'] === $this->restaurantA->id
                && $req['data']['user_id'] === $this->customer->id
                && $req['data']['rider_id'] === $this->riderA->id
                && $req['data']['trip'] === 'trip:'.$delivery->id,
            )->isNotEmpty(),
            'DeliveryAssigned must reach every audience room with the full payload.'
        );

        // The pre-existing authoritative assignment push (/trip/assign) still runs.
        Http::assertSent(fn (HttpRequest $req) =>
            str_ends_with((string) $req->url(), '/trip/assign')
            && $req['deliveryId'] === $delivery->id
            && $req['riderId'] === $this->riderA->id,
        );

        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id);
    }

    public function test_duplicate_acceptance_does_not_re_bridge_delivery_assigned(): void
    {
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55, 'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash', 'rider_tip' => 0,
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1]]],
            ],
        ]);

        $delivery = $group->fresh()->delivery;

        $this->assertRiderAccepted($delivery, $this->riderA);

        // Second accept by the same rider (already assigned) is a no-op.
        $second = $this->dispatchService()->handleRiderResponse($delivery->fresh()->id, $this->riderA->id, 'accepted');
        $this->assertFalse($second['success'] ?? true);

        $assignedCount = $this->bridgeEvents(fn ($req) =>
            $req['eventName'] === 'delivery.assigned'
            && in_array('trip:'.$delivery->id, $req['rooms'] ?? [], true),
        )->count();

        $this->assertSame(1, $assignedCount, 'Duplicate acceptance must not duplicate realtime events.');
    }

    public function test_restaurant_transitions_bridge_order_status_changed(): void
    {
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55, 'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash', 'rider_tip' => 0,
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1]]],
            ],
        ]);

        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $delivery = $group->fresh()->delivery;

        $this->assertRiderAccepted($delivery, $this->riderA);

        // Authoritative restaurant transition: accept → auto-starts preparing.
        $this->postJson("/api/business-owner/orders/{$order->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->assertSame('preparing', $order->fresh()->status);

        // Ready reaches the rider + kitchen so pickup can start without a refresh.
        $this->postJson("/api/business-owner/orders/{$order->id}/mark-ready", [], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->assertSame('ready', $order->fresh()->status);

        $statusEvents = $this->bridgeEvents(fn ($req) => $req['eventName'] === 'order.status.changed');

        $this->assertTrue(
            $statusEvents->contains(fn ($pair) =>
                $pair[0]['data']['order_id'] === $order->id
                && $pair[0]['data']['new_status'] === 'preparing'
                && in_array('business:'.$this->restaurantA->id, $pair[0]['rooms'], true)
                && in_array('user:'.$this->customer->id, $pair[0]['rooms'], true)
                && in_array('rider:'.$this->riderA->id, $pair[0]['rooms'], true)
                && in_array('trip:'.$delivery->id, $pair[0]['rooms'], true)
                && $pair[0]['data']['delivery_id'] === $delivery->id,
            ),
            'Preparing transition must reach business, user, rider and trip rooms.'
        );

        $this->assertTrue(
            $statusEvents->contains(fn ($pair) =>
                $pair[0]['data']['order_id'] === $order->id
                && $pair[0]['data']['new_status'] === 'ready',
            ),
            'Ready transition must be bridged.'
        );
    }

    public function test_group_order_rooms_stay_isolated_per_restaurant(): void
    {
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);
        $pizza = Offering::create(['business_id' => $this->restaurantB->id, 'name' => 'Pizza', 'price' => 350.00, 'is_available' => true, 'status' => 'available']);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55, 'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash', 'rider_tip' => 0,
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1]]],
                ['business_id' => $this->restaurantB->id, 'items' => [['offering_id' => $pizza->id, 'quantity' => 1]]],
            ],
        ]);

        $orderA = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $orderB = $group->orders()->where('business_id', $this->restaurantB->id)->first();
        $delivery = $group->fresh()->delivery;

        $this->assertRiderAccepted($delivery, $this->riderA);

        // Rider A's DeliveryAssigned (primary-order anchored) must NOT mention
        // Restaurant B or Rider B — business rooms stay per restaurant even
        // though the trip room is shared.
        $this->assertTrue(
            $this->bridgeEvents(fn ($req) =>
                $req['eventName'] === 'delivery.assigned'
                && in_array('trip:'.$delivery->id, $req['rooms'], true),
            )->every(fn ($pair) =>
                in_array('rider:'.$this->riderA->id, $pair[0]['rooms'], true)
                && in_array('business:'.$this->restaurantA->id, $pair[0]['rooms'], true)
                && ! in_array('business:'.$this->restaurantB->id, $pair[0]['rooms'], true)
                && ! in_array('rider:'.$this->riderB->id, $pair[0]['rooms'], true),
            ),
            'The assignment must be anchored on the primary restaurant audience only.'
        );

        // The single accepted rider gates BOTH restaurants on the shared trip —
        // each sub-order may proceed independently once the trip is claimed.
        $this->postJson("/api/business-owner/orders/{$orderA->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->postJson("/api/business-owner/orders/{$orderB->id}/accept", [], $this->authHeaders($this->ownerB))
            ->assertOk();

        // Room isolation on the fan-out status events: each restaurant order
        // reaches its OWN business room (never the sibling's), while sharing
        // the same trip room and assigned rider.
        $statusEvents = $this->bridgeEvents(fn ($req) => $req['eventName'] === 'order.status.changed');
        $this->assertTrue(
            $statusEvents->contains(fn ($pair) =>
                $pair[0]['data']['order_id'] === $orderB->id
                && in_array('business:'.$this->restaurantB->id, $pair[0]['rooms'], true)
                && ! in_array('business:'.$this->restaurantA->id, $pair[0]['rooms'], true)
                && in_array('trip:'.$delivery->id, $pair[0]['rooms'], true)
                && in_array('rider:'.$this->riderA->id, $pair[0]['rooms'], true),
            ),
            'Restaurant B status events must fan only to B\'s business room, on the shared trip.'
        );
        $this->assertTrue(
            $statusEvents->contains(fn ($pair) =>
                $pair[0]['data']['order_id'] === $orderA->id
                && in_array('business:'.$this->restaurantA->id, $pair[0]['rooms'], true)
                && ! in_array('business:'.$this->restaurantB->id, $pair[0]['rooms'], true),
            ),
            'Restaurant A status events must fan only to A\'s business room.'
        );
    }

    public function test_cancellation_bridges_trip_cancel_and_order_status(): void
    {
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55, 'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash', 'rider_tip' => 0,
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1]]],
            ],
        ]);

        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $delivery = $group->fresh()->delivery;

        $this->assertRiderAccepted($delivery, $this->riderA);

        // Canonical terminal-cancel path: the delivery must be evicted from the
        // socket engine's transient RAM state and the trip room notified.
        $this->dispatchService()->cancelDelivery($delivery->fresh());

        $this->assertSame('cancelled', $delivery->fresh()->status->value, 'Delivery row cancelled.');
        Http::assertSent(fn (HttpRequest $req) =>
            str_ends_with((string) $req->url(), '/trip/cancel')
            && $req['deliveryId'] === $delivery->id
            && $req['riderId'] === $this->riderA->id,
        );

        // A repeated cancel must be a harmless no-op (no second bridge POST).
        $this->dispatchService()->cancelDelivery($delivery->fresh());
        $cancels = collect(Http::recorded())
            ->filter(fn ($pair) => str_ends_with((string) $pair[0]->url(), '/trip/cancel'))
            ->count();
        $this->assertSame(1, $cancels, 'Duplicate cancellation must not re-bridge trip_cancelled.');
    }

    public function test_business_reject_cancels_delivery_and_dispatches_rejected_event(): void
    {
        $burger = Offering::create(['business_id' => $this->restaurantA->id, 'name' => 'Burger', 'price' => 120.00, 'is_available' => true, 'status' => 'available']);

        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55, 'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash', 'rider_tip' => 0,
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1]]],
            ],
        ]);

        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();

        $this->postJson("/api/business-owner/orders/{$order->id}/reject", ['reason' => 'Out of stock'], $this->authHeaders($this->ownerA))
            ->assertOk();
        $this->assertSame('rejected', $order->fresh()->status);
        $this->assertSame('cancelled', $order->fresh()->activeDelivery()?->status->value, 'Delivery cancelled alongside the rejection.');

        Http::assertSent(fn (HttpRequest $req) => str_ends_with((string) $req->url(), '/trip/cancel'));

        $this->assertTrue(
            $this->bridgeEvents(fn ($req) =>
                $req['eventName'] === 'order.status.changed'
                && $req['data']['order_id'] === $order->id
                && $req['data']['new_status'] === 'rejected'
                && in_array('business:'.$this->restaurantA->id, $req['rooms'], true)
                && in_array('user:'.$this->customer->id, $req['rooms'], true),
            )->count() === 1,
            'Rejection must bridge exactly one order.status.changed (rejected).'
        );
    }

    public function test_socket_room_tokens_are_authorized_per_role(): void
    {
        // Unauthenticated: no token at all.
        $this->getJson('/api/socket/user-token')
            ->assertStatus(401);
        $this->getJson('/api/business-owner/socket/token?business_id=1')
            ->assertStatus(401);

        // Tourist mints their own user:{id} room token.
        $userToken = $this->getJson('/api/socket/user-token', $this->authHeaders($this->customer))
            ->assertOk()
            ->json('data');
        $this->assertSame('user:'.$this->customer->id, $userToken['room']);
        $this->assertSame('user', $userToken['role']);
        $this->assertNotEmpty($userToken['token']);

        // Business token requires an explicit business_id.
        $this->getJson('/api/business-owner/socket/token', $this->authHeaders($this->ownerA))
            ->assertStatus(422);

        // Owner A can address their own business room.
        $businessToken = $this->getJson('/api/business-owner/socket/token?business_id='.$this->restaurantA->id, $this->authHeaders($this->ownerA))
            ->assertOk()
            ->json('data');
        $this->assertSame('business:'.$this->restaurantA->id, $businessToken['room']);
        $this->assertSame('merchant', $businessToken['role']);
        $this->assertNotEmpty($businessToken['token']);

        // Owner A cannot mint a token for Restaurant B (different owner).
        $this->getJson('/api/business-owner/socket/token?business_id='.$this->restaurantB->id, $this->authHeaders($this->ownerA))
            ->assertStatus(403);

        // A tourist cannot request a business room token at all.
        $this->getJson('/api/business-owner/socket/token?business_id='.$this->restaurantA->id, $this->authHeaders($this->customer))
            ->assertStatus(403);
    }
}