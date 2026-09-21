<?php

namespace Tests\Feature;

use App\Http\Controllers\BusinessOwnerOrderController;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodSettlement;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderSettlement;
use App\Models\Payment;
use App\Models\RestaurantWalletTransaction;
use App\Models\RiderCredit;
use App\Models\RiderCreditTransaction;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\CodSettlementService;
use App\Services\FirebaseService;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use App\Services\OrderSettlementService;
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * P11.1 — COD Credit Settlement & Tourism Office Revenue (credit-free COD,
 * steps 3–5 of the group-delivery redesign).
 *
 * A COD tourist pays the rider in cash at the drop-off; the rider keeps that
 * cash. COD accepts are CREDIT-FREE: no rider-track credit is reserved or
 * deducted (the ₱200 protected reserve and the wallet are untouched), and the
 * cash due is frozen at accept time. A group checkout rides on ONE physical
 * delivery with ONE rider; P11.1 still books an auditable settlement split per
 * restaurant order of the rider-financed base:
 *
 *     settlement_base = order.rider_financed_amount   (cod_credit_reserved == 0)
 *         ├── restaurant_share = base - platform_fee        (default 80%)
 *         └── platform_fee    = base x cod_platform_fee_percent (default 20%)
 *
 * The suite proves the wallet is never involved, that no rider remittance is
 * created (cash stays with the rider; earnings remain the commission + eligible
 * tip), that settlement is atomic & idempotent, that cancellation books nothing,
 * that multi-restaurant COD splits independently per restaurant on the single
 * shared trip, and that fast-delivery tips never enter the restaurant settlement.
 */
class CodFinancialSettlementTest extends TestCase
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
            'email' => 'owner-cod-fin@example.com',
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

        $this->riderA = $this->makeRider('ridera-cod-fin@example.com', 'Rider A', 10000);
        $this->riderB = $this->makeRider('riderb-cod-fin@example.com', 'Rider B', 10000);

        $nearestRiderMock = new class(app(FirebaseService::class)) extends NearestRiderService
        {
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

    // ---------- helpers ----------

    private function makeRider(string $email, string $name, float $funding): User
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

        RiderCredit::create([
            'rider_id' => $rider->id,
            'total_credits' => $funding,
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

    private function basePayload(array $restaurants, float $tip = 40.00): array
    {
        return [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'delivery_address' => '123 Test St',
            'payment_method' => 'cash',
            'rider_tip' => $tip,
            'notes' => null,
            'restaurants' => $restaurants,
        ];
    }

    private function dispatchService(): NearestRiderService
    {
        return $this->app->make(NearestRiderService::class);
    }

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
            app(SmartDispatchService::class)->scheduleDispatch($order->fresh());
        }
    }

    private function makeAllItemsReady(Order $order): void
    {
        foreach ($order->fresh()->items as $item) {
            $item->update(['status' => 'ready']);
        }
        $controller = app(BusinessOwnerOrderController::class);
        $method = new \ReflectionMethod($controller, 'refreshOrderStatus');
        $method->setAccessible(true);
        $method->invoke($controller, $order->fresh());
    }

    private function acceptDelivery(Delivery $delivery, User $rider): Delivery
    {
        $result = $this->dispatchService()->handleRiderResponse($delivery->id, $rider->id, 'accepted');
        $this->assertTrue($result['success'] ?? false, 'Rider accepts the delivery.');

        return $delivery->fresh()->load('order');
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
        $this->advanceDeliveryStatus($delivery->fresh(), 'arrived_pickup');
        $this->advanceDeliveryStatus($delivery->fresh(), 'picked_up');
        $this->advanceDeliveryStatus($delivery->fresh(), 'in_transit');
        $this->advanceDeliveryStatus($delivery->fresh(), 'arrived_destination');

        $delivery->refresh();
        $delivery->update(['status' => 'delivered', 'delivered_at' => now()]);
        $this->dispatchService()->markCodDelivered($delivery->fresh()->load('order'));

        return $delivery->fresh()->load('order');
    }

    private function settle(Delivery $delivery): array
    {
        return $this->dispatchService()->settleCodDelivery($delivery->fresh()->load('order'), (float) $delivery->cash_due);
    }

    private function settlementOf(int $orderId): ?CodSettlement
    {
        return CodSettlement::where('order_id', $orderId)->first();
    }

    // ───────────────────────────────────────────────────────────────
    // 1. Completed COD books an 80% restaurant / 20% Tourism Office
    //    settlement of exactly the rider-financed reserve.
    // ───────────────────────────────────────────────────────────────
    public function test_successful_cod_settlement_splits_base_80_20(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);

        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);
        $this->assertEquals(0.0, (float) $delivery->cod_credit_reserved, 'Credit-free COD: NO credit reserve is taken.');
        $this->assertGreaterThan(0, (float) $delivery->cash_due, 'cash_due frozen at accept.');

        $expectedBase = round((float) $order->rider_financed_amount, 2);
        $fee = round($expectedBase * (int) config('delivery.cod_platform_fee_percent', 20) / 100, 2);

        $delivery = $this->advanceDeliveryToDelivered($delivery);
        $result = $this->settle($delivery);

        $settlement = $this->settlementOf($order->id);
        $this->assertNotNull($settlement, 'A cod_settlements row is booked.');
        $this->assertSame($order->id, $settlement->order_id);
        $this->assertSame($delivery->id, $settlement->delivery_id);
        $this->assertSame($this->restaurantA->id, $settlement->business_id);
        $this->assertSame($this->riderA->id, $settlement->rider_id);
        $this->assertSame(CodSettlement::STATUS_SETTLED, $settlement->status);

        $this->assertEquals($expectedBase, (float) $settlement->settlement_base);
        $this->assertEquals(round($expectedBase - $fee, 2), (float) $settlement->restaurant_share);
        $this->assertEquals($fee, (float) $settlement->platform_fee);
        $this->assertEquals($expectedBase, round((float) $settlement->restaurant_share + (float) $settlement->platform_fee, 2));

        $this->assertNotNull($result['settlement_id']);
        $this->assertEquals($expectedBase, (float) $result['settlement_base']);
        $this->assertEquals($fee, (float) $result['platform_fee']);

        $this->assertTrue(app(CodSettlementService::class)->isSettled($order->id));

        $orderSettlement = OrderSettlement::where('order_id', $order->id)->first();
        $this->assertNotNull($orderSettlement, 'One common order settlement is posted.');
        $this->assertSame($settlement->id, $orderSettlement->cod_settlement_id);
        $this->assertSame(OrderSettlement::SOURCE_COD, $orderSettlement->source);
        $this->assertEquals($expectedBase, (float) $orderSettlement->settlement_base);
        $this->assertEquals((float) $settlement->restaurant_share, (float) $orderSettlement->restaurant_amount);
        $this->assertEquals((float) $settlement->platform_fee, (float) $orderSettlement->platform_amount);

        $wallet = $this->restaurantA->fresh()->restaurantWallet;
        $this->assertEquals((float) $settlement->restaurant_share, (float) $wallet->available_balance);
        $this->assertEquals((float) $settlement->restaurant_share, (float) $wallet->total_earned);
        $walletTransaction = RestaurantWalletTransaction::where('order_settlement_id', $orderSettlement->id)->first();
        $this->assertNotNull($walletTransaction, 'One immutable ORDER_EARNING is posted.');
        $this->assertSame(RestaurantWalletTransaction::TYPE_ORDER_EARNING, $walletTransaction->type);
        $this->assertEquals((float) $wallet->available_balance, (float) $walletTransaction->available_balance_after);

        // Restaurant ledger recognizes its receivable.
        $ledger = app(CodSettlementService::class)->restaurantLedger($this->restaurantA->id);
        $this->assertSame(1, $ledger['settlements']->count());
        $this->assertEquals($expectedBase, (float) $ledger['total_settlement_base']);
        $this->assertEquals(round($expectedBase - $fee, 2), (float) $ledger['total_restaurant_receivable']);
        $this->assertEquals($fee, (float) $ledger['total_platform_fee']);
    }

    // ───────────────────────────────────────────────────────────────
    // 2. Settlement base == reserved == financed (audit invariant).
    // ───────────────────────────────────────────────────────────────
    public function test_settlement_base_equals_exact_reserved_and_financed_amount(): void
    {
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantB->id, 'items' => [
                ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantB->id)->first();

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);
        $delivery = $this->advanceDeliveryToDelivered($delivery);
        $this->settle($delivery);

        $settlement = $this->settlementOf($order->id);
        $this->assertEquals(0.0, (float) $delivery->cod_credit_reserved, 'Credit-free COD carries no reserve.');
        $this->assertEquals(
            round((float) $order->rider_financed_amount, 2),
            (float) $settlement->settlement_base,
            'Settlement base is the exact persisted rider-financed amount.'
        );
        $this->assertGreaterThan((float) $settlement->settlement_base, (float) $order->total, 'cash_due (order total) exceeds the financed base.');
    }

    // ───────────────────────────────────────────────────────────────
    // 3. Rider credit is NEVER touched (credit-free COD, step 3): the rider
    //    covers the purchase with cash on hand and keeps it — no reserve is
    //    taken, and settlement performs no wallet deduction.
    // ───────────────────────────────────────────────────────────────
    public function test_rider_credit_untouched_by_credit_free_cod(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);

        $this->assertEquals(0.0, (float) $this->riderA->fresh()->riderCredit->reserved_credits, 'No reserve before settlement.');
        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $this->riderA->id)->count());

        $this->settle($this->advanceDeliveryToDelivered($delivery));

        $credit = $this->riderA->fresh()->riderCredit;
        $this->assertEquals(0.0, (float) $credit->reserved_credits, 'No reservation ever taken.');
        $this->assertEquals(10000.00, (float) $credit->total_credits, 'Wallet untouched: credit-free COD never deducts credits.');

        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $this->riderA->id)
            ->where('transaction_type', 'COD_SETTLEMENT')->count(), 'No COD_SETTLEMENT ledger write.');
        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $this->riderA->id)
            ->where('transaction_type', 'COD_RESERVE')->count(), 'No COD_RESERVE ledger write.');
    }

    // ───────────────────────────────────────────────────────────────
    // 4. The rider keeps the cash: no remittance liability is created and
    //    earnings (delivery fee + eligible tip) are separate from the cash.
    // ───────────────────────────────────────────────────────────────
    public function test_cod_cash_is_not_a_remittance_and_earnings_are_separate(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);
        $delivery = $this->advanceDeliveryToDelivered($delivery);
        $cashDue = (float) $delivery->cash_due;

        $result = $this->settle($delivery);
        $this->assertEquals($cashDue, $result['cash_due']);
        $this->assertEquals(0.0, $result['change_given']);

        $cashPayment = Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('method', 'cash')
            ->where('status', 'paid')->first();
        $this->assertNotNull($cashPayment, 'Single cash payment recorded.');
        $this->assertEquals($cashDue, (float) $cashPayment->amount);
        $this->assertSame('rider', $cashPayment->provider, 'Cash is collected by the rider.');

        // Exactly one payment — nothing remitted onward from the rider's hands.
        $this->assertSame(1, Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->count());

        // Earnings are the delivery fee + tip only -- never the COD cash.
        $earning = RiderEarning::where('rider_id', $this->riderA->id)
            ->where('order_id', $order->id)->first();
        $this->assertNotNull($earning);
        $expectedEarning = round(
            (float) ($delivery->rider_commission ?? $delivery->delivery_fee ?? 0) + (float) ($order->rider_tip ?? 0),
            2
        );
        $this->assertEquals($expectedEarning, (float) $earning->total_earning);
        $this->assertLessThan($cashDue, (float) $earning->total_earning, 'Earning is a fraction of the cash, never equal to it.');
        $this->assertEquals((float) ($order->rider_tip ?? 0), (float) $earning->rider_tip);

        // The wallet is untouched: credit-free COD means nothing is drawn from
        // the rider's credits, and the collector keeps the physical cash.
        $credit = $this->riderA->fresh()->riderCredit;
        $settlement = $this->settlementOf($order->id);
        $this->assertEquals(
            10000.00,
            (float) $credit->total_credits,
            'Wallet untouched by credit-free COD.'
        );
        $this->assertGreaterThan(0, (float) $settlement->settlement_base, 'Settlement books the financed base for restaurant/TO.');
    }

    // ───────────────────────────────────────────────────────────────
    // 5. Settlement is idempotent: exactly ONE split row per order.
    // ───────────────────────────────────────────────────────────────
    public function test_settlement_is_idempotent_one_row_per_order(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);
        $delivery = $this->advanceDeliveryToDelivered($delivery);

        $this->settle($delivery);
        $this->assertSame(1, CodSettlement::where('order_id', $order->id)->count());

        // A second settle on the now-completed delivery is rejected by the
        // status guard before any split could be re-booked.
        try {
            $this->settle($delivery);
            $this->fail('A double settle must be rejected.');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('delivered', $e->getMessage());
        }

        $this->assertSame(1, CodSettlement::where('order_id', $order->id)->count());
        $this->assertSame(1, CodSettlement::count());
        $this->assertSame(1, OrderSettlement::where('order_id', $order->id)->count());
        $this->assertSame(1, RestaurantWalletTransaction::where('business_id', $this->restaurantA->id)->count());

        $commonSettlement = app(OrderSettlementService::class)->recordCodSettlement($this->settlementOf($order->id));
        $sameSettlement = app(OrderSettlementService::class)->recordCodSettlement($this->settlementOf($order->id));
        $this->assertSame($commonSettlement->id, $sameSettlement->id, 'Repeated settlement posting is a no-op.');
        $this->assertSame(1, RestaurantWalletTransaction::where('order_settlement_id', $commonSettlement->id)->count());

        // The service's order lock serializes concurrent callers; this unique
        // key is the final database backstop if a caller bypasses that service.
        try {
            OrderSettlement::create([
                'settlement_number' => 'ORD-STL-DUPLICATE-'.$order->id,
                'order_id' => $order->id,
                'business_id' => $order->business_id,
                'source' => OrderSettlement::SOURCE_COD,
                'payment_method' => $order->payment_method,
                'settlement_base' => 100,
                'restaurant_amount' => 80,
                'platform_amount' => 20,
                'status' => OrderSettlement::STATUS_SETTLED,
                'settled_at' => now(),
            ]);
            $this->fail('The database must reject a second settlement for an order.');
        } catch (\Illuminate\Database\QueryException) {
            $this->assertSame(1, OrderSettlement::where('order_id', $order->id)->count());
        }

        // The UNIQUE(order_id) backstop also exists at the schema level.
        $columns = collect(Schema::getIndexes('cod_settlements'))
            ->map(fn ($i) => implode(',', $i['columns'] ?? []));
        $this->assertTrue($columns->contains('order_id'), 'Unique index on order_id exists.');
    }

    public function test_common_settlement_rejects_an_incomplete_order(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->first();
        $delivery = $order->activeDelivery();
        $codSettlement = CodSettlement::create([
            'settlement_number' => 'COD-STL-INCOMPLETE-'.$order->id,
            'order_id' => $order->id,
            'delivery_id' => $delivery->id,
            'business_id' => $order->business_id,
            'rider_id' => $this->riderA->id,
            'settlement_base' => 100,
            'restaurant_share' => 80,
            'platform_fee' => 20,
            'status' => CodSettlement::STATUS_SETTLED,
            'settled_at' => now(),
        ]);

        $this->expectException(\InvalidArgumentException::class);
        app(OrderSettlementService::class)->recordCodSettlement($codSettlement);
    }

    // ───────────────────────────────────────────────────────────────
    // 6. COD eligibility is CREDIT-FREE (step 3): a low-wallet rider is still
    //    eligible, cash_due is frozen, and no reservation or settlement is ever
    //    blocked by (or written to) the rider wallet.
    // ───────────────────────────────────────────────────────────────
    public function test_low_credit_rider_is_cod_eligible_without_credit_block(): void
    {
        // Usable credit = 210 - 200 protected = 10, far below any real order —
        // irrelevant now, because COD never consults the wallet.
        $riderLow = $this->makeRider('rider-low-fin@example.com', 'Rider Low', 210);

        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $order->fresh()->activeDelivery();

        // The reservation is credit-free and succeeds regardless of balance.
        $this->assertTrue($this->dispatchService()->reserveCodCredit($delivery, $riderLow->id));
        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $riderLow->id)->count());
        $this->assertEquals(0.0, (float) $riderLow->fresh()->riderCredit->reserved_credits, 'No reservation taken.');
        $this->assertEquals(0.0, (float) $delivery->fresh()->cod_credit_reserved, 'No reserve recorded on the delivery.');
        $this->assertGreaterThan(0, (float) $delivery->fresh()->cash_due, 'cash_due frozen despite the low balance.');
        $this->assertTrue($this->dispatchService()->getCodEligibility($riderLow->fresh())['cod_eligibility']);

        // No settlement row can be booked from a wallet consideration.
        $this->assertSame(0, CodSettlement::count());
    }

    // ───────────────────────────────────────────────────────────────
    // 7. Cancellation books no settlement and the wallet is never involved.
    // ───────────────────────────────────────────────────────────────
    public function test_cancelled_cod_books_no_settlement_and_wallet_is_untouched(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);
        $this->assertEquals(0.0, (float) $delivery->cod_credit_reserved, 'Credit-free accept reserves nothing.');
        $this->assertGreaterThan(0, (float) $delivery->cash_due);
        $this->assertEquals(0.0, (float) $this->riderA->fresh()->riderCredit->reserved_credits);

        $this->dispatchService()->cancelDelivery($delivery->fresh()->load('order'));

        $cancelled = $delivery->fresh();
        $this->assertSame('cancelled', $cancelled->status->value);
        $this->assertEquals(0.0, (float) $cancelled->cod_credit_reserved);
        $this->assertEquals(0.0, (float) $this->riderA->fresh()->riderCredit->reserved_credits, 'Wallet reserve untouched.');
        $this->assertEquals(10000.00, (float) $this->riderA->fresh()->riderCredit->total_credits, 'Wallet balance untouched.');
        $this->assertSame(0, RiderCreditTransaction::where('rider_id', $this->riderA->id)->count(), 'No credit ledger writes.');

        // No restaurant / Tourism Office attribution.
        $this->assertSame(0, CodSettlement::count());
        $this->assertSame(0, app(CodSettlementService::class)->restaurantLedger($this->restaurantA->id)['settlements']->count());
        $this->assertEquals(0.0, (float) app(CodSettlementService::class)->tourismOfficeLedger()['total_platform_revenue']);

        // A cancelled delivery can never be settled.
        try {
            $this->settle($cancelled);
            $this->fail('Cancelled delivery must not be settleable.');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('delivered', $e->getMessage());
        }
        $this->assertSame(0, CodSettlement::count());
    }

    // ───────────────────────────────────────────────────────────────
    // 8. Multi-restaurant COD: ONE shared trip, ONE rider, yet the settlement
    //    splits independently per restaurant (one cod_settlement row per
    //    restaurant order with its own 80/20 split and ledger rows).
    // ───────────────────────────────────────────────────────────────
    public function test_multi_restaurant_cod_settles_per_restaurant_on_one_shared_trip(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 80.00);
        $coke = $this->makeOffering($this->restaurantA, 'Coke', 50.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);
        $pasta = $this->makeOffering($this->restaurantB, 'Pasta', 250.00);

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

        $orderA = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $orderB = $group->orders()->where('business_id', $this->restaurantB->id)->first();

        foreach ([$orderA, $orderB] as $order) {
            $this->acceptRestaurantOrder($order);
        }

        // ONE shared group delivery — never one delivery per restaurant.
        $this->assertNull($orderA->fresh()->delivery, 'Child orders own no individual delivery.');
        $this->assertNull($orderB->fresh()->delivery, 'Child orders own no individual delivery.');
        $groupDelivery = $group->fresh()->delivery;
        $this->assertNotNull($groupDelivery, 'The group has exactly one physical delivery.');
        $this->assertNull($groupDelivery->order_id, 'Group delivery is anchored on the group, not an order.');
        $this->assertSame($group->id, $groupDelivery->group_checkout_id);

        $this->makeAllItemsReady($orderB);
        $this->makeAllItemsReady($orderA);

        // ONE rider collects from every restaurant.
        $delivery = $this->acceptDelivery($groupDelivery, $this->riderA);
        $this->assertSame($this->riderA->id, $delivery->rider_id);

        $delivery = $this->advanceDeliveryToDelivered($delivery);
        $this->settle($delivery);

        $settlementA = $this->settlementOf($orderA->id);
        $settlementB = $this->settlementOf($orderB->id);

        $this->assertNotNull($settlementA);
        $this->assertNotNull($settlementB);
        $this->assertNotSame($settlementA->id, $settlementB->id);
        $this->assertSame($this->restaurantA->id, $settlementA->business_id);
        $this->assertSame($this->restaurantB->id, $settlementB->business_id);
        $this->assertSame($this->riderA->id, $settlementA->rider_id);
        $this->assertSame($this->riderA->id, $settlementB->rider_id);
        $this->assertSame($delivery->id, $settlementA->delivery_id);
        $this->assertSame($delivery->id, $settlementB->delivery_id);

        // Each restaurant books its OWN financed base, never the group total.
        $baseA = round((float) $orderA->rider_financed_amount, 2);
        $baseB = round((float) $orderB->rider_financed_amount, 2);
        $this->assertEquals($baseA, (float) $settlementA->settlement_base);
        $this->assertEquals($baseB, (float) $settlementB->settlement_base);

        $pct = (int) config('delivery.cod_platform_fee_percent', 20) / 100;
        $this->assertEquals(round($baseA - round($baseA * $pct, 2), 2), (float) $settlementA->restaurant_share);
        $this->assertEquals(round($baseB - round($baseB * $pct, 2), 2), (float) $settlementB->restaurant_share);

        // Tourism Office ledger aggregates BOTH restaurants' fees independently.
        $toLedger = app(CodSettlementService::class)->tourismOfficeLedger();
        $this->assertSame(2, $toLedger['count']);
        $this->assertEquals(
            round((float) $settlementA->platform_fee + (float) $settlementB->platform_fee, 2),
            (float) $toLedger['total_platform_revenue']
        );

        // Restaurant ledgers are separated.
        $ledgerA = app(CodSettlementService::class)->restaurantLedger($this->restaurantA->id);
        $ledgerB = app(CodSettlementService::class)->restaurantLedger($this->restaurantB->id);
        $this->assertSame(1, $ledgerA['settlements']->count());
        $this->assertSame(1, $ledgerB['settlements']->count());
        $this->assertEquals($baseA, (float) $ledgerA['total_settlement_base']);
        $this->assertEquals($baseB, (float) $ledgerB['total_settlement_base']);
        $this->assertEquals((float) $settlementA->restaurant_share, (float) $this->restaurantA->fresh()->restaurantWallet->available_balance);
        $this->assertEquals((float) $settlementB->restaurant_share, (float) $this->restaurantB->fresh()->restaurantWallet->available_balance);
    }

    // ───────────────────────────────────────────────────────────────
    // 9. The 20% is configuration-driven, never hard-coded: P100 -> P80/P20,
    //    P500 -> P400/P100, P1000 -> P800/P200, and a different configured
    //    rate immediately changes the split.
    // ───────────────────────────────────────────────────────────────
    public function test_platform_fee_percent_split_is_config_driven(): void
    {
        $service = app(CodSettlementService::class);

        // Default (20%).
        $this->assertSame(20, $service->platformFeePercent());
        foreach ([100 => [80, 20], 500 => [400, 100], 1000 => [800, 200]] as $base => $expected) {
            $split = $service->split($base);
            $this->assertEquals($base, (float) $split['settlement_base']);
            $this->assertEquals($expected[0], (float) $split['restaurant_share']);
            $this->assertEquals($expected[1], (float) $split['platform_fee']);
            $this->assertEquals($base, round((float) $split['restaurant_share'] + (float) $split['platform_fee'], 2));
        }

        // Config change flows through: 10% -> P900 / P100 on P1000.
        config(['delivery.cod_platform_fee_percent' => 10]);
        $split = $service->split(1000);
        $this->assertSame(10, $service->platformFeePercent());
        $this->assertEquals(900, (float) $split['restaurant_share']);
        $this->assertEquals(100, (float) $split['platform_fee']);

        // Config change flows through the real settlement path too.
        config(['delivery.cod_platform_fee_percent' => 10]);
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);
        $delivery = $this->advanceDeliveryToDelivered($delivery);
        $this->settle($delivery);

        $settlement = $this->settlementOf($order->id);
        $fee = round((float) $order->rider_financed_amount * 0.10, 2);
        $this->assertEquals($fee, (float) $settlement->platform_fee);
        $this->assertEquals(round((float) $order->rider_financed_amount - $fee, 2), (float) $settlement->restaurant_share);
    }

    // ───────────────────────────────────────────────────────────────
    // 10. A fast-delivery tip is preserved for the rider and never enters
    //     the restaurant settlement base or the TO revenue.
    // ───────────────────────────────────────────────────────────────
    public function test_fast_delivery_tip_is_not_part_of_restaurant_settlement(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
            ]],
        ], tip: 100.00));
        $order = $group->orders()->where('business_id', $this->restaurantA->id)->first();
        $this->assertGreaterThan(0, (float) $order->rider_tip);

        $this->acceptRestaurantOrder($order);
        $this->makeAllItemsReady($order);
        $delivery = $this->acceptDelivery($order->fresh()->activeDelivery(), $this->riderA);
        $delivery = $this->advanceDeliveryToDelivered($delivery);
        $this->settle($delivery);

        $settlement = $this->settlementOf($order->id);

        // The base is subtotal + system fee -- never the tip (or the delivery fee).
        $this->assertEquals(round((float) $order->rider_financed_amount, 2), (float) $settlement->settlement_base);
        $this->assertNotEquals((float) $order->total, (float) $settlement->settlement_base);

        // The tip is kept by the rider as earnings, separate from the split.
        $earning = RiderEarning::where('rider_id', $this->riderA->id)
            ->where('order_id', $order->id)->first();
        $this->assertEquals(100.00, (float) $earning->rider_tip);
        $this->assertGreaterThan(0, (float) $earning->total_earning);

        // Tourism Office revenue comes from the financed base only.
        $this->assertEquals(
            round((float) $settlement->settlement_base * (int) config('delivery.cod_platform_fee_percent', 20) / 100, 2),
            (float) $settlement->platform_fee
        );
    }
}
