<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\GroupCheckout;
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
 * End-to-end lifecycle: grouped multi-restaurant order -> ONE shared physical
 * delivery -> single dispatch -> rider acceptance -> delivery complete.
 *
 * NearestRiderService is partially mocked because its nearest-rider SQL runs
 * ACOS/Having queries that SQLite cannot execute, but the real dispatch/accept
 * logic (BookingDispatchLog creation, handleRiderResponse, status transitions)
 * is exercised for real.
 */
class GroupedOrderDeliveryLifecycleTest extends TestCase
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
            'email' => 'owner-flow@example.com',
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
        ]);

        $this->riderA = $this->makeRider('ridera-flow@example.com', 'Rider A');
        $this->riderB = $this->makeRider('riderb-flow@example.com', 'Rider B');

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
            'rider_status' => 'online',
            'current_service' => 'food',
            'municipality_id' => $this->restaurantA->municipality_id,
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'online',
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

    private function makeOffering(Business $business, string $name, float $price): Offering
    {
        return Offering::create([
            'business_id' => $business->id,
            'name' => $name,
            'price' => $price,
            'is_available' => true,
            'status' => 'available',
        ]);
    }

    private function basePayload(array $restaurants): array
    {
        return [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'delivery_address' => '123 Test St',
            'payment_method' => 'gcash',
            'notes' => null,
            'restaurants' => $restaurants,
        ];
    }

    public function test_full_grouped_order_to_delivery_lifecycle(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 80.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);

        // ---- Step 1: customer places one order containing two restaurant groups ----
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => 'No onions'],
                ['offering_id' => $fries->id, 'quantity' => 1, 'notes' => null],
            ]],
            ['business_id' => $this->restaurantB->id, 'items' => [
                ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));

        $order = $group->orders()->sole()->load('items');
        $this->assertCount(1, $group->orders()->get(), 'Exactly one canonical order is created.');
        $this->assertCount(3, $order->items);
        $this->assertSame([$this->restaurantA->id, $this->restaurantA->id, $this->restaurantB->id], $order->items->pluck('business_id')->all());
        $this->assertSame((float) $order->subtotal, (float) $group->subtotal);
        $this->assertSame((float) $order->delivery_fee, (float) $group->delivery_total);

        // ---- Step 2: payment confirmed and one shared delivery is offered ----
        $order->update([
            'payment_status' => 'paid',
            'status' => 'waiting_restaurant',
            'acceptance_started_at' => now(),
            'acceptance_deadline' => now()->addMinutes(10),
        ]);

        app(\App\Services\SmartDispatchService::class)->scheduleGroupDispatch($group->fresh());

        $this->assertSame('waiting_restaurant', $order->fresh()->status);
        $delivery = $group->fresh()->delivery;
        $this->assertNotNull($delivery, 'The order owns exactly one delivery.');
        $this->assertSame($order->id, $delivery->order_id);
        $this->assertSame($group->id, $delivery->group_checkout_id);
        $this->assertSame('notified', $delivery->dispatch_status, 'Shared trip offered at confirmation.');
        $this->assertSame(1, BookingDispatchLog::count());
        $this->assertSame($this->riderA->id, BookingDispatchLog::where('delivery_id', $delivery->id)->first()->rider_id);

        // ---- Step 3: only the offered rider can claim the shared delivery ----
        $unoffered = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderB->id, 'accepted');
        $this->assertFalse($unoffered['success'] ?? true, 'A rider without an offer cannot claim the trip.');

        $result = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderA->id, 'accepted');
        $this->assertTrue($result['success'] ?? false);

        $delivery->refresh();
        $this->assertSame('assigned', $delivery->status->value);
        $this->assertSame($this->riderA->id, $delivery->rider_id);
        $this->assertNull($delivery->dispatch_status);
        $this->assertSame('busy', $this->riderA->fresh()->riderDetail->rider_status);
        $this->assertSame('online', $this->riderB->fresh()->riderDetail->rider_status, 'Rider B never claimed this trip.');

        // ---- Step 4: one accepted rider unlocks all restaurant item groups ----
        $this->acceptRestaurantOrder($order);
        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertSame($this->riderA->id, $order->activeDelivery()?->rider_id);

        // Restaurant A can be ready while Restaurant B is still preparing.
        $this->setItemStatus($order, 'Burger', 'ready');
        $this->setItemStatus($order, 'Fries', 'ready');
        $this->invokeRefreshOrderStatus($order);
        $this->assertSame('preparing', $order->fresh()->status);

        $this->setItemStatus($order, 'Pizza', 'ready');
        $this->invokeRefreshOrderStatus($order);
        $this->assertSame('ready', $order->fresh()->status);

        // ---- Step 5: one physical shared delivery remains bound to one rider ----
        $delivery = $order->fresh()->activeDelivery();
        $this->assertSame($this->riderA->id, $delivery->rider_id, 'The shared trip stays bound to its accepted rider.');
        $this->assertSame((float) $order->fresh()->delivery_fee, (float) $delivery->delivery_fee);

        // ---- Step 6: the single shared trip completes once ----
        $this->advanceDeliveryStatus($delivery, 'arrived_pickup');
        $this->advanceDeliveryStatus($delivery, 'picked_up');
        $this->advanceDeliveryStatus($delivery, 'in_transit');
        $this->advanceDeliveryStatus($delivery, 'arrived_destination');
        $this->advanceDeliveryStatus($delivery, 'delivered');

        $delivery->refresh();
        $this->assertSame('delivered', $delivery->status->value);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertSame('available', $this->riderA->fresh()->riderDetail->rider_status, 'Rider A freed after delivering.');

        $this->assertSame(1, Delivery::where('status', 'delivered')->count(),
            'Exactly one delivered trip for the whole group checkout.');
    }

    // ---------- helpers ----------

    private function acceptRestaurantOrder(Order $order): void
    {
        $predictedReadyAt = $order->predicted_preparation_seconds
            ? now()->addSeconds($order->predicted_preparation_seconds)
            : now()->addMinutes(15);

        $order->update([
            'status' => 'preparing',
            'accepted_at' => now(),
            'preparation_started_at' => now(),
            'predicted_ready_at' => $predictedReadyAt,
        ]);

        if ($order->order_type === 'delivery') {
            app(\App\Services\SmartDispatchService::class)->scheduleDispatch($order->fresh());
        }
    }

    private function setItemStatus(Order $order, string $productName, string $status): void
    {
        $item = $order->items->firstWhere('product_name', $productName);
        $this->assertNotNull($item, "Item {$productName} exists.");
        $item->update(['status' => $status]);
    }

    private function invokeRefreshOrderStatus(Order $order): void
    {
        $controller = app(\App\Http\Controllers\BusinessOwnerOrderController::class);
        $method = new \ReflectionMethod($controller, 'refreshOrderStatus');
        $method->setAccessible(true);
        $method->invoke($controller, $order);
    }

    private function dispatchService(): NearestRiderService
    {
        return $this->app->make(NearestRiderService::class);
    }

    private function advanceDeliveryStatus(Delivery $delivery, string $status): void
    {
        $timestamps = [
            'arrived_pickup' => 'arrived_pickup_at',
            'picked_up' => 'picked_up_at',
            'arrived_destination' => 'arrived_destination_at',
            'delivered' => 'delivered_at',
        ];
        $data = ['status' => $status];
        if (isset($timestamps[$status])) {
            $data[$timestamps[$status]] = now();
        }
        $delivery->update($data);

        if ($status === 'delivered') {
            $this->dispatchService()->completeDelivery($delivery);
            $rider = $delivery->rider;
            if ($rider) {
                $rider->riderDetail()?->updateOrCreate(
                    ['user_id' => $rider->id],
                    ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
                );
            }
        }
    }
}
