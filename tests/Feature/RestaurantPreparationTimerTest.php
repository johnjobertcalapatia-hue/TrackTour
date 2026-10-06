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
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use App\Services\PreparationStartService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Restaurant order redesign — automatic preparation lifecycle.
 *
 * Rules under test (restaurant order spec + AGENTS §4.2):
 *
 *   - the restaurant has NO accept/reject action: the retired endpoints are
 *     gone (404) and can never touch order or item state
 *   - rider acceptance performs waiting_restaurant → preparing and starts the
 *     countdown for delivery orders; pickup orders start with no rider at all
 *   - the countdown length = MAX(item preparation_time snapshot), never
 *     quantity-multiplied, immune to later menu edits
 *   - optional priority-tip reductions (off by default) shorten the timer per
 *     configured tier, and only the owning restaurant may configure them
 *   - PREPARING → READY fires automatically when the countdown is due, and
 *     only once, even across repeated scheduler runs
 *   - the minute scheduler is the self-healing backstop; an order with no
 *     rider waits indefinitely (the auto-reject command no longer exists)
 *   - offering preparation_time CRUD is validated (0–240 minutes)
 */
class RestaurantPreparationTimerTest extends TestCase
{
    use RefreshDatabase;

    private User $ownerA;
    private User $ownerB;
    private User $customer;
    private User $riderA;
    private Business $restaurantA;
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

        $this->riderA = $this->makeRider('rider-timer@example.com', 'Rider Timer', $this->restaurantA);

        // Faithful NearestRiderService mock (same shape as the acceptance-gate
        // suite): deterministic lowest-id offers, never re-offering a rider on
        // the same delivery.
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

    // ---------------------------------------------------------------- helpers

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

    private function makeOffering(int $prepMinutes, string $name = 'Burger'): Offering
    {
        return Offering::create([
            'business_id' => $this->restaurantA->id,
            'name' => $name, 'price' => 120.00,
            'is_available' => true, 'status' => 'available',
            'preparation_time' => $prepMinutes,
        ]);
    }

    /**
     * Single-restaurant COD delivery group checkout (one canonical order + one
     * shared delivery, offered to the nearest rider at creation).
     *
     * @param array<int, array{0: Offering, 1: int}> $items [offering, quantity]
     */
    private function createDeliveryOrder(array $items, float $riderTip = 0.0): Order
    {
        $group = $this->groupService->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55,
            'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash',
            'rider_tip' => $riderTip,
            'restaurants' => [
                [
                    'business_id' => $this->restaurantA->id,
                    'items' => array_map(
                        fn ($pair) => ['offering_id' => $pair[0]->id, 'quantity' => $pair[1]],
                        $items
                    ),
                ],
            ],
        ]);

        return $group->orders()->where('business_id', $this->restaurantA->id)->first();
    }

    /**
     * Directly-built standalone order (no group, no dispatch) — used for the
     * scheduler/timer scenarios that must not involve a rider acceptance.
     */
    private function createDirectOrder(string $name, string $status, ?\DateTimeInterface $predictedReadyAt = null, int $itemMinutes = 15): Order
    {
        $offering = $this->makeOffering($itemMinutes, $name);

        $order = Order::create([
            'order_number' => 'ORD-TIMER-'.strtoupper(uniqid()),
            'business_id' => $this->restaurantA->id,
            'user_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'customer_email' => $this->customer->email,
            'customer_phone' => '09170001122',
            'order_type' => 'pickup',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => $status,
            'subtotal' => 300.00,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => 300.00,
            'preparation_started_at' => $status === 'preparing' ? now()->subMinutes(20) : null,
            'predicted_ready_at' => $predictedReadyAt,
            'predicted_preparation_seconds' => $status === 'preparing' ? $itemMinutes * 60 : null,
            'preparation_time' => $status === 'preparing' ? $itemMinutes : null,
        ]);

        $order->items()->create([
            'offering_id' => $offering->id,
            'product_name' => $name,
            'quantity' => 1,
            'unit_price' => 300.00,
            'subtotal' => 300.00,
            'status' => $status === 'preparing' ? 'preparing' : 'pending',
            'preparation_time' => $itemMinutes,
        ]);

        return $order;
    }

    // ------------------------------------------------------------------ tests

    public function test_removed_restaurant_accept_and_reject_endpoints_do_not_exist(): void
    {
        $order = $this->createDeliveryOrder([[$this->makeOffering(15), 1]]);
        $item = $order->items->first();

        $this->postJson("/api/business-owner/orders/{$order->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertStatus(404);
        $this->postJson("/api/business-owner/orders/{$order->id}/reject", ['reason' => 'No stock'], $this->authHeaders($this->ownerA))
            ->assertStatus(404);
        $this->postJson("/api/business-owner/orders/{$order->id}/accept-all", [], $this->authHeaders($this->ownerA))
            ->assertStatus(404);
        $this->postJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/accept", [], $this->authHeaders($this->ownerA))
            ->assertStatus(404);
        $this->postJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/reject", ['reason' => 'No stock'], $this->authHeaders($this->ownerA))
            ->assertStatus(404);

        $order->refresh();
        $this->assertSame('waiting_restaurant', $order->status, 'Removed endpoints must leave the order untouched.');
        $this->assertSame('pending', $order->items->first()->status, 'Removed endpoints must leave item state untouched.');
        $this->assertNull($order->activeDelivery()->rider_id);
    }

    public function test_rider_acceptance_starts_preparation_and_countdown(): void
    {
        Event::fake([OrderStatusChanged::class]);

        $order = $this->createDeliveryOrder([[$this->makeOffering(12, 'Sisig'), 1]]);

        $this->assertSame('waiting_restaurant', $order->status);
        $this->assertNull($order->preparation_started_at, 'The timer never starts at order placement.');
        $this->assertNull($order->predicted_ready_at, 'Group orders carry no ready prediction before a rider accepts.');
        $this->assertSame(12, (int) $order->items->first()->preparation_time, 'Item snapshot written at order time.');

        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status, 'Rider acceptance performs waiting_restaurant → preparing.');
        $this->assertNotNull($order->preparation_started_at, 'Countdown started at rider acceptance.');
        $this->assertSame(12, (int) $order->preparation_time);
        $this->assertSame(12 * 60, (int) $order->predicted_preparation_seconds);

        $readyAt = Carbon::parse($order->predicted_ready_at);
        $this->assertTrue($readyAt->lte(now()->addMinutes(12)->addSeconds(5)), 'Ready time never exceeds the configured minutes.');
        $this->assertTrue($readyAt->gte(now()->addMinutes(12)->subSeconds(15)), 'Ready time ≈ now + 12 minutes.');

        $this->assertSame('pending', $order->payment_status, 'COD stays pending when preparation starts.');
        $this->assertSame('preparing', $order->items->first()->status, 'Items join the preparation.');

        $preparingEvents = Event::dispatched(OrderStatusChanged::class, fn (OrderStatusChanged $e) => $e->newStatus === 'preparing');
        $this->assertCount(1, $preparingEvents, 'Exactly one waiting → preparing transition is broadcast.');
    }

    public function test_timer_uses_max_item_snapshot_without_quantity_multiplication(): void
    {
        $quick = $this->makeOffering(10, 'French Fries');
        $slow = $this->makeOffering(25, 'Crispy Pata');

        $order = $this->createDeliveryOrder([[$quick, 3], [$slow, 1]]);

        $snapshotQuick = $order->items->firstWhere('offering_id', $quick->id);
        $snapshotSlow = $order->items->firstWhere('offering_id', $slow->id);
        $this->assertSame(10, (int) $snapshotQuick->preparation_time, 'Quantity never multiplies the item snapshot.');
        $this->assertSame(25, (int) $snapshotSlow->preparation_time);

        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertSame(25, (int) $order->preparation_time, 'Order timer = MAX of item preparation times.');
        $this->assertSame(25 * 60, (int) $order->predicted_preparation_seconds);
        $this->assertNotSame(30 * 60, (int) $order->predicted_preparation_seconds, 'Quantity (3× fries) must not scale the timer.');
        $this->assertNotSame(35 * 60, (int) $order->predicted_preparation_seconds, 'Sum of item times is not used either.');
    }

    public function test_later_menu_edits_do_not_change_in_flight_order_timer(): void
    {
        $offering = $this->makeOffering(20, 'Kare-Kare');

        $order = $this->createDeliveryOrder([[$offering, 1]]);
        $offering->update(['preparation_time' => 99]);
        $this->assertSame(99, (int) $offering->fresh()->preparation_time, 'Owner edited the menu mid-flight.');

        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertSame(20, (int) $order->preparation_time, 'In-flight timers keep the order-time snapshot.');
        $this->assertSame(20 * 60, (int) $order->predicted_preparation_seconds);
        $this->assertSame(20, (int) $order->items->first()->preparation_time, 'Item snapshot is immutable too.');
    }

    public function test_priority_reduction_is_off_by_default(): void
    {
        $this->getJson("/api/business-owner/restaurants/{$this->restaurantA->id}/preparation-settings", $this->authHeaders($this->ownerA))
            ->assertOk()
            ->assertJsonFragment(['priority_preparation_reduction_enabled' => false]);

        $order = $this->createDeliveryOrder([[$this->makeOffering(30, 'Bulalo'), 1]], riderTip: 100.00);

        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertSame(30, (int) $order->preparation_time, 'A ₱100 tip does NOT shorten prep until the restaurant opts in.');
        $this->assertSame(30 * 60, (int) $order->predicted_preparation_seconds);
    }

    public function test_priority_reduction_settings_shorten_the_timer_per_tier(): void
    {
        $settingsUrl = "/api/business-owner/restaurants/{$this->restaurantA->id}/settings/preparation";

        // Only the owning restaurant may configure priority reductions.
        $this->patchJson($settingsUrl, ['priority_preparation_reduction_enabled' => true], $this->authHeaders($this->ownerB))
            ->assertStatus(403);
        $this->getJson("/api/business-owner/restaurants/{$this->restaurantA->id}/preparation-settings", $this->authHeaders($this->ownerB))
            ->assertStatus(403);

        $this->patchJson($settingsUrl, [
            'priority_preparation_reduction_enabled' => true,
            'priority_reduction_minutes_25' => 2,
            'priority_reduction_minutes_50' => 5,
            'priority_reduction_minutes_100' => 10,
        ], $this->authHeaders($this->ownerA))
            ->assertOk()
            ->assertJsonFragment(['priority_reduction_minutes_100' => 10]);

        // Invalid tier configuration is rejected.
        $this->patchJson($settingsUrl, [
            'priority_preparation_reduction_enabled' => true,
            'priority_reduction_minutes_100' => 120,
        ], $this->authHeaders($this->ownerA))->assertStatus(422);

        // End-to-end through rider acceptance for the ₱100 tier: 30 − 10 = 20.
        $order = $this->createDeliveryOrder([[$this->makeOffering(30, 'Sinigang na Hipon'), 1]], riderTip: 100.00);
        $this->assertRiderAccepted($order->activeDelivery(), $this->riderA);

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertSame(20, (int) $order->preparation_time, 'The ₱100 tier removes the configured 10 minutes.');
        $this->assertSame(20 * 60, (int) $order->predicted_preparation_seconds);

        // Tier boundaries on the same base (item snapshot of 30 minutes).
        $service = app(PreparationStartService::class);

        $order->rider_tip = 50;
        $this->assertSame(25, $service->effectivePreparationMinutes($order), '₱50 tier removes 5 minutes.');

        $order->rider_tip = 25;
        $this->assertSame(28, $service->effectivePreparationMinutes($order), '₱25 tier removes 2 minutes.');

        $order->rider_tip = 0;
        $this->assertSame(30, $service->effectivePreparationMinutes($order), 'No tip → no reduction.');
    }

    public function test_due_countdown_auto_completes_and_pending_countdown_stays(): void
    {
        Event::fake([OrderStatusChanged::class]);

        $due = $this->createDirectOrder('Sinigang Due', 'preparing', now()->subMinute());
        $notDue = $this->createDirectOrder('Sinigang Pending', 'preparing', now()->addMinutes(10));

        $this->artisan('orders:advance-preparation')->assertExitCode(0);
        $this->artisan('orders:advance-preparation')->assertExitCode(0); // idempotent re-run

        $due->refresh();
        $this->assertSame('ready', $due->status, 'A countdown that reached 00:00 auto-completes PREPARING → READY.');
        $this->assertNotNull($due->food_ready_at);
        $this->assertSame('ready', $due->items->first()->status, 'Items are readied with the order.');
        $this->assertNotNull($due->items->first()->ready_at);

        $notDue->refresh();
        $this->assertSame('preparing', $notDue->status, 'A running countdown must never be completed early.');
        $this->assertSame('preparing', $notDue->items->first()->status);

        $readyEvents = Event::dispatched(OrderStatusChanged::class, fn (OrderStatusChanged $e) => $e->newStatus === 'ready');
        $this->assertCount(1, $readyEvents, 'Due timers fire exactly once, even across repeated scheduler runs.');
    }

    public function test_manual_start_preparing_arms_the_countdown(): void
    {
        $order = $this->createDirectOrder('Tochong Manok', 'accepted', null, itemMinutes: 15);

        $this->assertNull($order->preparation_started_at, 'An accepted order has no prep clock yet.');
        $this->assertNull($order->predicted_ready_at, 'No ready prediction before preparation starts.');

        // The Orders detail "Start Preparing" action calls PATCH /orders/{id}/status
        // with status=preparing. That manual transition must arm the same
        // countdown the rider-acceptance path arms, or "Time Remaining" shows "—".
        $this->patchJson(
            "/api/business-owner/orders/{$order->id}/status",
            ['status' => 'preparing'],
            $this->authHeaders($this->ownerA)
        )
            ->assertOk()
            ->assertJsonFragment(['preparation_time' => 15]);

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertNotNull($order->preparation_started_at, 'Manual start stamps the preparation start.');
        $this->assertNotNull($order->predicted_ready_at, 'Manual start arms the countdown deadline.');
        $this->assertSame(15 * 60, (int) $order->predicted_preparation_seconds);
        $this->assertSame(15, (int) $order->preparation_time, 'The snapshotted countdown length is exposed.');
    }

    public function test_pickup_starts_without_rider_while_riderless_delivery_order_waits(): void
    {
        $pickup = $this->createDirectOrder('Lechon Kawali Pickup', 'waiting_restaurant', null, itemMinutes: 18);
        $waitingDelivery = $this->createDeliveryOrder([[$this->makeOffering(15, 'Chicken Inasal'), 1]]);

        // Two scheduler runs: nothing may ever auto-cancel or auto-prepare the
        // rider-less delivery order ("never auto-cancel" by decision).
        $this->artisan('orders:advance-preparation')->assertExitCode(0);
        $this->artisan('orders:advance-preparation')->assertExitCode(0);

        $pickup->refresh();
        $this->assertSame('preparing', $pickup->status, 'Pickup preparation starts with no rider at all.');
        $this->assertNotNull($pickup->preparation_started_at, 'Pickup timer starts without a rider.');
        $this->assertNotNull($pickup->predicted_ready_at, 'Pickup countdown is armed immediately.');
        $this->assertSame(18 * 60, (int) $pickup->predicted_preparation_seconds, 'Pickup timer uses the item snapshot.');
        $this->assertSame('preparing', $pickup->items->first()->status);

        $waitingDelivery->refresh();
        $this->assertSame('waiting_restaurant', $waitingDelivery->status, 'No rider → the order waits indefinitely (never auto-cancelled, never auto-prepared).');
        $this->assertNull($waitingDelivery->preparation_started_at, 'Delivery timer must not start before a rider accepts.');
        $this->assertNull($waitingDelivery->predicted_ready_at);
        $this->assertSame('pending', $waitingDelivery->items->first()->status);
    }

    public function test_scheduler_promotes_stranded_rider_accepted_order(): void
    {
        $order = $this->createDeliveryOrder([[$this->makeOffering(10, 'Kare-Kare Strand'), 1]]);

        // Simulate a missed rider-acceptance hook: rider bound, order never
        // transitioned out of Finding Rider.
        $order->activeDelivery()->update([
            'rider_id' => $this->riderA->id,
            'status' => 'assigned',
            'assigned_at' => now(),
        ]);

        $this->assertSame('waiting_restaurant', $order->fresh()->status);

        $this->artisan('orders:advance-preparation')->assertExitCode(0);

        $order->refresh();
        $this->assertSame('preparing', $order->status, 'The minute scheduler is the self-healing backstop for the acceptance hook.');
        $this->assertNotNull($order->predicted_ready_at);
        $this->assertSame(10 * 60, (int) $order->predicted_preparation_seconds);
    }

    public function test_auto_reject_command_removed_and_minute_scheduler_registered(): void
    {
        $this->assertFalse(
            class_exists(\App\Console\Commands\AutoRejectWaitingOrder::class),
            'The 10-minute auto-reject was removed: orders without a rider wait indefinitely.'
        );

        $this->assertTrue(
            class_exists(\App\Console\Commands\AdvancePreparationOrders::class),
            'The automatic preparation lifecycle scheduler must exist.'
        );

        $this->artisan('orders:advance-preparation')->assertExitCode(0);
    }

    public function test_offering_preparation_time_is_validated_and_persisted(): void
    {
        $created = $this->postJson('/api/business-owner/offerings', [
            'name' => 'Sisig Special',
            'price' => 150,
            'status' => 'available',
            'preparation_time' => 30,
        ], $this->authHeaders($this->ownerA));
        $created->assertStatus(201);

        $offering = Offering::where('name', 'Sisig Special')->first();
        $this->assertNotNull($offering);
        $this->assertSame(30, (int) $offering->preparation_time);

        $this->putJson("/api/business-owner/offerings/{$offering->id}", [
            'name' => 'Sisig Special',
            'price' => 150,
            'status' => 'available',
            'preparation_time' => 45,
        ], $this->authHeaders($this->ownerA))->assertOk();
        $this->assertSame(45, (int) $offering->fresh()->preparation_time);

        // Validation bounds: 0–240 minutes.
        $this->putJson("/api/business-owner/offerings/{$offering->id}", [
            'name' => 'Sisig Special', 'price' => 150, 'status' => 'available',
            'preparation_time' => 999,
        ], $this->authHeaders($this->ownerA))->assertStatus(422);

        $this->putJson("/api/business-owner/offerings/{$offering->id}", [
            'name' => 'Sisig Special', 'price' => 150, 'status' => 'available',
            'preparation_time' => 'abc',
        ], $this->authHeaders($this->ownerA))->assertStatus(422);

        $this->postJson('/api/business-owner/offerings', [
            'name' => 'Invalid Dish',
            'price' => 50,
            'status' => 'available',
            'preparation_time' => -5,
        ], $this->authHeaders($this->ownerA))->assertStatus(422);

        // RBAC: another owner cannot edit the offering.
        $this->putJson("/api/business-owner/offerings/{$offering->id}", [
            'name' => 'Sisig Special', 'price' => 150, 'status' => 'available',
            'preparation_time' => 60,
        ], $this->authHeaders($this->ownerB))->assertStatus(403);

        $this->assertSame(45, (int) $offering->fresh()->preparation_time, 'Rejected requests leave the value untouched.');
    }
}
