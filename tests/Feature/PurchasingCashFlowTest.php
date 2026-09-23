<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodPurchase;
use App\Models\CodSettlement;
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
 * Professor purchasing-cash COD flow:
 *
 *   Tourist → multi-restaurant COD order → ONE delivery → rider accepts
 *     → Tourism Office issues purchasing cash (amount = rider_financed_amount)
 *     → rider confirms receipt → buys/collects food at each restaurant
 *     → ALL COLLECTED gate on picked_up
 *     → delivery → tourist pays cash → settle-cod → settlement → completed
 *
 * The purchase ledger (cod_purchases) must always reconcile to the settlement
 * base, and the Tourism Office never reaches into a rider wallet/credit
 * (credit-free COD, AGENTS.md §5.2 / §5.3).
 */
class PurchasingCashFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $riderA;
    private User $riderB;
    private User $admin;
    private Business $restaurantA;
    private Business $restaurantB;
    private GroupOrderService $groupService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-purchasing@example.com',
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

        $this->admin = User::create([
            'email' => 'tourism-office@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
        ]);

        $this->riderA = $this->makeRider('ridera-purchasing@example.com', 'Rider A');
        $this->riderB = $this->makeRider('riderb-purchasing@example.com', 'Rider B');

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

    private function createTwoRestaurantCodOrder(): array
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

        $order = $group->orders()->sole()->load('items');
        $delivery = $group->fresh()->delivery;

        return [$group, $order, $delivery, $order->rider_financed_amount];
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

    public function test_acceptance_creates_per_restaurant_purcashing_stops_reconciling_to_settlement_base(): void
    {
        [, $order, $delivery, $financed] = $this->createTwoRestaurantCodOrder();
        $this->assertNull($delivery->purchasing_cash_issued_at);

        $this->acceptDelivery($delivery);

        $purchases = CodPurchase::where('delivery_id', $delivery->id)->orderBy('business_id')->get();

        $this->assertCount(2, $purchases, 'One purchase stop per restaurant.');
        $this->assertSame(CodPurchase::STATUS_PENDING, $purchases[0]->status);
        $this->assertSame(CodPurchase::STATUS_PENDING, $purchases[1]->status);
        $this->assertSame([$this->restaurantA->id, $this->restaurantB->id], $purchases->pluck('business_id')->values()->all());

        $this->assertNotNull($purchases[0]->purchase_number);
        $this->assertNotNull($purchases[1]->purchase_number);

        $total = round($purchases->sum(fn ($p) => (float) $p->purchase_amount), 2);
        $this->assertEquals((float) $financed, $total, 'Purchasing cash = rider_financed_amount = settlement base.');

        // Restaurant A subtotal = 250, Restaurant B subtotal = 650; system fee
        // prorated exactly like CodSettlementService.
        $shareA = round((float) $order->system_fee * (250 / 900), 2);
        $shareB = round((float) $order->system_fee * (650 / 900), 2);
        $this->assertEquals(round(250 + $shareA, 2), (float) $purchases->firstWhere('business_id', $this->restaurantA->id)->purchase_amount);
        $this->assertEquals(round(650 + $shareB, 2), (float) $purchases->firstWhere('business_id', $this->restaurantB->id)->purchase_amount);

        // Idempotent: re-running initialization does not duplicate rows.
        app(\App\Services\PurchasingCashService::class)->initializeForDelivery($delivery);
        $this->assertCount(2, CodPurchase::where('delivery_id', $delivery->id)->get());
    }

    public function test_admin_issues_purchasing_cash_and_records_audit_trail(): void
    {
        [, , $delivery, $financed] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);

        $issueUrl = '/api/admin/deliveries/' . $delivery->id . '/issue-purchasing-cash';

        $this->be($this->riderA);
        $this->postJson($issueUrl)->assertStatus(403);

        $this->be($this->admin);
        $response = $this->postJson($issueUrl);
        $response->assertOk();
        $this->assertEquals((float) $financed, (float) $response->json('data.purchasing_cash'));
        $response->assertJsonPath('data.purchases_count', 2);

        $delivery->refresh();
        $this->assertEquals((float) $financed, (float) $delivery->purchasing_cash);
        $this->assertNotNull($delivery->purchasing_cash_issued_at);
        $this->assertSame($this->admin->id, $delivery->purchasing_cash_issued_by);

        $log = ActivityLog::where('action', 'purchasing_cash.issued')->latest('id')->first();
        $this->assertNotNull($log, 'Audit trail records the issuance.');
        $this->assertSame($this->admin->id, $log->user_id);
        $this->assertStringContainsString((string) $financed, $log->description);

        // Duplicate issuance is rejected (no silent overwrite / double cash).
        $this->postJson($issueUrl)->assertStatus(422);
        $this->assertCount(1, ActivityLog::where('action', 'purchasing_cash.issued')->get());
    }

    public function test_rider_confirms_receipt_and_marks_purchases_through_canonical_apis(): void
    {
        [, , $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);

        $purchasesUrl = '/api/rider/deliveries/' . $delivery->id;

        // Another rider cannot touch the trip.
        $this->be($this->riderB);
        $this->getJson($purchasesUrl . '/purchases')->assertStatus(403);

        $this->be($this->riderA);
        $list = $this->getJson($purchasesUrl . '/purchases')->assertOk()->json('data');
        $this->assertCount(2, $list['purchases']);

        $purchaseIds = collect($list['purchases'])->pluck('id');

        // Cannot mark before the purchasing cash is issued.
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'purchased'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Purchasing cash has not been issued yet.']);

        // Tourism Office issues the cash.
        $this->be($this->admin);
        $this->postJson('/api/admin/deliveries/' . $delivery->id . '/issue-purchasing-cash')->assertOk();

        // Rider confirms receipt.
        $this->be($this->riderA);
        $receipt = $this->postJson($purchasesUrl . '/purchasing-cash/receive');
        $receipt->assertOk();
        $this->assertNotNull($receipt->json('data.purchasing_cash_received_at'));
        $this->assertNotNull($delivery->fresh()->purchasing_cash_received_at);

        // Invalid next-step order is rejected (cannot collect an un-purchased stop).
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'collected'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Mark the purchase as bought first.']);

        // purchased → collected, then duplicate is rejected.
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'purchased'])->assertOk();
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'collected'])->assertOk();
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'collected'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'This purchase stop has already been processed.']);

        // Invalid status name rejected.
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[1] . '/mark', ['status' => 'stolen'])
            ->assertStatus(422);

        // Second restaurant still pending → not fully collected.
        $this->assertEquals(
            1,
            app(\App\Services\PurchasingCashService::class)->pendingPurchaseCount($delivery->fresh())
        );
    }

    public function test_picked_up_is_blocked_until_all_restaurants_collected(): void
    {
        [, , $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);

        $purchasesUrl = '/api/rider/deliveries/' . $delivery->id;

        // Tourism Office issues + rider receives.
        $this->be($this->admin);
        $this->postJson('/api/admin/deliveries/' . $delivery->id . '/issue-purchasing-cash')->assertOk();
        $this->be($this->riderA);
        $this->postJson($purchasesUrl . '/purchasing-cash/receive')->assertOk();

        $this->patchJson($purchasesUrl . '/status', ['status' => 'arrived_pickup'])->assertOk();

        $purchaseIds = collect($this->getJson($purchasesUrl . '/purchases')->json('data')['purchases'])->pluck('id');

        // Partial collection: leave cannot happen yet.
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'purchased'])->assertOk();
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'collected'])->assertOk();

        $this->patchJson($purchasesUrl . '/status', ['status' => 'picked_up'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Collect food from every restaurant before leaving the pickup area.']);
        $this->assertNotSame('picked_up', $delivery->fresh()->status->value);

        // Collect the remaining restaurant → leave now allowed.
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[1] . '/mark', ['status' => 'purchased'])->assertOk();
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[1] . '/mark', ['status' => 'collected'])->assertOk();

        $this->patchJson($purchasesUrl . '/status', ['status' => 'picked_up'])->assertOk();
        $this->assertSame('picked_up', $delivery->fresh()->status->value);
    }

    public function test_end_to_end_multi_restaurant_cod_purchasing_flow_to_settlement(): void
    {
        [, $order, $delivery, $financed] = $this->createTwoRestaurantCodOrder();

        // 1) Rider accepts the ONE shared delivery.
        $this->acceptDelivery($delivery);

        // 2) Tourism Office issues the purchasing cash.
        $this->be($this->admin);
        $this->postJson('/api/admin/deliveries/' . $delivery->id . '/issue-purchasing-cash')->assertOk();

        // 3) Rider receives and buys/collects food at BOTH restaurants.
        $this->be($this->riderA);
        $purchasesUrl = '/api/rider/deliveries/' . $delivery->id;
        $this->postJson($purchasesUrl . '/purchasing-cash/receive')->assertOk();

        $delivery->refresh()->load('codPurchases');
        $this->assertEquals((float) $financed, $delivery->codPurchases->sum(fn ($p) => (float) $p->purchase_amount));
        $this->assertCount(2, $delivery->codPurchases);

        foreach ($delivery->codPurchases as $purchase) {
            $this->postJson($purchasesUrl . '/purchases/' . $purchase->id . '/mark', ['status' => 'purchased'])->assertOk();
            $this->postJson($purchasesUrl . '/purchases/' . $purchase->id . '/mark', ['status' => 'collected'])->assertOk();
        }

        // 4) Leave after ALL COLLECTED, then deliver.
        foreach (['arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'] as $status) {
            $this->patchJson($purchasesUrl . '/status', ['status' => $status])->assertOk();
        }
        $this->patchJson($purchasesUrl . '/status', ['status' => 'delivered'])->assertOk();

        $delivery->refresh();
        $this->assertSame('delivered', $delivery->status->value);
        $this->assertNotNull($delivery->cash_due);
        $this->assertSame('busy', $this->riderA->fresh()->riderDetail->rider_status);

        // 5) Tourist pays cash at the door; rider settles through the canonical API.
        $cashDue = (float) $delivery->cash_due;
        $this->postJson($purchasesUrl . '/settle-cod', ['cash_received' => $cashDue])->assertOk();

        $delivery->refresh();
        $order->refresh();

        $this->assertSame('completed', $delivery->status->value);
        $this->assertSame('paid', $order->payment_status);
        $this->assertEquals($cashDue, (float) $delivery->cash_received);
        $this->assertEquals(0.0, (float) $delivery->change_given);

        // 6) Settlement must reconcile: per-restaurant shares + office fee = the
        //    SAME rider_financed_amount the Tourism Office handed out.
        $settlements = CodSettlement::where('delivery_id', $delivery->id)->get();
        $this->assertCount(2, $settlements, 'Two restaurant settlement allocations from the shared trip.');
        $this->assertEquals((float) $financed, round($settlements->sum(fn ($s) => (float) $s->settlement_base), 2));

        foreach ($settlements as $settlement) {
            $this->assertEquals(
                round((float) $settlement->restaurant_share + (float) $settlement->platform_fee, 2),
                round((float) $settlement->settlement_base, 2)
            );
            $this->assertEquals(80, round(($settlement->restaurant_share / $settlement->settlement_base) * 100));
            $this->assertEquals(20, round(($settlement->platform_fee / $settlement->settlement_base) * 100));
        }

        // 7) Rider free again; purchases all terminal (collected).
        $this->assertSame('available', $this->riderA->fresh()->riderDetail->rider_status);
        foreach ($delivery->codPurchases as $purchase) {
            $this->assertSame(CodPurchase::STATUS_COLLECTED, $purchase->status);
        }
    }
}