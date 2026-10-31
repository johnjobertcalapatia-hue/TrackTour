<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodPurchase;
use App\Models\CodSettlement;
use App\Models\CodPurchaseExpense;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderCashFund;
use App\Models\RiderCashFundTransaction;
use App\Models\RiderLocation;
use App\Models\RiderDailyCashMovement;
use App\Models\RiderDailyReconciliation;
use App\Models\RiderDailyReconciliationCorrection;
use App\Models\RiderEarning;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use App\Services\RiderDailyReconciliationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Schema;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * Professor purchasing-cash COD flow:
 *
 *     → Tourism Office issues purchasing cash (amount = rider_financed_amount)
 *     → rider confirms receipt → buys/collects food at each restaurant in
 *       preparation-time order (shortest prep first, last pickup = drop-off origin)
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
    private User $tourist;
    private Business $restaurantA;
    private Business $restaurantB;
    private GroupOrderService $groupService;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'cod_cash.cash_movement_reference_namespaces' => [
                'office-receipts' => [
                    'type' => 'office_receipt',
                    'source' => 'bansud-tourism-office',
                    'issuer' => 'Bansud Tourism Office',
                    'series' => 'Official Receipt Book A',
                    'label' => 'Office receipt book A',
                ],
                'office-receipts-other-issuer' => [
                    'type' => 'office_receipt',
                    'source' => 'other-authorized-office',
                    'issuer' => 'Other Authorized Issuer',
                    'series' => 'Official Receipt Book A',
                    'label' => 'Other issuer receipt book A',
                ],
                'office-receipts-other-series' => [
                    'type' => 'office_receipt',
                    'source' => 'bansud-tourism-office',
                    'issuer' => 'Bansud Tourism Office',
                    'series' => 'Official Receipt Book B',
                    'label' => 'Office receipt book B',
                ],
                'paymongo' => [
                    'type' => 'provider_transaction',
                    'source' => 'paymongo',
                    'label' => 'PayMongo reference',
                ],
                'manual-cash-log' => [
                    'type' => 'manual_evidence',
                    'source' => 'bansud-tourism-office',
                    'issuer' => 'Bansud Tourism Office cash log',
                    'series' => 'Cash receipt log',
                    'label' => 'Manual cash log',
                ],
            ],
        ]);

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

        $this->admin = User::create([
            'email' => 'tourism-office@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'email' => 'tourist-purchasing@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
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

    protected function tearDown(): void
    {
        \Carbon\Carbon::setTestNow();
        parent::tearDown();
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

        $group = $this->groupService->createGroup($this->tourist, $this->basePayload([
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

    private function markRestaurantReady(Order $order, Business $business): void
    {
        foreach ($order->items()->where('business_id', $business->id)->get() as $item) {
            $this->be($this->owner)
                ->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'ready'])
                ->assertOk();
        }
    }

    private function arriveAtRestaurant(Delivery $delivery, Business $business): void
    {
        RiderLocation::create([
            'rider_id' => $this->riderA->id,
            'latitude' => $business->latitude,
            'longitude' => $business->longitude,
            'recorded_at' => now(),
        ]);

        $this->be($this->riderA)
            ->postJson("/api/rider/deliveries/{$delivery->id}/pickup-stops/{$business->id}/arrive")
            ->assertOk();
    }

    private function dispatchService(): NearestRiderService
    {
        return $this->app->make(NearestRiderService::class);
    }

    private function createCompletedCodDelivery(float $personalContribution = 0, float $additionalOfficeCash = 0): array
    {
        Storage::fake('local');
        [, $order, $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);
        $this->be($this->admin);
        $this->postJson('/api/admin/deliveries/'.$delivery->id.'/issue-purchasing-cash')->assertOk();
        if ($additionalOfficeCash > 0) {
            $this->postJson('/api/admin/deliveries/'.$delivery->id.'/purchasing-cash/additional', [
                'amount' => $additionalOfficeCash,
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            ])->assertOk();
        }

        $this->be($this->riderA)
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/purchasing-cash/receive')
            ->assertOk();
        $this->markRestaurantReady($order, $this->restaurantA);
        $this->markRestaurantReady($order, $this->restaurantB);

        $purchases = CodPurchase::where('delivery_id', $delivery->id)->orderBy('business_id')->get();
        foreach ($purchases as $index => $purchase) {
            $this->be($this->riderA)
                ->postJson('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/mark', [
                    'status' => 'purchased',
                ])->assertOk();
            $purchasePersonalContribution = $index === 0 ? $personalContribution : 0;
            if ($purchasePersonalContribution >= 0) {
                $expense = $this->post('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expense', [
                    'actual_purchase_amount' => (float) $purchase->purchase_amount + $purchasePersonalContribution,
                    'tourism_office_cash_used' => (float) $purchase->purchase_amount,
                    'rider_personal_contribution' => $purchasePersonalContribution,
                    'receipt' => UploadedFile::fake()->image('verified-purchase-receipt.jpg'),
                ], ['Accept' => 'application/json'])->assertOk();
                $this->be($this->admin)
                    ->postJson('/api/admin/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expenses/'.$expense->json('data.id').'/verify')
                    ->assertOk();
            }

            $business = $purchase->business_id === $this->restaurantA->id
                ? $this->restaurantA
                : $this->restaurantB;
            $this->arriveAtRestaurant($delivery, $business);
            $this->postJson('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/mark', [
                'status' => 'collected',
            ])->assertOk();
        }

        $deliveryUrl = '/api/rider/deliveries/'.$delivery->id;
        $this->be($this->riderA);
        $this->patchJson($deliveryUrl.'/status', ['status' => 'in_transit'])->assertOk();
        $this->patchJson($deliveryUrl.'/status', ['status' => 'arrived_destination'])->assertOk();
        $this->be($this->tourist)
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk();
        $delivery->refresh();
        $this->be($this->riderA)
            ->postJson($deliveryUrl.'/settle-cod', ['cash_received' => (float) $delivery->cash_due])
            ->assertOk();
        $delivery->refresh();

        $date = $delivery->delivered_at->copy()->setTimezone('Asia/Manila')->toDateString();

        return [$delivery, $date, $order];
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

    public function test_cash_issuance_and_receipt_are_recorded_in_the_rider_fund_ledger(): void
    {
        [, , $delivery, $financed] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);

        $this->be($this->admin)
            ->postJson('/api/admin/deliveries/'.$delivery->id.'/issue-purchasing-cash')
            ->assertOk();

        $delivery->refresh();
        $this->assertNotNull($delivery->rider_cash_fund_id);
        $issued = RiderCashFundTransaction::where('delivery_id', $delivery->id)
            ->where('type', RiderCashFundTransaction::TYPE_CASH_ISSUED)
            ->sole();
        $this->assertSame((int) $delivery->rider_cash_fund_id, (int) $issued->rider_cash_fund_id);
        $this->assertEquals($financed, (float) $issued->amount);
        $this->assertNull($issued->received_at);

        $receiveUrl = '/api/rider/deliveries/'.$delivery->id.'/purchasing-cash/receive';
        $this->be($this->riderA)->postJson($receiveUrl)->assertOk();
        $issued->refresh();
        $this->assertSame($this->riderA->id, $issued->received_by);
        $this->assertNotNull($issued->received_at);

        $ledger = $this->be($this->admin)
            ->getJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund?date='.now('Asia/Manila')->toDateString())
            ->assertOk()
            ->json('data');
        $this->assertSame('Asia/Manila', $ledger['timezone']);
        $this->assertEquals($financed, $ledger['totals']['cash_issued']);
        $this->assertCount(1, $ledger['transactions']);
    }

    public function test_daily_cash_receipt_is_read_only_and_empty_without_eligible_cod_deliveries(): void
    {
        $date = now('Asia/Manila')->toDateString();

        $this->be($this->riderA)
            ->getJson('/api/rider/cash-fund/daily-receipt?date='.$date)
            ->assertOk()
            ->assertJsonPath('data.receipt_status', 'calculated_preview')
            ->assertJsonPath('data.policy_status', 'inactive_pending_activation')
            ->assertJsonPath('data.working_date', $date)
            ->assertJsonPath('data.totals.eligible_delivery_count', 0)
            ->assertJsonPath('data.totals.cash_collected', 0)
            ->assertJsonPath('data.totals.net_cod_remittance_expected', 0)
            ->assertJsonPath('data.cash_received_by_tourism_office', null)
            ->assertJsonPath('data.remittance_submitted', false)
            ->assertJsonPath('data.cash_returned_to_tourism_office', null)
            ->assertJsonPath('data.cash_return_recorded', false);

        $this->getJson('/api/rider/cash-fund/daily-receipt?date=30-10-2026')
            ->assertUnprocessable();
        $this->getJson('/api/rider/cash-fund/daily-receipt?date='.now('Asia/Manila')->addDay()->toDateString())
            ->assertUnprocessable();

        config([
            'cod_cash.reconciliation_enabled' => true,
            'cod_cash.effective_date' => $date,
        ]);
        $this->postJson('/api/rider/cash-fund/daily-receipt/submissions', [
            'date' => $date,
            'cash_remitted' => 0,
            'office_cash_returned' => 0,
            'remittance_reference' => 'NO-ELIGIBLE-COD',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertDatabaseCount('rider_daily_reconciliations', 0);
    }

    public function test_admin_verification_values_do_not_create_physical_movement_records(): void
    {
        [, $date] = $this->createCompletedCodDelivery(20, 100);
        config([
            'cod_cash.reconciliation_enabled' => true,
            'cod_cash.effective_date' => $date,
        ]);
        $receipt = $this->be($this->riderA)
            ->getJson('/api/rider/cash-fund/daily-receipt?date='.$date)
            ->assertOk()
            ->json('data');
        $expectedCod = (float) $receipt['totals']['net_cod_remittance_expected'];
        $expectedReturn = (float) $receipt['totals']['unreturned_tourism_office_cash_balance'];
        $expectedReimbursement = (float) $receipt['totals']['verified_personal_purchase_reimbursement'];
        $submission = $this->postJson('/api/rider/cash-fund/daily-receipt/submissions', [
            'date' => $date,
            'cash_remitted' => $expectedCod,
            'office_cash_returned' => $expectedReturn,
            'remittance_reference' => 'CLAIM-ONLY-001',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertOk()->json('data');

        $verifyUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$submission['id'].'/verify';
        $verificationKey = (string) \Illuminate\Support\Str::uuid();
        $payload = [
            'cash_received' => $expectedCod,
            'office_cash_returned' => $expectedReturn,
            'rider_reimbursement_paid' => $expectedReimbursement,
            'idempotency_key' => $verificationKey,
        ];
        $this->be($this->admin)->postJson($verifyUrl, $payload)
            ->assertOk()
            ->assertJsonPath('data.status', RiderDailyReconciliation::STATUS_DISPUTED);
        $this->assertSame(0, RiderDailyCashMovement::count());
        $this->be($this->riderA)
            ->getJson('/api/rider/cash-fund/daily-receipt?date='.$date)
            ->assertOk()
            ->assertJsonPath('data.cash_received_by_tourism_office', null)
            ->assertJsonPath('data.cash_returned_to_tourism_office', null)
            ->assertJsonPath('data.cash_return_recorded', false);
        $this->assertDatabaseHas('rider_daily_reconciliation_events', [
            'rider_daily_reconciliation_id' => $submission['id'],
            'action' => 'verified',
        ]);
        $this->be($this->admin)->postJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$submission['id'].'/close', [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);

        $this->be($this->admin)->postJson($verifyUrl, $payload)
            ->assertOk()
            ->assertJsonPath('data.status', RiderDailyReconciliation::STATUS_DISPUTED);
        $this->assertSame(0, RiderDailyCashMovement::count());
    }

    public function test_daily_cash_movements_enforce_cumulative_limits_and_audit_dispute_corrections(): void
    {
        [$delivery, $date, $order] = $this->createCompletedCodDelivery(20, 100);
        config([
            'cod_cash.reconciliation_enabled' => true,
            'cod_cash.effective_date' => $date,
        ]);
        $receipt = $this->be($this->riderA)
            ->getJson('/api/rider/cash-fund/daily-receipt?date='.$date)
            ->assertOk()
            ->json('data');
        $codDue = (float) $receipt['totals']['net_cod_remittance_expected'];
        $cashAdvanceOutstanding = (float) $receipt['totals']['unreturned_tourism_office_cash_balance'];
        $personalPurchasePayable = (float) $receipt['totals']['verified_personal_purchase_reimbursement'];
        $this->assertEquals(20, $personalPurchasePayable);
        $this->assertEquals(100, $cashAdvanceOutstanding);
        $this->assertEquals(
            round(
                (float) $delivery->cash_due
                    - $receipt['totals']['rider_delivery_fee_entitlement']
                    - $receipt['totals']['rider_tip_entitlement']
                    - $personalPurchasePayable,
                2
            ),
            $codDue
        );
        $this->assertEquals(
            round((float) $order->rider_financed_amount * 0.2, 2),
            $receipt['totals']['tourism_office_share']
        );

        $submitUrl = '/api/rider/cash-fund/daily-receipt/submissions';
        $this->be($this->riderA)->postJson($submitUrl, [
            'date' => $date,
            'cash_remitted' => $codDue + 0.01,
            'office_cash_returned' => 0,
            'remittance_reference' => 'OVER-COD',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->be($this->riderA)->postJson($submitUrl, [
            'date' => $date,
            'cash_remitted' => 0,
            'office_cash_returned' => $cashAdvanceOutstanding + 0.01,
            'remittance_reference' => 'OVER-RETURN',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertDatabaseCount('rider_daily_reconciliations', 0);
        $this->assertDatabaseCount('rider_daily_cash_movements', 0);

        $firstSubmissionKey = (string) \Illuminate\Support\Str::uuid();
        $firstSubmission = $this->postJson($submitUrl, [
            'date' => $date,
            'cash_remitted' => $codDue,
            'office_cash_returned' => $cashAdvanceOutstanding,
            'remittance_reference' => 'DAILY-RECEIPT-001',
            'idempotency_key' => $firstSubmissionKey,
        ])->assertOk()->json('data');
        $this->assertEquals($codDue, (float) $firstSubmission['expected_cod_remittance']);
        $this->assertEquals($cashAdvanceOutstanding, (float) $firstSubmission['expected_office_cash_return']);
        $this->assertEquals($personalPurchasePayable, (float) $firstSubmission['expected_rider_payable']);

        $firstVerifyUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$firstSubmission['id'].'/verify';
        $this->be($this->admin)->postJson($firstVerifyUrl, [
            'cash_received' => $codDue + 0.01,
            'office_cash_returned' => $cashAdvanceOutstanding,
            'rider_reimbursement_paid' => $personalPurchasePayable,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->postJson($firstVerifyUrl, [
            'cash_received' => $codDue,
            'office_cash_returned' => $cashAdvanceOutstanding + 0.01,
            'rider_reimbursement_paid' => $personalPurchasePayable,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->postJson($firstVerifyUrl, [
            'cash_received' => $codDue,
            'office_cash_returned' => $cashAdvanceOutstanding,
            'rider_reimbursement_paid' => $personalPurchasePayable + 0.01,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertSame(0, RiderDailyCashMovement::count());
        $this->be($this->tourist)->postJson($firstVerifyUrl, [
            'cash_received' => $codDue,
            'office_cash_returned' => $cashAdvanceOutstanding,
            'rider_reimbursement_paid' => $personalPurchasePayable,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertForbidden();

        $firstActual = [
            'cash_received' => $codDue - 0.01,
            'office_cash_returned' => 50,
            'rider_reimbursement_paid' => 10,
            'note' => 'Physical count and reimbursement are partial.',
        ];
        $movementIdempotencyKey = (string) \Illuminate\Support\Str::uuid();
        $physicalCodMovement = $this->recordPhysicalMovement(
            $firstSubmission['id'],
            RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
            $firstActual['cash_received'],
            'PHYSICAL-COD-001',
            $movementIdempotencyKey
        );
        $physicalCodRetry = $this->recordPhysicalMovement(
            $firstSubmission['id'],
            RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
            $firstActual['cash_received'],
            'PHYSICAL-COD-001',
            $movementIdempotencyKey
        );
        $this->assertSame($physicalCodMovement['id'], $physicalCodRetry['id']);
        $this->recordPhysicalMovement($firstSubmission['id'], RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED, $firstActual['office_cash_returned'], 'PHYSICAL-RETURN-001');
        $this->recordPhysicalMovement($firstSubmission['id'], RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, $firstActual['rider_reimbursement_paid'], 'PHYSICAL-REIMBURSEMENT-001');
        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$firstSubmission['id'].'/movements',
            [
                'movement_type' => RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
                'amount' => $firstActual['cash_received'],
                'reference' => 'PHYSICAL-COD-001',
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Duplicate paper receipt reference.',
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            ]
        )->assertStatus(409);
        $this->assertDatabaseCount('rider_daily_cash_movements', 3);
        try {
            DB::table('rider_daily_cash_movements')->insert([
                'rider_id' => $this->riderA->id,
                'municipality_id' => $this->riderA->municipality_id,
                'business_date' => $date,
                'rider_daily_reconciliation_id' => $firstSubmission['id'],
                'revision' => 1,
                'movement_type' => RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
                'affects_type' => RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
                'amount' => '0.01',
                'recorded_by' => $this->admin->id,
                'transaction_at' => now(),
                'reference' => 'PHYSICAL-COD-001',
                'reference_fingerprint' => $physicalCodMovement['reference_fingerprint'],
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Duplicate paper receipt reference.',
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->fail('The movement reference unique index must reject a duplicate physical receipt.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('unique', strtolower($exception->getMessage()));
        }
        $firstActualKey = (string) \Illuminate\Support\Str::uuid();
        $firstVerified = $this->be($this->admin)->postJson($firstVerifyUrl, array_merge($firstActual, [
            'idempotency_key' => $firstActualKey,
        ]))->assertOk()->assertJsonPath('data.status', 'disputed')->json('data');
        $this->assertSame(3, RiderDailyCashMovement::where('rider_daily_reconciliation_id', $firstSubmission['id'])->count());
        $this->assertDatabaseHas('rider_daily_cash_movements', [
            'rider_daily_reconciliation_id' => $firstSubmission['id'],
            'movement_type' => RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
            'amount' => number_format($codDue - 0.01, 2, '.', ''),
            'recorded_by' => $this->admin->id,
        ]);
        $this->postJson($firstVerifyUrl, array_merge($firstActual, [
            'idempotency_key' => $firstActualKey,
        ]))->assertOk()->assertJsonPath('data.id', $firstSubmission['id']);
        $this->assertSame(3, RiderDailyCashMovement::where('rider_daily_reconciliation_id', $firstSubmission['id'])->count());
        $this->postJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$firstSubmission['id'].'/close', [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);

        $revisedSubmissionKey = (string) \Illuminate\Support\Str::uuid();
        $revisedSubmissionUrl = $submitUrl;
        $revisedSubmission = $this->be($this->riderA)->postJson($revisedSubmissionUrl, [
            'date' => $date,
            'cash_remitted' => 0.01,
            'office_cash_returned' => 50,
            'remittance_reference' => 'DAILY-RECEIPT-002',
            'idempotency_key' => $revisedSubmissionKey,
        ])->assertOk()->assertJsonPath('data.revision', 2)->json('data');
        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/movements',
            [
                'movement_type' => RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
                'amount' => 0.01,
                'reference' => 'PHYSICAL-COD-001',
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Duplicate reference on another revision.',
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            ]
        )->assertStatus(409);
        $this->be($this->riderA)->postJson($revisedSubmissionUrl, [
            'date' => $date,
            'cash_remitted' => 0.02,
            'office_cash_returned' => 50,
            'remittance_reference' => 'OVER-REMAINING-COD',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->be($this->riderA)->postJson($revisedSubmissionUrl, [
            'date' => $date,
            'cash_remitted' => 0,
            'office_cash_returned' => 50.01,
            'remittance_reference' => 'OVER-REMAINING-RETURN',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertSame(3, RiderDailyCashMovement::where('rider_daily_reconciliation_id', $firstSubmission['id'])->count());

        $revisedVerifyUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/verify';
        $this->be($this->admin)->postJson($revisedVerifyUrl, [
            'cash_received' => 0.01,
            'office_cash_returned' => 50,
            'rider_reimbursement_paid' => 10.01,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->postJson($revisedVerifyUrl, [
            'cash_received' => 0.02,
            'office_cash_returned' => 50,
            'rider_reimbursement_paid' => 10,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->postJson($revisedVerifyUrl, [
            'cash_received' => 0.01,
            'office_cash_returned' => 50.01,
            'rider_reimbursement_paid' => 10,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);

        $revisedVerifyPayload = [
            'cash_received' => 0.01,
            'office_cash_returned' => 50,
            'rider_reimbursement_paid' => 10,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            'note' => 'Remaining balances paid and verified.',
        ];
        $this->recordPhysicalMovement($revisedSubmission['id'], RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, 0.01, 'PHYSICAL-COD-002');
        $this->recordPhysicalMovement($revisedSubmission['id'], RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED, 50, 'PHYSICAL-RETURN-002');
        $this->recordPhysicalMovement($revisedSubmission['id'], RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, 10, 'PHYSICAL-REIMBURSEMENT-002');
        $revisedVerification = $this->postJson($revisedVerifyUrl, $revisedVerifyPayload)
            ->assertOk()->assertJsonPath('data.status', 'verified');
        $this->postJson($revisedVerifyUrl, $revisedVerifyPayload)
            ->assertOk()->assertJsonPath('data.status', 'verified');

        $this->assertSame(6, RiderDailyCashMovement::count());
        $this->assertEquals(
            $codDue,
            (float) RiderDailyCashMovement::query()
                ->whereRaw('COALESCE(affects_type, movement_type) = ?', [RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED])
                ->sum('amount')
        );
        $this->assertEquals(
            $cashAdvanceOutstanding,
            (float) RiderDailyCashMovement::query()
                ->whereRaw('COALESCE(affects_type, movement_type) = ?', [RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED])
                ->sum('amount')
        );
        $this->assertEquals(
            $personalPurchasePayable,
            (float) RiderDailyCashMovement::query()
                ->whereRaw('COALESCE(affects_type, movement_type) = ?', [RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID])
                ->sum('amount')
        );

        $closeUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/close';
        $closeKey = (string) \Illuminate\Support\Str::uuid();
        $this->postJson($closeUrl, ['idempotency_key' => $closeKey])->assertOk()->assertJsonPath('data.status', 'closed');
        $this->postJson($closeUrl, ['idempotency_key' => $closeKey])->assertOk()->assertJsonPath('data.status', 'closed');
        $this->assertSame('closed', RiderDailyReconciliation::findOrFail($revisedSubmission['id'])->status);

        $codMovement = RiderDailyCashMovement::query()
            ->where('rider_daily_reconciliation_id', $revisedSubmission['id'])
            ->where('movement_type', RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED)
            ->firstOrFail();
        $closedUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'];
        $originalClosure = RiderDailyReconciliation::findOrFail($revisedSubmission['id']);
        $originalVerifiedAt = $originalClosure->verified_at->toIso8601String();
        $originalClosedAt = $originalClosure->closed_at->toIso8601String();
        $reversalUrl = $closedUrl.'/movements/'.$codMovement->id.'/reverse';
        $reversalKey = (string) \Illuminate\Support\Str::uuid();
        $reversalPayload = [
            'reference' => 'CORRECTION-REV-001',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Receipt entry correction supported by signed cash count.',
            'idempotency_key' => $reversalKey,
        ];
        $reversal = $this->be($this->admin)->postJson($reversalUrl, $reversalPayload)
            ->assertOk()->json('data');
        $this->assertEquals(-0.01, (float) $reversal['amount']);
        $this->postJson($reversalUrl, [
            'reference' => 'DUPLICATE-REVERSAL',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Duplicate reversal attempt evidence.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertSame('disputed', RiderDailyReconciliation::findOrFail($firstSubmission['id'])->status);
        $this->assertSame('closed', RiderDailyReconciliation::findOrFail($revisedSubmission['id'])->status);
        $this->assertSame('pending_review', $this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$date
        )->assertOk()->json('data.reconciliation.corrections.0.status'));
        $this->assertFalse($this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$date
        )->json('data.reconciliation.is_finally_reconciled'));
        $adjustUrl = $closedUrl.'/movements/'.$codMovement->id.'/adjust';
        $adjustment = $this->postJson($adjustUrl, [
            'amount' => 0.01,
            'reference' => 'CORRECTION-ADJ-001',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'One-cent correction against the referenced receipt record.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertOk()->json('data');
        $this->assertSame(RiderDailyCashMovement::TYPE_ADJUSTMENT, $adjustment['movement_type']);
        $this->assertEquals(0.01, (float) $adjustment['amount']);
        $this->assertSame((int) $codMovement->id, (int) $adjustment['adjusts_movement_id']);
        $this->assertNotNull($codMovement->fresh());
        $this->assertDatabaseHas('rider_daily_reconciliation_events', [
            'rider_daily_reconciliation_id' => $revisedSubmission['id'],
            'action' => 'movement_reversed',
            'idempotency_key' => $reversalKey,
        ]);
        $this->assertDatabaseHas('rider_daily_reconciliation_events', [
            'rider_daily_reconciliation_id' => $revisedSubmission['id'],
            'action' => 'movement_adjusted',
        ]);

        $correctionId = $adjustment['correction_cycle_id'];
        $correctionPath = $closedUrl.'/corrections/'.$correctionId;
        $this->be($this->riderA)->postJson($correctionPath.'/review', [
            'decision' => 'approve',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertForbidden();
        $this->be($this->admin)->postJson($correctionPath.'/review', [
            'decision' => 'approve',
            'note' => 'Reviewed corrected cumulative balances.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertOk()->assertJsonPath('data.status', 'reviewed');
        $this->postJson($correctionPath.'/close', [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertOk()->assertJsonPath('data.status', 'closed');
        $this->assertSame('closed', $originalClosure->fresh()->status);
        $this->assertSame($originalVerifiedAt, $originalClosure->fresh()->verified_at->toIso8601String());
        $this->assertSame($originalClosedAt, $originalClosure->fresh()->closed_at->toIso8601String());
        $this->assertTrue($this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$date
        )->assertOk()->json('data.reconciliation.is_finally_reconciled'));

        $subsequentAdjustment = $this->postJson($adjustUrl, [
            'amount' => -0.01,
            'reference' => 'CORRECTION-ADJ-002',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Further correction after corrected closure.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertOk()->json('data');
        $this->assertNotSame($correctionId, $subsequentAdjustment['correction_cycle_id']);
        $this->assertSame('pending_review', $this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$date
        )->json('data.reconciliation.corrections.2.status'));
        $this->assertFalse($this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$date
        )->json('data.reconciliation.is_finally_reconciled'));
        $this->postJson($adjustUrl, [
            'amount' => 0.02,
            'reference' => 'CORRECTION-ADJ-EXCESS',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Adjustment exceeds the authoritative remaining COD balance.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);

        $beforeClosedMovementCount = RiderDailyCashMovement::count();
        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/movements',
            [
                'movement_type' => RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
                'amount' => 0.01,
                'reference' => 'CLOSED-RECEIPT-001',
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Physical transfer evidence.',
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            ]
        )->assertStatus(409);
        $this->assertSame($beforeClosedMovementCount, RiderDailyCashMovement::count());

        config(['cod_cash.reconciliation_enabled' => false]);
        $beforeDisabledMutationCount = RiderDailyCashMovement::count();
        $this->be($this->riderA)->postJson($submitUrl, [
            'date' => $date,
            'cash_remitted' => 0,
            'office_cash_returned' => 0,
            'remittance_reference' => 'DISABLED-FEATURE',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/movements',
            [
                'movement_type' => RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED,
                'amount' => 0.01,
                'reference' => 'DISABLED-MOVEMENT-001',
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Physical transfer evidence.',
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            ]
        )->assertStatus(409);
        $this->be($this->admin)->postJson($revisedVerifyUrl, array_merge($revisedVerifyPayload, [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);
        $this->postJson($closeUrl, ['idempotency_key' => (string) \Illuminate\Support\Str::uuid()])
            ->assertStatus(409);
        $officeMovement = RiderDailyCashMovement::query()
            ->where('rider_daily_reconciliation_id', $revisedSubmission['id'])
            ->where('movement_type', RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED)
            ->firstOrFail();
        $this->postJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/movements/'.$officeMovement->id.'/reverse', [
            'reference' => 'DISABLED-REVERSAL',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Must remain gated.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->postJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/movements/'.$officeMovement->id.'/adjust', [
            'amount' => -0.01,
            'reference' => 'DISABLED-ADJUSTMENT',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Must remain gated.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertSame($beforeDisabledMutationCount, RiderDailyCashMovement::count());
        $this->assertSame('closed', RiderDailyReconciliation::findOrFail($revisedSubmission['id'])->status);

        try {
            RiderDailyCashMovement::create(array_merge($codMovement->getAttributes(), [
                'id' => null,
                'idempotency_key' => $codMovement->idempotency_key,
            ]));
            $this->fail('The movement idempotency key must be unique at the database layer.');
        } catch (\Illuminate\Database\QueryException) {
            $this->assertSame($beforeDisabledMutationCount, RiderDailyCashMovement::count());
        }
    }

    public function test_daily_cash_movement_migration_supports_sqlite_up_and_down(): void
    {
        $migration = require database_path('migrations/2026_10_30_000004_create_rider_daily_cash_movements.php');

        $this->assertTrue(Schema::hasTable('rider_daily_cash_movements'));
        $this->assertTrue(Schema::hasColumn('rider_daily_cash_movements', 'idempotency_key'));
        $migration->down();
        $this->assertFalse(Schema::hasTable('rider_daily_cash_movements'));
        $migration->up();
        $this->assertTrue(Schema::hasTable('rider_daily_cash_movements'));
        $this->assertTrue(Schema::hasColumn('rider_daily_cash_movements', 'reverses_movement_id'));
    }

    public function test_cash_fund_returns_work_without_cod_reconciliation_and_roll_forward_cumulatively(): void
    {
        [, $issueDate] = $this->createCompletedCodDelivery(0, 100);
        $this->be($this->admin)->postJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns', [
            'amount' => 1,
            'transaction_at' => now('Asia/Manila')->format('Y-m-d\TH:i'),
            'reference' => 'INACTIVE-CASH-RETURN',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Inactive feature must not record a return.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertSame(0, RiderDailyCashMovement::count());
        config([
            'cod_cash.reconciliation_enabled' => true,
            'cod_cash.effective_date' => $issueDate,
        ]);
        $legacyReturnDate = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $issueDate, 'Asia/Manila')
            ->subDay()
            ->setTime(12, 0);
        $this->be($this->admin)->postJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns', [
            'amount' => 1,
            'transaction_at' => $legacyReturnDate->format('Y-m-d\TH:i'),
            'reference' => 'LEGACY-CASH-RETURN',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Historical policy date must remain gated.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $returnAt = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $issueDate, 'Asia/Manila')
            ->addDay()
            ->setTime(9, 0);
        $returnDate = $returnAt->toDateString();
        \Carbon\Carbon::setTestNow($returnAt->setTime(12, 0));
        $url = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns';

        $this->be($this->riderA)->postJson($url, [
            'amount' => 30,
            'transaction_at' => $returnAt->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-001',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Receipt counter return slip, signed by rider.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertForbidden();

        $otherMunicipality = Municipality::create([
            'name' => 'Calapan',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 13.4,
            'longitude' => 121.2,
        ]);
        $otherOfficer = User::create([
            'email' => 'calapan-office@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
            'municipality_id' => $otherMunicipality->id,
        ]);
        $this->be($otherOfficer)->postJson($url, [
            'amount' => 30,
            'transaction_at' => $returnAt->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-001',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Receipt counter return slip, signed by rider.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertForbidden();

        $this->be($this->admin)->postJson($url, [
            'amount' => 30,
            'transaction_at' => $returnAt->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-001',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Receipt counter return slip, signed by rider.',
            'idempotency_key' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ])->assertOk()->assertJsonPath('data.rider_daily_reconciliation_id', null);
        $firstReturnId = RiderDailyCashMovement::query()->where('reference', 'OFFICE-RETURN-001')->value('id');
        $firstReturn = RiderDailyCashMovement::findOrFail($firstReturnId);
        $this->assertSame($returnDate, $firstReturn->business_date->toDateString());
        $this->assertSame($this->admin->id, $firstReturn->recorded_by);
        $this->assertNull($firstReturn->rider_daily_reconciliation_id);
        $this->assertNotNull($firstReturn->transaction_at);
        $this->assertSame('office_receipt', $firstReturn->reference_type);
        $this->assertSame('bansud-tourism-office', $firstReturn->reference_source);
        $this->assertSame('Bansud Tourism Office', $firstReturn->reference_issuer);
        $this->assertSame('Official Receipt Book A', $firstReturn->reference_series);
        $this->assertSame('OFFICE-RETURN-001', $firstReturn->normalized_reference);

        $this->postJson($url, [
            'amount' => 30,
            'transaction_at' => $returnAt->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-001',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Receipt counter return slip, signed by rider.',
            'idempotency_key' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ])->assertOk()->assertJsonPath('data.id', $firstReturnId);
        $this->postJson($url, [
            'amount' => 30,
            'transaction_at' => $returnAt->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-001',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Duplicate receipt retry with new key.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);

        $returnReceipt = $this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$returnDate
        )->assertOk()->json('data');
        $this->assertSame(0, $returnReceipt['totals']['eligible_delivery_count']);
        $this->assertEquals(70, $returnReceipt['totals']['unreturned_tourism_office_cash_balance']);
        $this->assertEquals(30, $returnReceipt['totals']['tourism_office_cash_returned_to_date']);
        $this->assertNull($returnReceipt['reconciliation']);
        $this->assertSame(0, RiderDailyReconciliation::count());

        $this->postJson($url, [
            'amount' => 70.01,
            'transaction_at' => $returnAt->setTime(9, 30)->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-OVER',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Over-return attempt.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);

        $this->postJson($url, [
            'amount' => 40,
            'transaction_at' => $returnAt->setTime(10, 0)->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-002',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Second partial cash return.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertOk();
        $this->postJson($url, [
            'amount' => 40,
            'transaction_at' => $returnAt->setTime(10, 1)->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-003',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Simultaneous competing return claim.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->postJson($url, [
            'amount' => 30,
            'transaction_at' => $returnAt->setTime(11, 0)->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-004',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Final partial return clears the outstanding advance.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertOk();
        $this->postJson($url, [
            'amount' => 0.01,
            'transaction_at' => $returnAt->setTime(11, 30)->format('Y-m-d\TH:i'),
            'reference' => 'OFFICE-RETURN-005',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Excess after fully returned advance.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);

        $followingDate = $returnAt->addDay()->toDateString();
        $followingReceipt = $this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$followingDate
        )->assertOk()->json('data');
        $this->assertEquals(0, $followingReceipt['totals']['unreturned_tourism_office_cash_balance']);
        $this->assertEquals(100, $followingReceipt['totals']['tourism_office_cash_returned_to_date']);
        $this->assertSame(3, RiderDailyCashMovement::query()
            ->where('rider_id', $this->riderA->id)
            ->where('movement_type', RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED)
            ->count());
        $this->be($this->admin)
            ->getJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund?date='.$returnDate)
            ->assertOk()
            ->assertJsonPath('data.totals.cash_fund_returned_today', 100)
            ->assertJsonPath('data.totals.cash_fund_returned_to_date', 100)
            ->assertJsonPath('data.totals.unreturned_cash_fund_balance', 0)
            ->assertJsonCount(3, 'data.cash_movements');

        $finalReturn = RiderDailyCashMovement::query()->where('reference', 'OFFICE-RETURN-004')->firstOrFail();
        $reverseUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns/'.$finalReturn->id.'/reverse';
        $reversalPayload = [
            'reference' => 'OFFICE-RETURN-004-REV',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Signed correction record for the cash return entry.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ];
        $reversal = $this->postJson($reverseUrl, $reversalPayload)->assertOk()->json('data');
        $this->assertEquals(-30, (float) $reversal['amount']);
        $this->assertSame((int) $finalReturn->id, (int) $reversal['reverses_movement_id']);
        $this->assertEquals(30, (float) $finalReturn->fresh()->amount);
        $this->postJson($reverseUrl, array_merge($reversalPayload, [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);
        $this->getJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$returnDate)
            ->assertOk()
            ->assertJsonPath('data.totals.unreturned_tourism_office_cash_balance', 30);
    }

    public function test_cash_reference_namespaces_normalize_and_scope_duplicates_to_issuer_or_provider(): void
    {
        [, $issueDate] = $this->createCompletedCodDelivery(0, 100);
        $this->createFundForRider($this->riderB, 50, $issueDate, 'RIDER-B-REFERENCE-FUND');
        $issuedAt = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $issueDate, 'Asia/Manila')
            ->setTime(8, 0);
        \Carbon\Carbon::setTestNow($issuedAt->addDay()->setTime(12, 0));
        config([
            'cod_cash.reconciliation_enabled' => true,
            'cod_cash.effective_date' => $issueDate,
        ]);
        $urlA = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns';
        $urlB = '/api/admin/riders/'.$this->riderB->id.'/cash-fund/returns';
        $returnAt = $issuedAt->setTime(9, 0)->format('Y-m-d\TH:i');

        $basePayload = [
            'amount' => 1,
            'transaction_at' => $returnAt,
            'reference' => 'OR-0042',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Scanned office receipt and signed cash count.',
        ];
        $this->be($this->admin)->postJson($urlA, array_merge($basePayload, [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertOk();
        $this->postJson($urlA, array_merge($basePayload, [
            'reference' => ' or-0042 ',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);
        $this->postJson($urlA, array_merge($basePayload, [
            'reference_namespace' => 'office-receipts-other-issuer',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertOk();
        $this->postJson($urlA, array_merge($basePayload, [
            'reference_namespace' => 'office-receipts-other-series',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertOk();

        $providerPayload = [
            'amount' => 1,
            'transaction_at' => $returnAt,
            'reference' => 'PAYMONGO-REF-77',
            'reference_namespace' => 'paymongo',
            'evidence_details' => '',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ];
        $this->postJson($urlA, $providerPayload)->assertOk()
            ->assertJsonPath('data.reference_type', 'provider_transaction')
            ->assertJsonPath('data.reference_source', 'paymongo');
        $this->postJson($urlB, array_merge($providerPayload, [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);

        $nextDate = $issuedAt->addDay();
        \Carbon\Carbon::setTestNow($nextDate->setTime(12, 0));
        $this->postJson($urlA, array_merge($providerPayload, [
            'transaction_at' => $nextDate->setTime(10, 0)->format('Y-m-d\TH:i'),
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);

        $this->postJson($urlA, array_merge($basePayload, [
            'reference' => 'MANUAL-REF-1',
            'reference_namespace' => 'manual-cash-log',
            'evidence_details' => '',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);
    }

    public function test_reference_namespaces_and_correction_review_migration_support_sqlite_up_and_down(): void
    {
        $migration = require database_path('migrations/2026_10_30_000005_add_cash_reference_namespaces_and_correction_reviews.php');

        $this->assertTrue(Schema::hasColumn('rider_daily_cash_movements', 'reference_fingerprint'));
        $this->assertTrue(Schema::hasTable('rider_daily_reconciliation_corrections'));
        $migration->down();
        $this->assertFalse(Schema::hasColumn('rider_daily_cash_movements', 'reference_fingerprint'));
        $this->assertFalse(Schema::hasTable('rider_daily_reconciliation_corrections'));
        $migration->up();
        $this->assertTrue(Schema::hasColumn('rider_daily_cash_movements', 'reference_fingerprint'));
        $this->assertTrue(Schema::hasColumn('rider_daily_cash_movements', 'correction_cycle_id'));
        $this->assertTrue(Schema::hasTable('rider_daily_reconciliation_corrections'));

        $linksMigration = require database_path('migrations/2026_10_31_000001_link_cash_movements_to_correction_cycles.php');
        $this->assertTrue(Schema::hasTable('rider_daily_cash_movement_correction_cycles'));
        $linksMigration->down();
        $this->assertFalse(Schema::hasTable('rider_daily_cash_movement_correction_cycles'));
        $linksMigration->up();
        $this->assertTrue(Schema::hasTable('rider_daily_cash_movement_correction_cycles'));
    }

    public function test_standalone_return_reversal_creates_review_cycles_for_every_affected_closed_date(): void
    {
        $workingDate = now('Asia/Manila')->toDateString();
        $nextDate = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $workingDate, 'Asia/Manila')->addDay()->toDateString();
        $thirdDate = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $workingDate, 'Asia/Manila')->addDays(2)->toDateString();
        $earlierDate = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $workingDate, 'Asia/Manila')->subDay()->toDateString();
        $this->enableDailyCashPolicy($workingDate);
        \Carbon\Carbon::setTestNow(\Carbon\CarbonImmutable::parse($workingDate.' 12:00:00', 'Asia/Manila'));
        [, $deliveryDate] = $this->createCompletedCodDelivery(0, 100);
        $this->assertSame($workingDate, $deliveryDate);

        $return = $this->recordTestCashFundReturn($this->riderA, $workingDate, 'RETURN-MULTI-DATE', 1);
        $affected = [
            $this->createClosedDailyReconciliation($this->riderA, $workingDate),
            $this->createClosedDailyReconciliation($this->riderA, $nextDate),
            $this->createClosedDailyReconciliation($this->riderA, $thirdDate),
        ];
        $earlier = $this->createClosedDailyReconciliation($this->riderA, $earlierDate);
        $otherRider = $this->createClosedDailyReconciliation($this->riderB, $nextDate);
        $originalVerifiedAt = $affected[0]->verified_at->toIso8601String();
        $originalClosedAt = $affected[0]->closed_at->toIso8601String();

        $reverseUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns/'.$return->id.'/reverse';
        $payload = [
            'reference' => 'RETURN-MULTI-DATE-REV',
            'reference_namespace' => 'office-receipts',
            'evidence_details' => 'Signed correction against the original office return receipt.',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ];
        $this->be($this->riderA)->postJson($reverseUrl, $payload)->assertForbidden();
        $otherMunicipality = Municipality::create([
            'name' => 'Calapan',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 13.4,
            'longitude' => 121.2,
        ]);
        $otherOffice = User::create([
            'email' => 'calapan-reversal-office@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
            'municipality_id' => $otherMunicipality->id,
        ]);
        $this->be($otherOffice)->postJson($reverseUrl, $payload)->assertForbidden();
        $reversalResponse = $this->be($this->admin)->postJson($reverseUrl, $payload)->assertOk();
        $reversal = RiderDailyCashMovement::findOrFail($reversalResponse->json('data.id'));

        $this->assertSame('-1.00', $reversal->amount);
        $this->assertSame($return->id, $reversal->reverses_movement_id);
        $this->assertSame('1.00', $return->fresh()->amount);
        $this->assertCount(3, $reversal->correctionCycles);
        foreach ($affected as $reconciliation) {
            $reconciliation->refresh();
            $this->assertSame('closed', $reconciliation->status);
            $this->assertSame($originalVerifiedAt, $reconciliation->verified_at->toIso8601String());
            $this->assertSame($originalClosedAt, $reconciliation->closed_at->toIso8601String());
            $this->assertSame(1, $reconciliation->corrections()->count());
            $receipt = $this->getJson(
                '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$reconciliation->working_date->toDateString()
            )->assertOk()->json('data');
            $this->assertSame(
                'pending_review',
                $receipt['reconciliation']['corrections'][0]['status']
            );
            $this->assertFalse($receipt['reconciliation']['is_finally_reconciled']);
            $this->assertContains($reversal->id, $receipt['reconciliation']['corrections'][0]['movement_ids']);
            $linkedReversal = collect($receipt['financial_movements'])->firstWhere('id', $reversal->id);
            $this->assertContains(
                $reconciliation->corrections()->firstOrFail()->id,
                $linkedReversal['correction_cycle_ids']
            );
        }
        $this->assertSame(0, $earlier->corrections()->count());
        $this->assertSame(0, $otherRider->corrections()->count());
        $this->assertTrue($this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$earlierDate
        )->assertOk()->json('data.reconciliation.is_finally_reconciled'));
        $this->assertTrue($this->getJson(
            '/api/admin/riders/'.$this->riderB->id.'/cash-fund/daily-receipt?date='.$nextDate
        )->assertOk()->json('data.reconciliation.is_finally_reconciled'));

        $this->be($this->admin)->postJson($reverseUrl, $payload)
            ->assertOk()
            ->assertJsonPath('data.id', $reversal->id);
        $this->postJson($reverseUrl, array_merge($payload, [
            'reference' => 'RETURN-MULTI-DATE-REV-2',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);
        $this->assertSame(1, RiderDailyCashMovement::query()->where('reverses_movement_id', $return->id)->count());
        $this->assertSame(3, DB::table('rider_daily_cash_movement_correction_cycles')
            ->where('movement_id', $reversal->id)
            ->count());
    }

    public function test_standalone_return_reversal_rolls_back_if_a_correction_cycle_cannot_be_created(): void
    {
        $workingDate = now('Asia/Manila')->toDateString();
        $this->enableDailyCashPolicy($workingDate);
        \Carbon\Carbon::setTestNow(\Carbon\CarbonImmutable::parse($workingDate.' 12:00:00', 'Asia/Manila'));
        $this->createCompletedCodDelivery(0, 100);
        $return = $this->recordTestCashFundReturn($this->riderA, $workingDate, 'RETURN-ROLLBACK', 1);
        $this->createClosedDailyReconciliation($this->riderA, $workingDate);

        $this->assertSame('sqlite', DB::connection()->getDriverName());
        DB::statement("CREATE TRIGGER fail_correction_cycle_insert BEFORE INSERT ON rider_daily_reconciliation_corrections BEGIN SELECT RAISE(ABORT, 'forced correction-cycle insert failure'); END");
        try {
            $this->be($this->admin)->postJson(
                '/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns/'.$return->id.'/reverse',
                [
                    'reference' => 'RETURN-ROLLBACK-REV',
                    'reference_namespace' => 'office-receipts',
                    'evidence_details' => 'Rollback probe for reversal plus correction atomicity.',
                    'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
                ]
            )->assertServerError();
        } finally {
            DB::statement('DROP TRIGGER IF EXISTS fail_correction_cycle_insert');
        }

        $this->assertSame(0, RiderDailyCashMovement::query()->where('reverses_movement_id', $return->id)->count());
        $this->assertSame(0, $return->fresh()->correctionCycles()->count());
        $this->assertSame(0, RiderDailyReconciliationCorrection::count());
    }

    public function test_correction_closure_rejects_stale_snapshot_and_preserves_review_history(): void
    {
        $workingDate = now('Asia/Manila')->toDateString();
        $this->enableDailyCashPolicy($workingDate);
        \Carbon\Carbon::setTestNow(\Carbon\CarbonImmutable::parse($workingDate.' 12:00:00', 'Asia/Manila'));
        $this->createCompletedCodDelivery(0, 100);
        $reconciliation = $this->createClosedDailyReconciliation($this->riderA, $workingDate);
        $correction = $this->createReviewedCorrection($reconciliation);
        $reviewedAt = $correction->reviewed_at->toIso8601String();

        $return = $this->recordTestCashFundReturn($this->riderA, $workingDate, 'RETURN-AFTER-REVIEW', 1);
        $response = $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$reconciliation->id.'/corrections/'.$correction->id.'/close',
            ['idempotency_key' => (string) \Illuminate\Support\Str::uuid()]
        )->assertStatus(409);
        $this->assertStringContainsString('review again', strtolower($response->json('message')));
        $correction->refresh();
        $this->assertSame('pending_review', $correction->status);
        $this->assertSame($this->admin->id, $correction->reviewed_by);
        $this->assertSame($reviewedAt, $correction->reviewed_at->toIso8601String());
        $this->assertSame('1.00', $return->fresh()->amount);
        $this->assertSame(1, RiderDailyCashMovement::query()->whereKey($return->id)->count());
        $this->assertDatabaseHas('rider_daily_reconciliation_events', [
            'rider_daily_reconciliation_id' => $reconciliation->id,
            'action' => 'correction_review_stale',
        ]);
        $this->assertSame('closed', $reconciliation->fresh()->status);
        $this->assertNotNull($reconciliation->fresh()->closed_at);

        app(RiderDailyReconciliationService::class)->reviewCorrection(
            $this->admin,
            $correction->fresh(),
            'approve',
            'Reviewed after the return was recorded.',
            (string) \Illuminate\Support\Str::uuid()
        );
        $this->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$reconciliation->id.'/corrections/'.$correction->id.'/close',
            ['idempotency_key' => (string) \Illuminate\Support\Str::uuid()]
        )->assertOk()->assertJsonPath('data.status', 'closed');
    }

    public function test_standalone_return_reversal_after_review_requires_a_new_correction_review(): void
    {
        $workingDate = now('Asia/Manila')->toDateString();
        $this->enableDailyCashPolicy($workingDate);
        \Carbon\Carbon::setTestNow(\Carbon\CarbonImmutable::parse($workingDate.' 12:00:00', 'Asia/Manila'));
        $this->createCompletedCodDelivery(0, 100);
        $return = $this->recordTestCashFundReturn($this->riderA, $workingDate, 'RETURN-BEFORE-REVIEW', 1);
        $reconciliation = $this->createClosedDailyReconciliation($this->riderA, $workingDate);
        $correction = $this->createReviewedCorrection($reconciliation);

        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/returns/'.$return->id.'/reverse',
            [
                'reference' => 'RETURN-AFTER-REVIEW-REV',
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Return reversal after review to invalidate its snapshot.',
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            ]
        )->assertOk();

        $this->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$reconciliation->id.'/corrections/'.$correction->id.'/close',
            ['idempotency_key' => (string) \Illuminate\Support\Str::uuid()]
        )->assertStatus(409);
        $this->assertSame('superseded', $correction->fresh()->status);
        $this->assertSame(
            'pending_review',
            $reconciliation->corrections()->orderByDesc('cycle_number')->firstOrFail()->status
        );
        $this->assertFalse($this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$workingDate
        )->assertOk()->json('data.reconciliation.is_finally_reconciled'));
    }

    public function test_correction_snapshot_detects_cod_and_reimbursement_movements_even_when_net_is_unchanged(): void
    {
        $workingDate = now('Asia/Manila')->toDateString();
        $this->enableDailyCashPolicy($workingDate);
        \Carbon\Carbon::setTestNow(\Carbon\CarbonImmutable::parse($workingDate.' 12:00:00', 'Asia/Manila'));
        $this->createCompletedCodDelivery(1);
        $reconciliation = $this->createClosedDailyReconciliation($this->riderA, $workingDate);
        $correction = $this->createReviewedCorrection($reconciliation);

        $this->createTestMovement($this->riderA, $workingDate, RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, '1.00');
        $this->createTestMovement($this->riderA, $workingDate, RiderDailyCashMovement::TYPE_ADJUSTMENT, RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, '-1.00');
        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$reconciliation->id.'/corrections/'.$correction->id.'/close',
            ['idempotency_key' => (string) \Illuminate\Support\Str::uuid()]
        )->assertStatus(409);
        $this->assertSame('pending_review', $correction->fresh()->status);
        $staleEvent = $reconciliation->events()->where('action', 'correction_review_stale')->latest('id')->firstOrFail();
        $this->assertSame(
            $staleEvent->details['reviewed_balance_snapshot']['outstanding_cod_remittance'],
            $staleEvent->details['current_balance_snapshot']['outstanding_cod_remittance']
        );
        $this->assertNotSame(
            $staleEvent->details['reviewed_balance_snapshot']['cod_receipts_recorded'],
            $staleEvent->details['current_balance_snapshot']['cod_receipts_recorded']
        );
        $this->assertNotSame(
            $staleEvent->details['reviewed_balance_snapshot']['signed_adjustments']['cod_remittance'],
            $staleEvent->details['current_balance_snapshot']['signed_adjustments']['cod_remittance']
        );

        $reimbursementCorrection = $this->createReviewedCorrection(
            $this->createClosedDailyReconciliation($this->riderA, $workingDate)
        );
        $this->createTestMovement($this->riderA, $workingDate, RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, '0.01');
        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$reimbursementCorrection->rider_daily_reconciliation_id.'/corrections/'.$reimbursementCorrection->id.'/close',
            ['idempotency_key' => (string) \Illuminate\Support\Str::uuid()]
        )->assertStatus(409);
        $this->assertSame('pending_review', $reimbursementCorrection->fresh()->status);
    }

    public function test_unchanged_correction_snapshot_can_be_closed(): void
    {
        $workingDate = now('Asia/Manila')->toDateString();
        $this->enableDailyCashPolicy($workingDate);
        $reconciliation = $this->createClosedDailyReconciliation($this->riderA, $workingDate);
        $correction = $this->createReviewedCorrection($reconciliation);
        $snapshot = $correction->balance_snapshot;

        $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$reconciliation->id.'/corrections/'.$correction->id.'/close',
            ['idempotency_key' => (string) \Illuminate\Support\Str::uuid()]
        )->assertOk()->assertJsonPath('data.status', 'closed');
        $this->assertSame($snapshot, $correction->fresh()->balance_snapshot);
        $this->assertTrue($this->getJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$workingDate
        )->assertOk()->json('data.reconciliation.is_finally_reconciled'));
    }

    public function test_verified_purchase_expense_records_office_and_personal_funding_separately(): void
    {
        Storage::fake('local');
        [, , $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);
        $this->be($this->admin)->postJson('/api/admin/deliveries/'.$delivery->id.'/issue-purchasing-cash')->assertOk();
        $this->be($this->riderA)->postJson('/api/rider/deliveries/'.$delivery->id.'/purchasing-cash/receive')->assertOk();

        $purchase = CodPurchase::where('delivery_id', $delivery->id)->orderBy('id')->firstOrFail();
        $this->be($this->riderA)
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/mark', ['status' => 'purchased'])
            ->assertOk();

        $url = '/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expense';
        $payload = [
            'actual_purchase_amount' => 130,
            'tourism_office_cash_used' => 100,
            'rider_personal_contribution' => 30,
            'receipt' => UploadedFile::fake()->image('restaurant-receipt.jpg'),
        ];
        $submitted = $this->post($url, $payload, ['Accept' => 'application/json'])->assertOk();
        $expenseId = $submitted->json('data.id');
        $expense = CodPurchaseExpense::findOrFail($expenseId);
        $this->assertSame(CodPurchaseExpense::STATUS_SUBMITTED, $expense->status);
        Storage::disk('local')->assertExists($expense->receipt_path);

        $duplicate = $this->post($url, [
            ...$payload,
            'receipt' => UploadedFile::fake()->image('duplicate-receipt.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();
        $this->assertSame($expenseId, $duplicate->json('data.id'));
        $this->assertCount(1, CodPurchaseExpense::where('cod_purchase_id', $purchase->id)->get());

        $reviewUrl = '/api/admin/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expenses/'.$expenseId.'/verify';
        $verified = $this->be($this->admin)->postJson($reviewUrl)->assertOk();
        $this->assertSame(CodPurchaseExpense::STATUS_VERIFIED, $verified->json('data.status'));
        $this->assertSame($this->admin->id, $expense->fresh()->verified_by);
        $this->get('/api/admin/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expenses/'.$expenseId.'/receipt')
            ->assertOk();

        $transactions = RiderCashFundTransaction::where('cod_purchase_expense_id', $expenseId)->get();
        $this->assertCount(2, $transactions);
        $this->assertEquals(100, (float) $transactions->firstWhere('type', RiderCashFundTransaction::TYPE_PURCHASE_OFFICE_CASH_USED)->amount);
        $this->assertEquals(30, (float) $transactions->firstWhere('type', RiderCashFundTransaction::TYPE_RIDER_PERSONAL_CONTRIBUTION)->amount);

        $ledger = $this->getJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund?date='.now('Asia/Manila')->toDateString())
            ->assertOk()
            ->json('data');
        $this->assertEquals(100, $ledger['totals']['tourism_office_cash_used']);
        $this->assertEquals(30, $ledger['totals']['rider_personal_contribution']);
    }

    public function test_purchase_expense_requires_exact_funding_reconciliation_and_a_receipt(): void
    {
        [, , $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);
        $this->be($this->admin)->postJson('/api/admin/deliveries/'.$delivery->id.'/issue-purchasing-cash')->assertOk();
        $this->be($this->riderA)->postJson('/api/rider/deliveries/'.$delivery->id.'/purchasing-cash/receive')->assertOk();

        $purchase = CodPurchase::where('delivery_id', $delivery->id)->orderBy('id')->firstOrFail();
        $this->be($this->riderA)
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/mark', ['status' => 'purchased'])
            ->assertOk();

        $this->post('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expense', [
            'actual_purchase_amount' => 130,
            'tourism_office_cash_used' => 100,
            'rider_personal_contribution' => 20,
            'receipt' => UploadedFile::fake()->image('receipt.jpg'),
        ], ['Accept' => 'application/json'])->assertStatus(422);

        $this->assertDatabaseMissing('cod_purchase_expenses', ['cod_purchase_id' => $purchase->id]);
    }

    public function test_verified_office_funding_cannot_exceed_cash_issued_and_rejected_claims_keep_history(): void
    {
        Storage::fake('local');
        [, , $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);
        $this->be($this->admin)->postJson('/api/admin/deliveries/'.$delivery->id.'/issue-purchasing-cash')->assertOk();
        $this->be($this->riderA)->postJson('/api/rider/deliveries/'.$delivery->id.'/purchasing-cash/receive')->assertOk();

        $purchase = CodPurchase::where('delivery_id', $delivery->id)->orderBy('id')->firstOrFail();
        $this->be($this->riderA)
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/mark', ['status' => 'purchased'])
            ->assertOk();

        $url = '/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expense';
        $submitted = $this->post($url, [
            'actual_purchase_amount' => 100000,
            'tourism_office_cash_used' => 100000,
            'rider_personal_contribution' => 0,
            'receipt' => UploadedFile::fake()->image('receipt.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();
        $expenseId = $submitted->json('data.id');

        $reviewUrl = '/api/admin/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expenses/'.$expenseId.'/verify';
        $this->be($this->admin)->postJson($reviewUrl)->assertStatus(422);
        $this->assertSame(CodPurchaseExpense::STATUS_SUBMITTED, CodPurchaseExpense::findOrFail($expenseId)->status);
        $this->assertDatabaseMissing('rider_cash_fund_transactions', ['cod_purchase_expense_id' => $expenseId]);

        $rejectUrl = '/api/admin/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/expenses/'.$expenseId.'/reject';
        $this->postJson($rejectUrl, ['reason' => 'Receipt amount is not supported by the cash advance.'])->assertOk();
        $retry = $this->be($this->riderA)->post($url, [
            'actual_purchase_amount' => 120,
            'tourism_office_cash_used' => 100,
            'rider_personal_contribution' => 20,
            'receipt' => UploadedFile::fake()->image('corrected-receipt.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame(2, $retry->json('data.revision'));
        $this->assertSame(CodPurchaseExpense::STATUS_REJECTED, CodPurchaseExpense::findOrFail($expenseId)->status);
        $this->assertCount(2, CodPurchaseExpense::where('cod_purchase_id', $purchase->id)->get());
    }

    public function test_additional_cash_issuance_is_idempotent_and_requires_a_new_receipt_acknowledgement(): void
    {
        [, , $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);
        $this->be($this->admin)->postJson('/api/admin/deliveries/'.$delivery->id.'/issue-purchasing-cash')->assertOk();
        $this->be($this->riderA)->postJson('/api/rider/deliveries/'.$delivery->id.'/purchasing-cash/receive')->assertOk();

        $key = (string) \Illuminate\Support\Str::uuid();
        $url = '/api/admin/deliveries/'.$delivery->id.'/purchasing-cash/additional';
        $payload = ['amount' => 50, 'idempotency_key' => $key];
        $first = $this->be($this->admin)->postJson($url, $payload)->assertOk();
        $retry = $this->postJson($url, $payload)->assertOk();
        $this->assertSame($first->json('data.reference_number'), $retry->json('data.reference_number'));
        $this->assertCount(1, RiderCashFundTransaction::where('idempotency_key', $key)->get());

        $purchase = CodPurchase::where('delivery_id', $delivery->id)->orderBy('id')->firstOrFail();
        $this->be($this->riderA)
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/mark', ['status' => 'purchased'])
            ->assertStatus(422);

        $this->postJson('/api/rider/deliveries/'.$delivery->id.'/purchasing-cash/receive')->assertOk();
        $this->postJson('/api/rider/deliveries/'.$delivery->id.'/purchases/'.$purchase->id.'/mark', ['status' => 'purchased'])->assertOk();
    }

    public function test_rider_cash_fund_ledger_is_scoped_to_the_officers_municipality(): void
    {
        $otherMunicipality = Municipality::create([
            'name' => 'Other Municipality',
            'district' => '2nd',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);
        $this->riderA->update(['municipality_id' => $otherMunicipality->id]);

        $this->be($this->admin)
            ->getJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund')
            ->assertForbidden();
    }

    public function test_purchases_are_ordered_by_preparation_time_with_origin_and_dropoff(): void
    {
        $this->restaurantA->update(['address' => 'Restaurant A St']);
        $this->restaurantB->update(['address' => 'Restaurant B St']);

        // Restaurant A items prep in 5 & 10 min; Restaurant B in 20 & 25 min.
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00, 5);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 80.00, 10);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00, 20);
        $pasta = $this->makeOffering($this->restaurantB, 'Pasta', 250.00, 25);

        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
                ['offering_id' => $fries->id, 'quantity' => 1, 'notes' => null],
            ]],
            ['business_id' => $this->restaurantB->id, 'items' => [
                ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
                ['offering_id' => $pasta->id, 'quantity' => 1, 'notes' => null],
            ]],
        ]));

        $delivery = $group->fresh()->delivery;
        $this->acceptDelivery($delivery);

        $this->be($this->admin);
        $this->postJson('/api/admin/deliveries/' . $delivery->id . '/issue-purchasing-cash')->assertOk();

        $list = $this->be($this->riderA)
            ->getJson('/api/rider/deliveries/' . $delivery->id . '/purchases')
            ->assertOk()
            ->json('data');

        $this->assertNotNull($list['purchasing_cash_issued_at'], 'Tourism Office issued purchasing cash.');
        $this->assertCount(2, $list['purchases']);

        // Fastest prep is picked up first: Restaurant A (10 min) before B (25 min).
        $first = $list['purchases'][0];
        $second = $list['purchases'][1];

        $this->assertSame($this->restaurantA->id, $first['business_id']);
        $this->assertSame(1, $first['sequence']);
        $this->assertSame(10, $first['preparation_time']);
        $this->assertEquals((float) $this->restaurantA->latitude, (float) $first['pickup_lat']);
        $this->assertEquals((float) $this->restaurantA->longitude, (float) $first['pickup_lng']);
        $this->assertSame('Restaurant A St', $first['pickup_address']);

        $this->assertSame($this->restaurantB->id, $second['business_id']);
        $this->assertSame(2, $second['sequence']);
        $this->assertSame(25, $second['preparation_time']);

        // The LAST restaurant (longest prep) is the drop-off route origin.
        $origin = $list['pickup_origin'];
        $this->assertSame($this->restaurantB->id, $origin['business_id']);
        $this->assertSame('Restaurant B', $origin['business_name']);
        $this->assertEquals((float) $this->restaurantB->latitude, (float) $origin['latitude']);
        $this->assertEquals((float) $this->restaurantB->longitude, (float) $origin['longitude']);

        // The drop-off point is the tourist destination + address.
        $this->assertEquals(12.6, (float) $list['dropoff']['latitude']);
        $this->assertEquals(121.4, (float) $list['dropoff']['longitude']);
        $this->assertSame('123 Test St', $list['dropoff']['address']);
    }

    public function test_purchases_include_the_order_items_to_pick_up_per_restaurant(): void
    {
        $this->makeOffering($this->restaurantA, 'Cheeseburger', 120.00, 5);
        $this->makeOffering($this->restaurantA, 'Large Fries', 80.00, 10);
        $this->makeOffering($this->restaurantA, 'Soda', 50.00, 5);
        $this->makeOffering($this->restaurantB, 'Family Pizza', 490.00, 20);

        $group = $this->groupService->createGroup($this->owner, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [
                ['offering_id' => Offering::where('name', 'Cheeseburger')->value('id'), 'quantity' => 2, 'notes' => null],
                ['offering_id' => Offering::where('name', 'Large Fries')->value('id'), 'quantity' => 1, 'notes' => 'No salt'],
                ['offering_id' => Offering::where('name', 'Soda')->value('id'), 'quantity' => 3, 'notes' => null],
            ]],
            ['business_id' => $this->restaurantB->id, 'items' => [
                ['offering_id' => Offering::where('name', 'Family Pizza')->value('id'), 'quantity' => 1, 'notes' => 'Extra cheese'],
            ]],
        ]));

        $delivery = $group->fresh()->delivery;
        $this->acceptDelivery($delivery);

        $list = $this->be($this->riderA)
            ->getJson('/api/rider/deliveries/' . $delivery->id . '/purchases')
            ->assertOk()
            ->json('data');

        $this->assertCount(2, $list['purchases']);

        $stopsByBusiness = collect($list['purchases'])->keyBy('business_id');

        // Restaurant A stop carries its own items — with correct quantities
        // and any line notes.
        $stopA = $stopsByBusiness[$this->restaurantA->id];
        $this->assertSame(
            [
                ['product_name' => 'Cheeseburger', 'quantity' => 2],
                ['product_name' => 'Large Fries', 'quantity' => 1],
                ['product_name' => 'Soda', 'quantity' => 3],
            ],
            collect($stopA['items'])
                ->map(fn ($i) => ['product_name' => $i['product_name'], 'quantity' => $i['quantity']])
                ->values()
                ->all()
        );
        $this->assertContains('No salt', array_column($stopA['items'], 'notes'));
        $this->assertContains('Cheeseburger', array_column($stopA['items'], 'product_name'));

        // Restaurant B stop carries its own items — each stop is scoped to its
        // restaurant, never a mix of both.
        $stopB = $stopsByBusiness[$this->restaurantB->id];
        $this->assertCount(1, $stopB['items']);
        $this->assertSame('Family Pizza', $stopB['items'][0]['product_name']);
        $this->assertSame(1, $stopB['items'][0]['quantity']);
        $this->assertSame('Extra cheese', $stopB['items'][0]['notes']);

        foreach ([$stopA, $stopB] as $stop) {
            foreach ($stop['items'] as $item) {
                $this->assertArrayHasKey('product_name', $item);
                $this->assertArrayHasKey('quantity', $item);
                $this->assertArrayHasKey('unit_price', $item);
                $this->assertArrayHasKey('status', $item);
            }
        }
    }

    public function test_rider_confirms_receipt_and_marks_purchases_through_canonical_apis(): void
    {
        [, $order, $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);
        $this->markRestaurantReady($order, $this->restaurantA);
        $this->markRestaurantReady($order, $this->restaurantB);

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
        $this->arriveAtRestaurant($delivery, $this->restaurantA);
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
        [, $order, $delivery] = $this->createTwoRestaurantCodOrder();
        $this->acceptDelivery($delivery);
        $this->markRestaurantReady($order, $this->restaurantA);
        $this->markRestaurantReady($order, $this->restaurantB);

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
        $this->arriveAtRestaurant($delivery, $this->restaurantA);
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[0] . '/mark', ['status' => 'collected'])->assertOk();

        $this->patchJson($purchasesUrl . '/status', ['status' => 'picked_up'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Collect food from every restaurant before leaving the pickup area.']);
        $this->assertNotSame('picked_up', $delivery->fresh()->status->value);

        // Collect the remaining restaurant → leave now allowed.
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[1] . '/mark', ['status' => 'purchased'])->assertOk();
        $this->arriveAtRestaurant($delivery, $this->restaurantB);
        $this->postJson($purchasesUrl . '/purchases/' . $purchaseIds[1] . '/mark', ['status' => 'collected'])->assertOk();

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
        $this->markRestaurantReady($order, $this->restaurantA);
        $this->markRestaurantReady($order, $this->restaurantB);

        $delivery->refresh()->load('codPurchases');
        $this->assertEquals((float) $financed, $delivery->codPurchases->sum(fn ($p) => (float) $p->purchase_amount));
        $this->assertCount(2, $delivery->codPurchases);

        $this->be($this->riderA);
        foreach ($delivery->codPurchases->sortBy('business_id') as $purchase) {
            $this->postJson($purchasesUrl . '/purchases/' . $purchase->id . '/mark', ['status' => 'purchased'])->assertOk();
            $this->arriveAtRestaurant($delivery, $purchase->business_id === $this->restaurantA->id
                ? $this->restaurantA
                : $this->restaurantB);
            $this->postJson($purchasesUrl . '/purchases/' . $purchase->id . '/mark', ['status' => 'collected'])->assertOk();
        }

        // 4) Leave after ALL COLLECTED, then deliver (P14 — the TOURIST confirms
        //    receipt at the drop-off; the rider's own delivered is rejected).
        $this->assertSame('picked_up', $delivery->fresh()->status->value, 'The final restaurant pickup transitions the shared delivery.');
        foreach (['in_transit', 'arrived_destination'] as $status) {
            $this->patchJson($purchasesUrl . '/status', ['status' => $status])->assertOk();
        }
        $this->patchJson($purchasesUrl . '/status', ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'The tourist must confirm the delivery before it can be marked as delivered.']);

        $this->be($this->tourist)
            ->postJson('/api/tourist/food/order/' . $order->id . '/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'delivered');
        $this->be($this->riderA);

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

        $delivery->refresh();
        $firstPurchase = CodPurchase::where('delivery_id', $delivery->id)->orderBy('id')->firstOrFail();
        $personalContribution = 20.00;
        $officeCashUsed = round((float) $firstPurchase->purchase_amount - $personalContribution, 2);
        $expense = CodPurchaseExpense::create([
            'cod_purchase_id' => $firstPurchase->id,
            'revision' => 1,
            'actual_purchase_amount' => (float) $firstPurchase->purchase_amount,
            'tourism_office_cash_used' => $officeCashUsed,
            'rider_personal_contribution' => $personalContribution,
            'receipt_path' => 'private/test-receipt.jpg',
            'status' => CodPurchaseExpense::STATUS_VERIFIED,
            'submitted_by' => $this->riderA->id,
            'submitted_at' => $delivery->cash_settled_at,
            'verified_by' => $this->admin->id,
            'verified_at' => $delivery->cash_settled_at,
        ]);
        $unverifiedPurchase = CodPurchase::where('delivery_id', $delivery->id)
            ->where('id', '!=', $firstPurchase->id)
            ->firstOrFail();
        CodPurchaseExpense::create([
            'cod_purchase_id' => $unverifiedPurchase->id,
            'revision' => 1,
            'actual_purchase_amount' => (float) $unverifiedPurchase->purchase_amount,
            'tourism_office_cash_used' => 0,
            'rider_personal_contribution' => 0,
            'receipt_path' => 'private/unverified-receipt.jpg',
            'status' => CodPurchaseExpense::STATUS_SUBMITTED,
            'submitted_by' => $this->riderA->id,
            'submitted_at' => $delivery->cash_settled_at,
        ]);
        RiderCashFundTransaction::create([
            'rider_cash_fund_id' => $delivery->rider_cash_fund_id,
            'reference_number' => 'RCFT-RECEIPT-TEST-OFFICE',
            'type' => RiderCashFundTransaction::TYPE_PURCHASE_OFFICE_CASH_USED,
            'amount' => $officeCashUsed,
            'occurred_at' => $delivery->cash_settled_at,
            'delivery_id' => $delivery->id,
            'cod_purchase_id' => $firstPurchase->id,
            'cod_purchase_expense_id' => $expense->id,
            'recorded_by' => $this->admin->id,
        ]);
        RiderCashFundTransaction::create([
            'rider_cash_fund_id' => $delivery->rider_cash_fund_id,
            'reference_number' => 'RCFT-RECEIPT-TEST-PERSONAL',
            'type' => RiderCashFundTransaction::TYPE_RIDER_PERSONAL_CONTRIBUTION,
            'amount' => $personalContribution,
            'occurred_at' => $delivery->cash_settled_at,
            'delivery_id' => $delivery->id,
            'cod_purchase_id' => $firstPurchase->id,
            'cod_purchase_expense_id' => $expense->id,
            'recorded_by' => $this->riderA->id,
        ]);

        $deliveryDate = \Carbon\CarbonImmutable::parse(
            $delivery->cash_settled_at->timezone('Asia/Manila')->toDateString(),
            'Asia/Manila'
        );
        $cashSettlementDate = $deliveryDate->addDay()->toDateString();
        \Carbon\Carbon::setTestNow($deliveryDate->addDays(2)->utc());
        $delivery->update([
            'delivered_at' => $deliveryDate->startOfDay()->addHours(23)->addMinutes(55)->utc(),
            'cash_settled_at' => $deliveryDate->addDay()->addMinutes(5)->utc(),
        ]);
        $delivery->refresh();
        $order->update(['completed_at' => $delivery->cash_settled_at]);
        $earning = RiderEarning::where('rider_id', $this->riderA->id)->where('order_id', $order->id)->sole();
        $expectedRemittance = round(
            $cashDue - (float) $earning->delivery_fee - (float) $earning->rider_tip - $personalContribution,
            2
        );
        $dailyReceiptResponse = $this->be($this->riderA)
            ->getJson('/api/rider/cash-fund/daily-receipt?date='.$cashSettlementDate)
            ->assertOk();
        $dailyReceiptResponse
            ->assertJsonPath('data.receipt_status', 'calculated_preview')
            ->assertJsonPath('data.totals.eligible_delivery_count', 0)
            ->assertJsonPath('data.cash_received_by_tourism_office', null)
            ->assertJsonPath('data.remittance_submitted', false);
        $deliveryDayReceipt = $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertOk();
        $this->assertEquals(1, $deliveryDayReceipt->json('data.totals.eligible_delivery_count'));
        $this->assertEquals($cashDue, $deliveryDayReceipt->json('data.totals.cash_collected'));
        $this->assertEquals($financed, $deliveryDayReceipt->json('data.totals.cod_settlement_base'));
        $this->assertSame(
            $deliveryDate->startOfDay()->addHours(23)->addMinutes(55)->utc()->toISOString(),
            \Carbon\CarbonImmutable::parse($deliveryDayReceipt->json('data.deliveries.0.completed_at'))->utc()->toISOString()
        );
        $this->assertSame(
            $deliveryDate->addDay()->addMinutes(5)->utc()->toISOString(),
            \Carbon\CarbonImmutable::parse($deliveryDayReceipt->json('data.deliveries.0.cash_settled_at'))->utc()->toISOString()
        );

        config([
            'cod_cash.reconciliation_enabled' => true,
            'cod_cash.effective_date' => $cashSettlementDate,
        ]);
        $legacyDateReceipt = $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertOk();
        $this->assertSame('legacy_policy', $legacyDateReceipt->json('data.policy_status'));
        $this->assertFalse($legacyDateReceipt->json('data.reconciliation_policy.mutations_enabled'));
        $this->assertNull($legacyDateReceipt->json('data.totals.net_cod_remittance_expected'));
        $this->be($this->riderA)->postJson('/api/rider/cash-fund/daily-receipt/submissions', [
            'date' => $deliveryDate->toDateString(),
            'cash_remitted' => 0,
            'office_cash_returned' => 0,
            'remittance_reference' => 'LEGACY-DATE-REF',
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertDatabaseCount('rider_daily_reconciliations', 0);

        config(['cod_cash.effective_date' => $deliveryDate->toDateString()]);
        $activeReceipt = $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertOk()
            ->assertJsonPath('data.reconciliation_policy.mutations_enabled', true);
        $expectedCashReturn = $activeReceipt->json('data.totals.unreturned_tourism_office_cash_balance');
        $expectedRemittance = $activeReceipt->json('data.totals.net_cod_remittance_expected');
        $submissionKey = (string) \Illuminate\Support\Str::uuid();
        $submissionPayload = [
            'date' => $deliveryDate->toDateString(),
            'cash_remitted' => $expectedRemittance,
            'office_cash_returned' => $expectedCashReturn,
            'remittance_reference' => 'RIDER-REMIT-TEST-001',
            'note' => 'End-of-day cash handover',
            'idempotency_key' => $submissionKey,
        ];
        $submission = $this->be($this->riderA)
            ->postJson('/api/rider/cash-fund/daily-receipt/submissions', $submissionPayload)
            ->assertOk()
            ->assertJsonPath('data.status', 'submitted')
            ->json('data');
        $this->postJson('/api/rider/cash-fund/daily-receipt/submissions', $submissionPayload)
            ->assertOk()
            ->assertJsonPath('data.id', $submission['id']);
        $this->postJson('/api/rider/cash-fund/daily-receipt/submissions', array_merge($submissionPayload, [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]))->assertStatus(409);

        $verifyUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$submission['id'].'/verify';
        $this->be($this->admin)->postJson($verifyUrl, [
            'cash_received' => $expectedRemittance,
            'office_cash_returned' => $expectedCashReturn,
            'rider_reimbursement_paid' => $activeReceipt->json('data.totals.verified_personal_purchase_reimbursement') + 0.01,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertDatabaseHas('rider_daily_reconciliations', [
            'id' => $submission['id'],
            'status' => RiderDailyReconciliation::STATUS_SUBMITTED,
            'verified_by' => null,
        ]);
        $this->be($this->tourist)->postJson($verifyUrl, [
            'cash_received' => $expectedRemittance,
            'office_cash_returned' => $expectedCashReturn,
            'rider_reimbursement_paid' => 0,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertForbidden();

        $mismatchKey = (string) \Illuminate\Support\Str::uuid();
        $mismatchPayload = [
            'cash_received' => max(0, $expectedRemittance - 1),
            'office_cash_returned' => $expectedCashReturn,
            'rider_reimbursement_paid' => 0,
            'note' => 'Physical count differs from rider submission.',
            'idempotency_key' => $mismatchKey,
        ];
        if ($mismatchPayload['cash_received'] > 0) {
            $this->recordPhysicalMovement($submission['id'], RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, $mismatchPayload['cash_received'], 'HISTORY-COD-001');
        }
        if ($expectedCashReturn > 0) {
            $this->recordPhysicalMovement($submission['id'], RiderDailyCashMovement::TYPE_OFFICE_CASH_RETURNED, $expectedCashReturn, 'HISTORY-RETURN-001');
        }
        $mismatch = $this->be($this->admin)->postJson($verifyUrl, $mismatchPayload)
            ->assertOk()->assertJsonPath('data.status', 'disputed');
        $this->assertSame(RiderDailyReconciliation::STATUS_DISPUTED, $mismatch->json('data.status'));
        $this->postJson($verifyUrl, $mismatchPayload)
            ->assertOk()->assertJsonPath('data.status', 'disputed');

        $resubmissionKey = (string) \Illuminate\Support\Str::uuid();
        $revisedSubmission = $this->be($this->riderA)
            ->postJson('/api/rider/cash-fund/daily-receipt/submissions', [
                'date' => $deliveryDate->toDateString(),
                    'cash_remitted' => 1,
                    'office_cash_returned' => 0,
                'remittance_reference' => 'RIDER-REMIT-TEST-002',
                'note' => 'Revised to match the verified cash count.',
                'idempotency_key' => $resubmissionKey,
            ])->assertOk()
            ->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.status', 'submitted')
            ->json('data');
        $revisedVerifyUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/verify';
        $revisedVerifyKey = (string) \Illuminate\Support\Str::uuid();
        $revisedVerifyPayload = [
            'cash_received' => 1,
            'office_cash_returned' => 0,
            'rider_reimbursement_paid' => $personalContribution,
            'note' => 'Count verified.',
            'idempotency_key' => $revisedVerifyKey,
        ];
        $this->recordPhysicalMovement($revisedSubmission['id'], RiderDailyCashMovement::TYPE_COD_REMITTANCE_RECEIVED, 1, 'HISTORY-COD-002');
        if ($personalContribution > 0) {
            $this->recordPhysicalMovement($revisedSubmission['id'], RiderDailyCashMovement::TYPE_RIDER_REIMBURSEMENT_PAID, $personalContribution, 'HISTORY-REIMBURSEMENT-001');
        }
        $this->be($this->admin)->postJson($revisedVerifyUrl, $revisedVerifyPayload)
            ->assertOk()->assertJsonPath('data.status', 'verified');
        $this->postJson($revisedVerifyUrl, $revisedVerifyPayload)
            ->assertOk()->assertJsonPath('data.status', 'verified');
        $closeUrl = '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$revisedSubmission['id'].'/close';
        $closeKey = (string) \Illuminate\Support\Str::uuid();
        $closePayload = ['idempotency_key' => $closeKey];
        $this->postJson($closeUrl, $closePayload)->assertOk()->assertJsonPath('data.status', 'closed');
        $this->postJson($closeUrl, $closePayload)->assertOk()->assertJsonPath('data.status', 'closed');
        $this->assertDatabaseHas('rider_daily_reconciliation_events', [
            'rider_daily_reconciliation_id' => $revisedSubmission['id'],
            'action' => 'closed',
            'to_status' => 'closed',
        ]);
        $this->postJson($closeUrl, [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(409);
        $this->assertSame(5, \App\Models\RiderDailyReconciliationEvent::where(
            'rider_daily_reconciliation_id',
            $revisedSubmission['id']
        )->count());
        $this->be($this->riderA);

        $this->assertEquals($personalContribution, $deliveryDayReceipt->json('data.totals.verified_personal_purchase_reimbursement'));
        $this->assertEquals($expectedRemittance, $deliveryDayReceipt->json('data.totals.net_cod_remittance_expected'));
        $this->assertEquals(round($financed * 0.2, 2), $deliveryDayReceipt->json('data.totals.tourism_office_share'));
        $this->assertEquals(
            round((float) $delivery->purchasing_cash - $officeCashUsed, 2),
            $deliveryDayReceipt->json('data.totals.unreturned_tourism_office_cash_balance')
        );
        $receiptPurchases = $deliveryDayReceipt->json('data.deliveries.0.purchases');
        $this->assertCount(2, $receiptPurchases);
        $submittedPurchase = collect($receiptPurchases)->firstWhere('purchase_id', $unverifiedPurchase->id);
        $this->assertSame(CodPurchaseExpense::STATUS_SUBMITTED, $submittedPurchase['expense_submissions'][0]['status']);
        $this->assertArrayNotHasKey('receipt_path', $submittedPurchase['expense_submissions'][0]);
        $originalEarning = [
            'delivery_fee' => (float) $earning->delivery_fee,
            'rider_tip' => (float) $earning->rider_tip,
            'total_earning' => (float) $earning->total_earning,
        ];
        $earning->update([
            'rider_tip' => round($cashDue + $personalContribution + 50, 2),
            'total_earning' => round((float) $earning->delivery_fee + $cashDue + $personalContribution + 50, 2),
        ]);
        $negativeBalanceReceipt = $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertOk();
        $this->assertSame(0, $negativeBalanceReceipt->json('data.totals.net_cod_remittance_expected'));
        $this->assertGreaterThan(
            0,
            $negativeBalanceReceipt->json('data.totals.additional_rider_payable')
        );
        $earning->update($originalEarning);

        $previousDate = $deliveryDate->subDay()->toDateString();
        $this->assertEquals(
            0,
            $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$previousDate)
                ->json('data.totals.eligible_delivery_count')
        );

        $order->update(['refund_status' => 'pending']);
        $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertJsonPath('data.totals.eligible_delivery_count', 0)
            ->assertJsonPath('data.excluded_deliveries.0.delivery_id', $delivery->id);
        $order->update(['refund_status' => 'none']);

        $order->update(['status' => 'cancelled']);
        $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertJsonPath('data.totals.eligible_delivery_count', 0);
        $order->update(['status' => 'completed']);

        $order->update(['payment_method' => 'gcash']);
        $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertJsonPath('data.totals.eligible_delivery_count', 0);
        $order->update(['payment_method' => 'cash']);

        $cashPayment = Payment::where('payable_type', Order::class)->where('payable_id', $order->id)
            ->where('method', 'cash')->where('provider', 'rider')->where('status', 'paid')->sole();
        $duplicatePayment = $cashPayment->replicate();
        $duplicatePayment->payment_number = 'CASH-DAILY-RECEIPT-DUPLICATE';
        $duplicatePayment->save();
        $this->getJson('/api/rider/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertJsonPath('data.totals.eligible_delivery_count', 0)
            ->assertJsonPath('data.excluded_deliveries.0.delivery_id', $delivery->id);
        $duplicatePayment->update(['status' => 'failed']);

        $this->be($this->admin)
            ->getJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertOk()
            ->assertJsonPath('data.totals.eligible_delivery_count', 1);

        $otherMunicipality = Municipality::create([
            'name' => 'Calapan',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 13.4,
            'longitude' => 121.2,
        ]);
        $this->riderA->update(['municipality_id' => $otherMunicipality->id]);
        $this->getJson('/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt?date='.$deliveryDate->toDateString())
            ->assertForbidden();
        $this->be($this->admin)->postJson($revisedVerifyUrl, $revisedVerifyPayload)
            ->assertForbidden();

        // 7) Rider free again; purchases all terminal (collected).
        $this->assertSame('available', $this->riderA->fresh()->riderDetail->rider_status);
        foreach ($delivery->codPurchases as $purchase) {
            $this->assertSame(CodPurchase::STATUS_COLLECTED, $purchase->status);
        }
    }

    private function enableDailyCashPolicy(string $effectiveDate): void
    {
        config([
            'cod_cash.reconciliation_enabled' => true,
            'cod_cash.effective_date' => $effectiveDate,
        ]);
    }

    private function recordTestCashFundReturn(User $rider, string $date, string $reference, float $amount): RiderDailyCashMovement
    {
        $transactionAt = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $date, 'Asia/Manila')->setTime(12, 0);
        $response = $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$rider->id.'/cash-fund/returns',
            [
                'amount' => $amount,
                'transaction_at' => $transactionAt->format('Y-m-d\TH:i'),
                'reference' => $reference,
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Test evidence for the physical cash-fund return.',
                'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            ]
        )->assertOk();

        return RiderDailyCashMovement::findOrFail($response->json('data.id'));
    }

    private function createClosedDailyReconciliation(User $rider, string $date): RiderDailyReconciliation
    {
        $revision = ((int) RiderDailyReconciliation::query()
            ->where('rider_id', $rider->id)
            ->whereDate('working_date', $date)
            ->max('revision')) + 1;

        return RiderDailyReconciliation::create([
            'rider_id' => $rider->id,
            'municipality_id' => $rider->municipality_id,
            'working_date' => $date,
            'revision' => $revision,
            'status' => RiderDailyReconciliation::STATUS_CLOSED,
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            'expected_cod_remittance' => '0.00',
            'expected_office_cash_return' => '0.00',
            'expected_rider_payable' => '0.00',
            'submitted_cod_remittance' => '0.00',
            'submitted_office_cash_return' => '0.00',
            'remittance_reference' => 'TEST-CLOSED-'.$date.'-'.$revision,
            'receipt_snapshot' => [],
            'submitted_at' => now(),
            'verified_cod_received' => '0.00',
            'verified_office_cash_return' => '0.00',
            'verified_rider_reimbursement' => '0.00',
            'verified_by' => $this->admin->id,
            'verified_at' => now(),
            'closed_by' => $this->admin->id,
            'closed_at' => now(),
        ]);
    }

    private function createReviewedCorrection(RiderDailyReconciliation $reconciliation): RiderDailyReconciliationCorrection
    {
        $correction = RiderDailyReconciliationCorrection::create([
            'rider_daily_reconciliation_id' => $reconciliation->id,
            'cycle_number' => 1,
            'status' => RiderDailyReconciliationCorrection::STATUS_PENDING_REVIEW,
            'created_by' => $this->admin->id,
        ]);

        return app(RiderDailyReconciliationService::class)->reviewCorrection(
            $this->admin,
            $correction,
            'approve',
            'Reviewed test correction snapshot.',
            (string) \Illuminate\Support\Str::uuid()
        );
    }

    private function createTestMovement(
        User $rider,
        string $date,
        string $movementType,
        string $affectsType,
        string $amount
    ): RiderDailyCashMovement {
        return RiderDailyCashMovement::create([
            'rider_id' => $rider->id,
            'municipality_id' => $rider->municipality_id,
            'business_date' => $date,
            'movement_type' => $movementType,
            'affects_type' => $affectsType,
            'amount' => $amount,
            'recorded_by' => $this->admin->id,
            'transaction_at' => now(),
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
        ]);
    }

    private function recordPhysicalMovement(
        int $reconciliationId,
        string $type,
        float $amount,
        string $reference,
        ?string $idempotencyKey = null
    ): array
    {
        return $this->be($this->admin)->postJson(
            '/api/admin/riders/'.$this->riderA->id.'/cash-fund/daily-receipt/'.$reconciliationId.'/movements',
            [
                'movement_type' => $type,
                'amount' => $amount,
                'reference' => $reference,
                'reference_namespace' => 'office-receipts',
                'evidence_details' => 'Verified physical transfer at Tourism Office.',
                'idempotency_key' => $idempotencyKey ?? (string) \Illuminate\Support\Str::uuid(),
            ]
        )->assertOk()->json('data');
    }

    private function createFundForRider(User $rider, float $amount, string $date, string $reference): RiderCashFund
    {
        $fund = RiderCashFund::create([
            'fund_number' => $reference,
            'rider_id' => $rider->id,
            'municipality_id' => $rider->municipality_id,
            'status' => RiderCashFund::STATUS_OPEN,
            'active_rider_key' => $rider->id,
            'opened_by' => $this->admin->id,
            'opened_at' => $date.' 08:00:00',
        ]);
        RiderCashFundTransaction::create([
            'rider_cash_fund_id' => $fund->id,
            'reference_number' => $reference.'-ISSUE',
            'type' => RiderCashFundTransaction::TYPE_CASH_ISSUED,
            'amount' => number_format($amount, 2, '.', ''),
            'occurred_at' => $date.' 08:00:00',
            'recorded_by' => $this->admin->id,
        ]);

        return $fund;
    }
}