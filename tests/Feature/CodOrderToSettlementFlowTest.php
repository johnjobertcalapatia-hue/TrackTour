<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodPurchase;
use App\Models\CodSettlement;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Payment;
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
 * The full COD flow over the canonical HTTP endpoints — order placed → dispatch
 * offer → rider accept (preparation gate) → restaurant ready → purchasing cash
 * (auto-issued at acceptance; rider already holds the Tourism Office float) →
 * collection gate → trip progression → delivered → cash settled → completed:
 *
 *   Tourist  POST   /api/tourist/food/group-order
 *   Rider    GET    /api/rider/dispatch/offers
 *   Rider    PATCH  /api/rider/dispatch/accept
 *   Owner    PATCH  /api/business-owner/orders/{o}/items/{i}/status
 *   Rider    POST   /api/rider/deliveries/{d}/purchasing-cash/receive
 *   Rider    POST   /api/rider/deliveries/{d}/purchases/{p}/mark
 *   Rider    PATCH  /api/rider/deliveries/{d}/status
 *   Rider    POST   /api/rider/deliveries/{d}/settle-cod
 *
 * Unlike CodDeliverySettlementTest / CodFinancialSettlementTest (service-level:
 * direct model writes) and PurchasingCashFlowTest (checkout + rider accept still
 * service-level), every step here runs through the real controllers, middleware
 * and validations, with the business-rule guards asserted in-flow:
 *
 *   - preparation is blocked until a rider accepts (AGENTS §4.2)
 *   - a rider without an offer cannot claim the trip (409)
 *   - a non-owner rider cannot advance or settle the delivery (403)
 *   - COD picked_up is gated on every restaurant stop being collected
 *   - settle-cod requires delivered, rejects short cash, and is a one-shot
 *   - cash_due = group grand total; the rider keeps the cash; earnings are
 *     commission + tip only; the 80/20 restaurant/TO split reconciles to the
 *     rider-financed settlement base
 *
 * NearestRiderService is partially mocked (the nearest-rider ACOS/Haversine
 * SQL is SQLite-unsafe) while the real dispatch/accept/settle logic runs.
 * No Http::fake() is needed: the group fee path never reaches a live router
 * (proven by CodDeliverySettlementTest).
 */
class CodOrderToSettlementFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
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

        $this->tourist = User::create([
            'email' => 'tourist-cod-flow@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->owner = User::create([
            'email' => 'owner-cod-flow@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->admin = User::create([
            'email' => 'tourism-office-cod-flow@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
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
            'business_name' => 'Flow Restaurant A',
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
            'business_name' => 'Flow Restaurant B',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.52,
            'longitude' => 121.32,
        ]);

        $this->riderA = $this->makeRider('ridera-cod-flow@example.com');
        $this->riderB = $this->makeRider('riderb-cod-flow@example.com');

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

    // ---------- helpers ----------

    private function makeRider(string $email): User
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

    private function groupPayload(array $overrides = []): array
    {
        return array_merge([
            'restaurants' => [
                [
                    'business_id' => $this->restaurantA->id,
                    'items' => [
                        ['offering_id' => $this->makeOffering($this->restaurantA, 'Burger', 120.00)->id, 'quantity' => 1, 'notes' => null],
                        ['offering_id' => $this->makeOffering($this->restaurantA, 'Fries', 80.00)->id, 'quantity' => 1, 'notes' => null],
                    ],
                ],
                [
                    'business_id' => $this->restaurantB->id,
                    'items' => [
                        ['offering_id' => $this->makeOffering($this->restaurantB, 'Pizza', 400.00)->id, 'quantity' => 1, 'notes' => null],
                    ],
                ],
            ],
            'order_type' => 'delivery',
            'delivery_speed' => 'fast',
            'rider_tip' => 40.00,
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'payment_method' => 'cash',
            'notes' => null,
        ], $overrides);
    }

    /** Tourist places the COD group order through the real endpoint. */
    private function placeCodOrder(array $overrides = []): array
    {
        $this->be($this->tourist)
            ->postJson('/api/tourist/food/group-order', $this->groupPayload($overrides))
            ->assertCreated()
            ->assertJsonPath('success', true);

        $group = GroupCheckout::sole();

        return [$group, $group->orders()->sole(), $group->fresh()->delivery];
    }

    private function acceptAsRiderA(Delivery $delivery): void
    {
        $this->be($this->riderA)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertOk()
            ->assertJsonPath('data.success', true);
    }

    private function riderStatusUrl(Delivery $delivery): string
    {
        return "/api/rider/deliveries/{$delivery->id}/status";
    }

    private function settleUrl(Delivery $delivery): string
    {
        return "/api/rider/deliveries/{$delivery->id}/settle-cod";
    }

    // ───────────────────────────────────────────────────────────────
    // 1. The happy path: order placed → delivered → settled → completed,
    //    entirely over the canonical endpoints, with every business-rule
    //    guard asserted in-flow.
    // ───────────────────────────────────────────────────────────────
    public function test_cod_flow_runs_from_order_placed_to_delivered_completed_and_settled(): void
    {
        // ---- 1. Tourist places one COD group checkout (2 restaurants) ----
        [$group, $order, $delivery] = $this->placeCodOrder();

        $this->assertSame('cash', $order->payment_method);
        $this->assertSame('pending', $order->payment_status, 'COD stays unpaid until cash is collected at the door.');
        $this->assertSame('waiting_restaurant', $order->status, 'A delivery order waits for an accepted rider before preparation.');
        $this->assertEquals(40.00, (float) $order->rider_tip, 'Fast-delivery tip folded into the order total.');

        $this->assertSame(1, Delivery::count(), 'One group checkout owns exactly one physical delivery.');
        $this->assertSame($order->id, $delivery->order_id, 'The shared delivery references the canonical order.');
        $this->assertSame($group->id, $delivery->group_checkout_id);

        $this->assertSame('notified', $delivery->dispatch_status, 'COD delivery orders dispatch at placement.');
        $this->assertSame(
            1,
            BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->count(),
            'Exactly one pending offer at placement.'
        );
        $this->assertSame(
            $this->riderA->id,
            BookingDispatchLog::where('delivery_id', $delivery->id)->sole()->rider_id,
            'Nearest rider (Rider A) holds the offer.'
        );

        // ---- 2. Offer visibility: only the offered rider sees it ----
        $this->be($this->riderB)
            ->getJson('/api/rider/dispatch/offers')
            ->assertOk()
            ->assertJsonPath('data.offers', []);

        $riderAOffers = $this->be($this->riderA)
            ->getJson('/api/rider/dispatch/offers')
            ->assertOk()
            ->json('data.offers');

        $this->assertCount(1, $riderAOffers);
        $this->assertSame($delivery->id, $riderAOffers[0]['delivery_id']);
        $this->assertEquals((float) $group->grand_total, (float) $riderAOffers[0]['cod_amount'], 'The offer carries the full cash due.');

        // ---- 3. Preparation gate: nothing prepares before a rider accepts ----
        $firstItem = $order->items()->first();
        $this->assertNotNull($firstItem);

        $this->be($this->owner)
            ->postJson("/api/business-owner/orders/{$order->id}/mark-ready")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This delivery order cannot be marked ready until a rider has accepted the delivery.');

        $this->be($this->owner)
            ->patchJson("/api/business-owner/orders/{$order->id}/items/{$firstItem->id}/status", ['status' => 'preparing'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'This delivery order cannot be prepared until a rider has accepted the delivery.');

        $this->assertSame('waiting_restaurant', $order->fresh()->status, 'Gate failures leave the order untouched.');

        // ---- 4. A rider without an offer cannot claim (409); the offered rider can ----
        $this->be($this->riderB)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409)
            ->assertJsonPath('success', false);

        $this->acceptAsRiderA($delivery);

        $delivery->refresh();
        $this->assertSame('assigned', $delivery->status->value);
        $this->assertSame($this->riderA->id, $delivery->rider_id);
        $this->assertEquals((float) $group->grand_total, (float) $delivery->cash_due, 'Cash due frozen at accept = group grand total.');
        $this->assertSame('busy', $this->riderA->fresh()->riderDetail->rider_status);

        // Rider acceptance is what unlocks the restaurant (AGENTS §4.2).
        $this->assertSame('preparing', $order->fresh()->status, 'Accept auto-transitions waiting_restaurant → preparing.');

        // The offer is consumed: the rider no longer sees it.
        $this->be($this->riderA)
            ->getJson('/api/rider/dispatch/offers')
            ->assertOk()
            ->assertJsonPath('data.offers', []);

        // Purchasing stops exist for every restaurant and reconcile to the base.
        $purchases = CodPurchase::where('delivery_id', $delivery->id)->orderBy('business_id')->get();
        $this->assertCount(2, $purchases, 'One purchase stop per restaurant.');
        $this->assertSame(CodPurchase::STATUS_PENDING, $purchases[0]->status);
        $this->assertEquals(
            (float) $order->rider_financed_amount,
            round($purchases->sum(fn ($p) => (float) $p->purchase_amount), 2),
            'Purchasing stops reconcile to the rider-financed settlement base.'
        );

        // The rider already holds the Tourism Office float, so the purchasing
        // cash is issued implicitly with the assignment — no office action,
        // no waiting, and the amount equals the rider-financed settlement base.
        $this->assertNotNull($delivery->purchasing_cash_issued_at, 'Purchasing cash auto-issued at acceptance.');
        $this->assertNull($delivery->purchasing_cash_issued_by, 'Auto-issuance has no acting officer.');
        $this->assertEquals(
            (float) $order->rider_financed_amount,
            (float) $delivery->purchasing_cash,
            'Auto-issued purchasing cash = rider_financed_amount = settlement base.'
        );

        // ---- 5. Wrong rider cannot advance the assigned delivery ----
        $this->be($this->riderB)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'arrived_pickup'])
            ->assertStatus(403)
            ->assertJsonPath('message', 'You are not assigned to this delivery.');

        $this->assertSame('assigned', $delivery->fresh()->status->value);

        // ---- 6. Restaurant readies every item; the trip stays bound ----
        foreach ($order->fresh()->items as $flowItem) {
            $this->be($this->owner)
                ->patchJson("/api/business-owner/orders/{$order->id}/items/{$flowItem->id}/status", ['status' => 'ready'])
                ->assertOk();
        }

        $this->assertSame('ready', $order->fresh()->status, 'All items ready → order ready.');
        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id, 'Restaurant work never rebinds the delivery (AGENTS §4.4).');

        // ---- 7. Purchasing cash auto-issued at acceptance; the rider receives it ----
        $this->assertNotNull($delivery->purchasing_cash_issued_at, 'Purchasing cash auto-issued at acceptance.');
        $this->assertEquals((float) $order->rider_financed_amount, (float) $delivery->purchasing_cash);
        $this->assertSame(2, $delivery->codPurchases()->count());

        $this->be($this->riderA)
            ->postJson("/api/rider/deliveries/{$delivery->id}/purchasing-cash/receive")
            ->assertOk()
            ->assertJsonPath('success', true);
        $this->assertNotNull($delivery->fresh()->purchasing_cash_received_at);

        // ---- 8. Trip progression with the collection gate on picked_up ----
        $this->be($this->riderA)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'arrived_pickup'])
            ->assertOk();

        // Collection gate: the pickup area cannot be left before EVERY stop is collected.
        $this->be($this->riderA)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'picked_up'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Collect food from every restaurant before leaving the pickup area.');
        $this->assertNotSame('picked_up', $delivery->fresh()->status->value);

        foreach ($purchases as $purchase) {
            $this->be($this->riderA)
                ->postJson("/api/rider/deliveries/{$delivery->id}/purchases/{$purchase->id}/mark", ['status' => 'purchased'])
                ->assertOk();
            $this->be($this->riderA)
                ->postJson("/api/rider/deliveries/{$delivery->id}/purchases/{$purchase->id}/mark", ['status' => 'collected'])
                ->assertOk();
        }

        $this->be($this->riderA)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'picked_up'])
            ->assertOk();
        $this->be($this->riderA)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'in_transit'])
            ->assertOk();
        $this->be($this->riderA)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'arrived_destination'])
            ->assertOk();

        // ---- 9. Settlement guard before delivery; delivery is tourist-confirmed ----
        $cashDue = (float) $delivery->fresh()->cash_due;
        $this->assertGreaterThan(0, $cashDue);

        $this->be($this->riderA)
            ->postJson($this->settleUrl($delivery), ['cash_received' => $cashDue])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Delivery must be marked as delivered before cash settlement.');

        // P14 — the rider cannot mark a food delivery delivered; the tourist must
        // confirm receipt at the drop-off.
        $this->be($this->riderA)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The tourist must confirm the delivery before it can be marked as delivered.');

        $this->be($this->tourist)
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'delivered');

        $delivery->refresh();
        $this->assertSame('delivered', $delivery->status->value, 'COD stays delivered until cash is settled — never auto-completed.');
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNotNull($delivery->delivery_confirmed_at, 'Tourist confirmation is stamped.');
        $this->assertSame((int) $this->tourist->id, (int) $delivery->delivery_confirmed_by);
        $this->assertSame('busy', $this->riderA->fresh()->riderDetail->rider_status, 'COD keeps the rider busy until cash is collected.');
        $this->assertSame('pending', $order->fresh()->payment_status, 'Still unpaid between delivery and cash settlement.');
        $this->assertNotSame('completed', $order->fresh()->status);
        $this->assertSame(0, CodSettlement::count(), 'No settlement is booked before cash is collected.');
        $this->assertSame(1, Delivery::where('status', 'delivered')->count());

        // Short cash is rejected server-side; nothing is booked.
        $this->be($this->riderA)
            ->postJson($this->settleUrl($delivery), ['cash_received' => $cashDue - 1])
            ->assertStatus(422)
            ->assertJsonPath('success', false);

        $this->assertSame(0, CodSettlement::count());
        $this->assertSame('pending', $order->fresh()->payment_status);
        $this->assertSame('delivered', $delivery->fresh()->status->value);

        // ---- 10. Exact-cash settlement completes the flow ----
        $settle = $this->be($this->riderA)
            ->postJson($this->settleUrl($delivery), ['cash_received' => $cashDue])
            ->assertOk()
            ->assertJsonPath('message', 'Cash on delivery settled successfully.')
            ->assertJsonPath('data.success', true);

        $this->assertEquals(0.0, (float) $settle->json('data.change_given'), 'Change is computed server-side.');

        $delivery->refresh();
        $order->refresh();

        $this->assertSame('completed', $delivery->status->value);
        $this->assertEquals($cashDue, (float) $delivery->cash_received);
        $this->assertEquals(0.0, (float) $delivery->change_given);
        $this->assertNotNull($delivery->cash_settled_at);

        $this->assertSame('completed', $order->status);
        $this->assertSame('paid', $order->payment_status);
        $this->assertEquals((float) $order->total, (float) $order->paid_amount);
        $this->assertNotNull($order->completed_at);

        // One cash payment — the tourist paid the rider at the door.
        $payments = Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->get();
        $this->assertCount(1, $payments, 'Exactly one cash payment for the canonical order.');
        $this->assertSame('cash', $payments[0]->method);
        $this->assertSame('paid', $payments[0]->status);
        $this->assertSame('rider', $payments[0]->provider, 'Cash is collected by the rider.');
        $this->assertEquals((float) $order->total, (float) $payments[0]->amount);

        // Per-restaurant 80/20 allocations reconciling to the financed base.
        $settlements = CodSettlement::where('delivery_id', $delivery->id)->get();
        $this->assertCount(2, $settlements, 'One settlement allocation per restaurant.');
        $this->assertSame(
            [$this->restaurantA->id, $this->restaurantB->id],
            $settlements->pluck('business_id')->sort()->values()->all()
        );

        $settlementBaseSum = round($settlements->sum(fn ($s) => (float) $s->settlement_base), 2);
        $this->assertEquals((float) $order->rider_financed_amount, $settlementBaseSum, 'Allocations reconcile to the rider-financed base.');
        $this->assertLessThan($cashDue, $settlementBaseSum, 'The settlement base excludes the delivery fee and tip (cash_due is bigger).');

        foreach ($settlements as $settlement) {
            $this->assertSame($this->riderA->id, $settlement->rider_id);
            $this->assertSame(CodSettlement::STATUS_SETTLED, $settlement->status);
            $this->assertEquals(
                round((float) $settlement->restaurant_share + (float) $settlement->platform_fee, 2),
                (float) $settlement->settlement_base
            );
            $this->assertEquals(80, round(((float) $settlement->restaurant_share / (float) $settlement->settlement_base) * 100));
            $this->assertEquals(20, round(((float) $settlement->platform_fee / (float) $settlement->settlement_base) * 100));
        }

        // Each restaurant wallet is credited exactly its restaurant share.
        foreach ([$this->restaurantA, $this->restaurantB] as $restaurant) {
            $expectedShare = (float) $settlements->firstWhere('business_id', $restaurant->id)->restaurant_share;
            $this->assertEquals($expectedShare, (float) $restaurant->fresh()->restaurantWallet->available_balance);
        }

        // Rider earnings = commission + tip — never the COD cash itself.
        $earnings = RiderEarning::where('rider_id', $this->riderA->id)->where('order_id', $order->id)->get();
        $this->assertCount(1, $earnings, 'One earning for the single shared trip.');
        $earning = $earnings[0];
        $this->assertSame('earned', $earning->status);

        $expectedEarning = round(
            (float) ($delivery->rider_commission ?? $delivery->delivery_fee ?? 0) + (float) $order->rider_tip,
            2
        );
        $this->assertEquals($expectedEarning, (float) $earning->total_earning);
        $this->assertEquals(40.00, (float) $earning->rider_tip, 'The fast-delivery tip belongs to the rider.');
        $this->assertLessThan($cashDue, (float) $earning->total_earning, 'Earnings are commission + tip, never the cash carried.');

        // Rider freed; every purchase stop terminal.
        $this->assertSame('available', $this->riderA->fresh()->riderDetail->rider_status, 'Rider freed after cash settlement.');
        foreach ($delivery->fresh()->codPurchases as $purchase) {
            $this->assertSame(CodPurchase::STATUS_COLLECTED, $purchase->status);
        }

        // ---- 11. Double settle is a rejected no-op ----
        $this->be($this->riderA)
            ->postJson($this->settleUrl($delivery), ['cash_received' => $cashDue])
            ->assertStatus(422)
            ->assertJsonPath('success', false);

        $this->assertSame(2, CodSettlement::count(), 'Double settle books nothing extra.');
        $this->assertSame(1, Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->count());
        $this->assertSame(1, Delivery::where('status', 'completed')->count());

        // The rider sees the finished trip in the completed list.
        $this->be($this->riderA)
            ->getJson('/api/rider/deliveries/completed')
            ->assertOk()
            ->assertJsonPath('meta.total', 1);
    }

    // ───────────────────────────────────────────────────────────────
    // 2. Role and ownership isolation on the flow's endpoints: wrong role
    //    → 403, wrong rider → 403, and every rejected attempt leaves the
    //    authoritative state untouched.
    // ───────────────────────────────────────────────────────────────
    public function test_flow_endpoints_enforce_role_and_delivery_ownership(): void
    {
        [, $order, $delivery] = $this->placeCodOrder();
        $this->acceptAsRiderA($delivery);
        $this->assertSame('preparing', $order->fresh()->status);

        // A tourist may not act inside the rider surface.
        $this->be($this->tourist)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(403);

        $this->be($this->tourist)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'arrived_pickup'])
            ->assertStatus(403);

        // Another rider may not touch the trip: ownership is per delivery.
        $this->be($this->riderB)
            ->patchJson($this->riderStatusUrl($delivery), ['status' => 'arrived_pickup'])
            ->assertStatus(403)
            ->assertJsonPath('message', 'You are not assigned to this delivery.');

        $this->be($this->riderB)
            ->postJson($this->settleUrl($delivery), ['cash_received' => 0])
            ->assertStatus(403)
            ->assertJsonPath('message', 'You are not assigned to this delivery.');

        // Purchasing cash issuance belongs to the Tourism Office only.
        $this->be($this->owner)
            ->postJson("/api/admin/deliveries/{$delivery->id}/issue-purchasing-cash")
            ->assertStatus(403);

        // Preparation control belongs to the business owner only.
        $this->be($this->riderA)
            ->postJson("/api/business-owner/orders/{$order->id}/mark-ready")
            ->assertStatus(403);

        // Every rejected attempt left the authoritative state untouched.
        $delivery->refresh();
        $order->refresh();

        $this->assertSame('assigned', $delivery->status->value, 'Delivery never advanced.');
        $this->assertSame($this->riderA->id, $delivery->rider_id, 'Delivery still bound to Rider A.');
        $this->assertNotNull($delivery->purchasing_cash_issued_at, 'Cash was auto-issued at acceptance (rider holds the float).');
        $this->assertEquals(
            (float) $order->rider_financed_amount,
            (float) $delivery->purchasing_cash,
            'Rejected attempts never re-issued or re-stamped the auto-issued amount.'
        );
        $this->assertSame('preparing', $order->status, 'Order never advanced past preparing.');
        $this->assertSame('pending', $order->payment_status, 'Order still unpaid.');
        $this->assertSame(
            2,
            CodPurchase::where('delivery_id', $delivery->id)->where('status', CodPurchase::STATUS_PENDING)->count(),
            'Purchase stops still pending — nothing was collected.'
        );
        $this->assertSame(0, CodSettlement::count(), 'No settlement was booked.');
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'accepted')->count());
    }
}
