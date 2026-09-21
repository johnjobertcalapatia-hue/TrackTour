<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodSettlement;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderCredit;
use App\Models\RiderCreditTransaction;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * COD (cash-on-delivery) lifecycle under the credit-free, one-delivery-per-group
 * model (steps 3–5): the group checkout owns ONE physical delivery with ONE
 * rider; cash due is frozen at accept; the wallet is never reserved or deducted;
 * settlement books a per-restaurant split, cash payments and split earnings on
 * the single shared trip.
 *
 * NearestRiderService is partially mocked (nearest-rider SQL is SQLite-unsafe)
 * while the real dispatch/accept/settle logic runs.
 */
class CodDeliverySettlementTest extends TestCase
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
            'email' => 'owner-cod@example.com',
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
            [['open' => '00:00', 'close' => '23:59']]
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

        $this->riderA = $this->makeRider('ridera-cod@example.com', 'Rider A');
        $this->riderB = $this->makeRider('riderb-cod@example.com', 'Rider B');

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

        // Fund the wallet: 10,000 total with a 200 protected reserve.
        RiderCredit::create([
            'rider_id' => $rider->id,
            'total_credits' => 10000,
            'reserved_credits' => 0,
            'minimum_reserve' => 200,
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
            'payment_method' => 'cash',
            'rider_tip' => 40.00,
            'notes' => null,
            'restaurants' => $restaurants,
        ];
    }

    public function test_cod_shared_trip_lifecycle_and_cash_settlement(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 80.00);
        $coke = $this->makeOffering($this->restaurantA, 'Coke', 50.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);
        $pasta = $this->makeOffering($this->restaurantB, 'Pasta', 250.00);

        // ---- Step 1: customer places a 2-restaurant COD group order ----
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
                ['offering_id' => $fries->id, 'quantity' => 1, 'notes' => null],
                ['offering_id' => $coke->id, 'quantity' => 1, 'notes' => null],
            ]],
            ['business_id' => $this->restaurantB->id, 'items' => [
                ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
                ['offering_id' => $pasta->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));

        $orderA = $group->orders()->where('business_id', $this->restaurantA->id)->first()->load('items');
        $orderB = $group->orders()->where('business_id', $this->restaurantB->id)->first()->load('items');

        $this->assertSame('cash', $orderA->payment_method);
        $this->assertSame('pending', $orderA->payment_status, 'COD order unpaid until cash collected.');

        // ---- Step 2: ONE shared physical delivery, dispatched at creation ----
        $delivery = $group->fresh()->delivery;
        $this->assertNotNull($delivery, 'The group owns exactly one physical delivery.');
        $this->assertNull($delivery->order_id, 'Group delivery is not bound to a single restaurant order.');
        $this->assertSame($group->id, $delivery->group_checkout_id);
        $this->assertNull($orderA->fresh()->delivery, 'Order A has no per-restaurant delivery.');
        $this->assertNull($orderB->fresh()->delivery, 'Order B has no per-restaurant delivery.');

        $dispatchLog = BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('response', 'pending')->first();
        $this->assertNotNull($dispatchLog);
        $this->assertSame($this->riderA->id, $dispatchLog->rider_id, 'Nearest rider offered at group creation.');

        // ---- Step 3: both restaurants accept & prepare independently ----
        foreach ([$orderA, $orderB] as $order) {
            $this->acceptRestaurantOrder($order);
        }

        $orderA->refresh();
        $orderB->refresh();

        $this->assertSame('preparing', $orderA->status);
        $this->assertSame('preparing', $orderB->status);

        // ---- Step 4: rider A accepts the single trip -> credit-free cash due freeze ----
        $result = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderA->id, 'accepted');
        $this->assertTrue($result['success'] ?? false, 'Rider A accepts the shared trip.');

        $delivery->refresh();
        $this->assertSame('assigned', $delivery->status->value);
        $this->assertSame($this->riderA->id, $delivery->rider_id);
        $this->assertEquals((float) $group->grand_total, (float) $delivery->cash_due, 'cash_due = group grand total (cash on hand).');
        $this->assertEquals(0.0, (float) $delivery->cod_credit_reserved, 'No credit reserve (credit-free COD).');
        $this->assertSame('busy', $this->riderA->fresh()->riderDetail->rider_status);
        $this->assertEquals(0.0, (float) $this->riderA->fresh()->riderCredit->reserved_credits, 'Wallet never reserved.');
        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $this->riderA->id)->count(), 'No wallet ledger writes.');

        // ---- Step 5: both restaurants mark ready independently ----
        $this->setItemStatus($orderB, 'Pizza', 'ready');
        $this->setItemStatus($orderB, 'Pasta', 'ready');
        $this->invokeRefreshOrderStatus($orderB);
        $orderB->refresh();
        $this->assertSame('ready', $orderB->status);

        $this->setItemStatus($orderA, 'Burger', 'ready');
        $this->setItemStatus($orderA, 'Fries', 'ready');
        $this->setItemStatus($orderA, 'Coke', 'ready');
        $this->invokeRefreshOrderStatus($orderA);
        $orderA->refresh();
        $this->assertSame('ready', $orderA->status);

        $this->assertEquals(1, BookingDispatchLog::where('delivery_id', $delivery->id)->count(), 'One shared trip, one dispatch offer.');

        // ---- Step 6: settlement guards ----
        // Not yet delivered -> cannot settle.
        try {
            $this->dispatchService()->settleCodDelivery($delivery->fresh(), (float) $delivery->cash_due);
            $this->fail('Settlement of a non-delivered delivery should throw.');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('delivered', $e->getMessage());
        }

        // ---- Step 7: one trip to the drop-off ----
        $this->advanceDeliveryStatus($delivery->fresh(), 'arrived_pickup');
        $this->advanceDeliveryStatus($delivery->fresh(), 'picked_up');
        $this->advanceDeliveryStatus($delivery->fresh(), 'in_transit');
        $this->advanceDeliveryStatus($delivery->fresh(), 'arrived_destination');

        $delivery->update(['status' => 'delivered', 'delivered_at' => now()]);
        $this->dispatchService()->markCodDelivered($delivery->fresh());

        $delivery->refresh();
        $this->assertSame('delivered', $delivery->status->value);
        $this->assertSame('busy', $this->riderA->fresh()->riderDetail->rider_status, 'Rider stays busy until cash is collected.');

        // Short cash -> rejected, nothing booked.
        try {
            $this->dispatchService()->settleCodDelivery($delivery->fresh(), (float) $delivery->cash_due - 1);
            $this->fail('Short cash must be rejected.');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('less than', $e->getMessage());
        }
        $this->assertSame(0, CodSettlement::count());

        // ---- Step 8: exact-cash settlement completes BOTH orders ----
        $cashDue = (float) $delivery->cash_due;
        $result = $this->dispatchService()->settleCodDelivery($delivery->fresh(), $cashDue);
        $this->assertTrue($result['success']);
        $this->assertEquals($cashDue, $result['cash_due']);
        $this->assertEquals($cashDue, $result['cash_received']);
        $this->assertEquals(0.0, $result['change_given']);

        $delivery->refresh();
        $orderA->refresh();
        $orderB->refresh();

        $this->assertSame('completed', $delivery->status->value);
        $this->assertNotNull($delivery->cash_settled_at);
        $this->assertEquals(0.0, (float) $delivery->cod_credit_reserved);

        $this->assertSame('paid', $orderA->payment_status);
        $this->assertSame('paid', $orderB->payment_status);
        $this->assertEquals((float) $orderA->total, (float) $orderA->paid_amount);
        $this->assertEquals((float) $orderB->total, (float) $orderB->paid_amount);
        $this->assertNotNull($orderA->completed_at);
        $this->assertNotNull($orderB->completed_at);

        // One cod_settlement row per restaurant on the shared trip.
        $settlementA = CodSettlement::where('order_id', $orderA->id)->first();
        $settlementB = CodSettlement::where('order_id', $orderB->id)->first();
        $this->assertNotNull($settlementA);
        $this->assertNotNull($settlementB);
        $this->assertNotSame($settlementA->id, $settlementB->id);
        $this->assertSame($delivery->id, $settlementA->delivery_id);
        $this->assertSame($delivery->id, $settlementB->delivery_id);
        $this->assertEquals(round((float) $orderA->rider_financed_amount, 2), (float) $settlementA->settlement_base);
        $this->assertEquals(round((float) $orderB->rider_financed_amount, 2), (float) $settlementB->settlement_base);

        // One cash payment per restaurant order.
        $paymentA = Payment::where('payable_type', Order::class)->where('payable_id', $orderA->id)
            ->where('method', 'cash')->where('status', 'paid')->first();
        $paymentB = Payment::where('payable_type', Order::class)->where('payable_id', $orderB->id)
            ->where('method', 'cash')->where('status', 'paid')->first();
        $this->assertNotNull($paymentA);
        $this->assertNotNull($paymentB);
        $this->assertEquals((float) $orderA->total, (float) $paymentA->amount);
        $this->assertEquals((float) $orderB->total, (float) $paymentB->amount);

        // Trip commission (40) split across the two restaurant orders; tip shared.
        $earningA = RiderEarning::where('rider_id', $this->riderA->id)->where('order_id', $orderA->id)->first();
        $earningB = RiderEarning::where('rider_id', $this->riderA->id)->where('order_id', $orderB->id)->first();
        $this->assertNotNull($earningA);
        $this->assertNotNull($earningB);
        $this->assertSame('earned', $earningA->status);
        $this->assertSame('earned', $earningB->status);
        $this->assertEquals(round((40.00 / 2) + (float) $orderA->rider_tip, 2), (float) $earningA->total_earning);
        $this->assertEquals(round((40.00 / 2) + (float) $orderB->rider_tip, 2), (float) $earningB->total_earning);

        // ---- Step 9: overpayment on a second COD trip (change returned) ----
        $group2 = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $coke->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order2 = $group2->orders()->where('business_id', $this->restaurantA->id)->first();

        $delivery2 = $group2->fresh()->delivery;
        $result2 = $this->dispatchService()->handleRiderResponse($delivery2->id, $this->riderA->id, 'accepted');
        $this->assertTrue($result2['success'] ?? false, 'Rider A is free after settlement and accepts the next trip.');

        $cashDue2 = (float) $delivery2->fresh()->cash_due;
        $this->advanceDeliveryToDelivered($delivery2);

        $result2 = $this->dispatchService()->settleCodDelivery($delivery2->fresh(), $cashDue2 + 500.00);
        $this->assertTrue($result2['success']);
        $this->assertEquals(500.00, $result2['change_given'], 'Change computed server-side.');

        $delivery2->refresh();
        $order2->refresh();
        $this->assertSame('completed', $delivery2->status->value);
        $this->assertEquals(500.00, (float) $delivery2->change_given);
        $this->assertEquals($cashDue2, (float) $delivery2->cash_due, 'cash_due immutable after settlement.');

        $this->assertSame('paid', $order2->payment_status);

        // Rider free again; the wallet was never involved end-to-end.
        $this->assertSame('available', $this->riderA->fresh()->riderDetail->rider_status);
        $this->assertEquals(10000.00, (float) $this->riderA->fresh()->riderCredit->total_credits, 'Wallet untouched.');
        $this->assertEquals(0.0, (float) $this->riderA->fresh()->riderCredit->reserved_credits);
        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $this->riderA->id)->count(), 'Zero wallet ledger writes in the credit-free model.');
        $this->assertSame(3, CodSettlement::count(), 'A + B + order2 settlements.');

        $this->assertSame(2, Delivery::where('status', 'completed')->count());
    }

    public function test_cod_settlement_completes_delivery_and_books_payment_and_earnings(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);

        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
            ['business_id' => $this->restaurantB->id, 'items' => [
                ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));

        $orderA = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $orderB = $group->orders()->where('business_id', $this->restaurantB->id)->first();

        foreach ([$orderA, $orderB] as $order) {
            $this->acceptRestaurantOrder($order);
        }

        // ONE shared delivery, ONE rider for both restaurants.
        $delivery = $group->fresh()->delivery;
        $result = $this->dispatchService()->handleRiderResponse($delivery->id, $this->riderA->id, 'accepted');
        $this->assertTrue($result['success'] ?? false, 'Rider A accepts the shared trip.');

        $delivery->refresh();
        $this->assertSame($this->riderA->id, $delivery->rider_id);
        $cashDue = (float) $delivery->cash_due;
        $this->assertEquals((float) $group->grand_total, $cashDue, 'cash_due = group grand total.');

        // Both restaurants mark ready.
        $this->setItemStatus($orderA, 'Burger', 'ready');
        $this->invokeRefreshOrderStatus($orderA);
        $orderA->refresh();
        $this->assertSame('ready', $orderA->status);

        $this->setItemStatus($orderB->fresh(), 'Pizza', 'ready');
        $this->invokeRefreshOrderStatus($orderB->fresh());
        $orderB->refresh();
        $this->assertSame('ready', $orderB->status);

        $this->advanceDeliveryToDelivered($delivery);
        $this->assertSame('busy', $this->riderA->fresh()->riderDetail->rider_status);

        // ---- Exact-cash settlement books payment + per-restaurant settlement + split earnings ----
        $result = $this->dispatchService()->settleCodDelivery($delivery->fresh(), $cashDue);

        $this->assertTrue($result['success']);
        $this->assertEquals($cashDue, $result['cash_due']);
        $this->assertEquals($cashDue, $result['cash_received']);
        $this->assertEquals(0.0, $result['change_given']);

        $delivery->refresh();
        $orderA->refresh();
        $orderB->refresh();

        $this->assertSame('completed', $delivery->status->value);
        $this->assertEquals($cashDue, (float) $delivery->cash_received);
        $this->assertEquals(0.0, (float) $delivery->change_given);
        $this->assertNotNull($delivery->cash_settled_at);
        $this->assertEquals(0.0, (float) $delivery->cod_credit_reserved);

        $this->assertSame('paid', $orderA->payment_status);
        $this->assertSame('paid', $orderB->payment_status);
        $this->assertEquals((float) $orderA->total, (float) $orderA->paid_amount);
        $this->assertEquals((float) $orderB->total, (float) $orderB->paid_amount);
        $this->assertNotNull($orderA->completed_at);
        $this->assertNotNull($orderB->completed_at);

        $paymentA = Payment::where('payable_type', Order::class)->where('payable_id', $orderA->id)
            ->where('method', 'cash')->where('status', 'paid')->first();
        $paymentB = Payment::where('payable_type', Order::class)->where('payable_id', $orderB->id)
            ->where('method', 'cash')->where('status', 'paid')->first();
        $this->assertNotNull($paymentA, 'Cash Payment row created for A.');
        $this->assertNotNull($paymentB, 'Cash Payment row created for B.');
        $this->assertEquals((float) $orderA->total, (float) $paymentA->amount);
        $this->assertEquals((float) $orderB->total, (float) $paymentB->amount);

        $settlementA = CodSettlement::where('order_id', $orderA->id)->first();
        $settlementB = CodSettlement::where('order_id', $orderB->id)->first();
        $this->assertNotNull($settlementA);
        $this->assertNotNull($settlementB);
        $this->assertSame($delivery->id, $settlementA->delivery_id);
        $this->assertSame($delivery->id, $settlementB->delivery_id);

        // Earnings recorded per restaurant at settlement; commission split evenly.
        $earningA = RiderEarning::where('rider_id', $this->riderA->id)->where('order_id', $orderA->id)->first();
        $earningB = RiderEarning::where('rider_id', $this->riderA->id)->where('order_id', $orderB->id)->first();
        $this->assertNotNull($earningA, 'Rider earning recorded at settlement.');
        $this->assertNotNull($earningB, 'Rider earning recorded at settlement.');
        $this->assertSame('earned', $earningA->status);
        $this->assertSame('earned', $earningB->status);
        $this->assertEquals(round((40.00 / 2) + (float) $orderA->rider_tip, 2), (float) $earningA->total_earning);
        $this->assertEquals(round((40.00 / 2) + (float) $orderB->rider_tip, 2), (float) $earningB->total_earning);

        // --- Wallet never involved (credit-free COD) ---
        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $this->riderA->id)->count(), 'No wallet ledger writes.');
        $this->assertSame(0, RiderCreditTransaction::count(), 'No rider-credit transactions at all.');

        $this->assertSame('available', $this->riderA->fresh()->riderDetail->rider_status);
        $this->assertEquals(0.0, (float) $this->riderA->fresh()->riderCredit->reserved_credits);
        $this->assertEquals(10000.00, (float) $this->riderA->fresh()->riderCredit->total_credits);

        // Read-only eligibility is unaffected: wallet is informational only.
        $eligibility = $this->dispatchService()->getCodEligibility($this->riderA->fresh());
        $this->assertEquals(9800.00, (float) $eligibility['available_working_credit']);
        $this->assertTrue($eligibility['cod_eligibility']);

        $this->assertSame(1, Delivery::where('status', 'completed')->count());
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
        ];
        $data = ['status' => $status];
        if (isset($timestamps[$status])) {
            $data[$timestamps[$status]] = now();
        }
        $delivery->update($data);
    }

    private function advanceDeliveryToDelivered(Delivery $delivery): Delivery
    {
        $this->advanceDeliveryStatus($delivery, 'arrived_pickup');
        $this->advanceDeliveryStatus($delivery, 'picked_up');
        $this->advanceDeliveryStatus($delivery, 'in_transit');
        $this->advanceDeliveryStatus($delivery, 'arrived_destination');

        $delivery->update(['status' => 'delivered', 'delivered_at' => now()]);
        $this->dispatchService()->markCodDelivered($delivery->fresh()->load('order'));

        return $delivery->fresh();
    }
}