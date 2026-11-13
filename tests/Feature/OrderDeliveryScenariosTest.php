<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\Concerns\CompletesDeliveriesWithProof;
use Tests\TestCase;

/**
 * Order → delivery scenarios over the real HTTP endpoints (2026-11-10): the
 * paths a tourist, restaurant and rider actually take, including the wrong
 * order, double taps, being too far away, cancellations and declines.
 *
 * Restaurant A ≈ 12.51,121.31 · Restaurant B ≈ 12.52,121.32 · drop-off 12.60,121.40.
 */
class OrderDeliveryScenariosTest extends TestCase
{
    use CompletesDeliveriesWithProof;
    use RefreshDatabase;

    private User $tourist;
    private User $owner;
    private User $riderA;
    private User $riderB;
    private Business $restaurantA;
    private Business $restaurantB;
    private Business $restaurantC;
    private Business $restaurantD;
    /** @var list<Business> */
    private array $restaurants;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.paymongo.secret_key' => 'sk_test_scenarios', 'services.paymongo.webhook_secret' => '']);

        $this->tourist = User::create(['email' => 'tourist@scn.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->owner = User::create(['email' => 'owner@scn.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]);
        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59'], ['open' => '23:59', 'close' => '00:00']]
        );
        $make = fn (string $name, float $lat, float $lng) => Business::create([
            'owner_id' => $this->owner->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id,
            'business_name' => $name, 'status' => 'approved', 'force_closed' => false, 'business_hours' => $allDays,
            'latitude' => $lat, 'longitude' => $lng,
        ]);
        $this->restaurantA = $make('Scenario Grill A', 12.51, 121.31);
        $this->restaurantB = $make('Scenario Grill B', 12.52, 121.32);
        $this->restaurantC = $make('Scenario Grill C', 12.53, 121.33);
        $this->restaurantD = $make('Scenario Grill D', 12.54, 121.34);
        $this->restaurants = [$this->restaurantA, $this->restaurantB, $this->restaurantC, $this->restaurantD];

        $this->riderA = $this->makeRider('ridera@scn.test');
        $this->riderB = $this->makeRider('riderb@scn.test');

        // Same partial mock as CodOrderToSettlementFlowTest: the nearest-rider
        // SQL is MySQL-only; the real offer / accept / decline logic runs.
        $this->app->instance(NearestRiderService::class, new class() extends NearestRiderService {
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
                $declined = BookingDispatchLog::where('delivery_id', $delivery->id)->pluck('rider_id')->all();
                $rider = $this->findNearestAvailableRiders((float) $delivery->pickup_latitude, (float) $delivery->pickup_longitude, $serviceType)
                    ->reject(fn ($u) => in_array($u->id, $declined, true))
                    ->first();
                if (! $rider) {
                    $delivery->update(['dispatch_status' => 'no_rider_available']);

                    return null;
                }
                BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $rider->id, 'distance_km' => 1.5, 'response' => 'pending', 'dispatched_at' => now()]);
                $delivery->update(['dispatch_status' => 'notified', 'dispatch_expires_at' => now()->addSeconds(NearestRiderService::DISPATCH_TIMEOUT_SECONDS)]);

                return $rider;
            }
        });
    }

    // ---------- helpers ----------

    private function makeRider(string $email): User
    {
        $rider = User::create(['email' => $email, 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'available', 'current_service' => 'food', 'municipality_id' => $this->restaurantA->municipality_id]);
        RiderDetail::create(['user_id' => $rider->id, 'rider_status' => 'available', 'current_service' => 'food']);
        RiderLocation::create(['rider_id' => $rider->id, 'latitude' => 12.505, 'longitude' => 121.305, 'recorded_at' => now()->subMinutes(3)]);

        return $rider;
    }

    private function riderAt(User $rider, float $lat, float $lng): void
    {
        // A fresh row each time, like the app's location heartbeat.
        RiderLocation::create(['rider_id' => $rider->id, 'latitude' => $lat, 'longitude' => $lng, 'recorded_at' => now()]);
    }

    private function item(Business $b, string $name, float $price): array
    {
        $offering = Offering::create(['business_id' => $b->id, 'name' => $name, 'price' => $price, 'is_available' => true, 'status' => 'available']);

        return ['offering_id' => $offering->id, 'quantity' => 1, 'notes' => null];
    }

    /**
     * One restaurant → POST /tourist/food/order (single order, payable = Order);
     * 2+ restaurants → POST /tourist/food/group-order: a grouped checkout with
     * TWO items from EACH restaurant (one canonical order, payable =
     * GroupCheckout). A fast-delivery tip makes the order "fast".
     *
     * @return array{0: Order|GroupCheckout, 1: Order}
     */
    private function placeOrder(string $paymentMethod, int $restaurantCount = 1, float $tip = 0): array
    {
        $common = [
            'order_type' => 'delivery', 'delivery_speed' => $tip > 0 ? 'fast' : 'standard', 'rider_tip' => $tip > 0 ? $tip : null,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.6, 'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567', 'payment_method' => $paymentMethod, 'notes' => null,
        ];

        if ($restaurantCount === 1) {
            $this->be($this->tourist)->postJson('/api/tourist/food/order', $common + [
                'business_id' => $this->restaurantA->id,
                'items' => [$this->item($this->restaurantA, 'Adobo', 150), $this->item($this->restaurantA, 'Sinigang', 180)],
            ])->assertSuccessful();
            $order = Order::latest('id')->first();

            return [$order, $order];
        }

        $restaurants = [];
        foreach (array_slice($this->restaurants, 0, $restaurantCount) as $i => $b) {
            $restaurants[] = ['business_id' => $b->id, 'items' => [
                $this->item($b, "Dish {$i}-1", 100 + 10 * $i),
                $this->item($b, "Dish {$i}-2", 60 + 5 * $i),
            ]];
        }
        $this->be($this->tourist)->postJson('/api/tourist/food/group-order', $common + ['restaurants' => $restaurants])->assertCreated();
        $group = GroupCheckout::latest('id')->first();

        return [$group, $group->orders()->sole()];
    }

    /**
     * The restaurants in the rider's pickup order (GET pickup-stops, as the
     * rider app loads it; stops are created on first read).
     *
     * @return list<Business>
     */
    private function pickupRoute(Delivery $delivery): array
    {
        $this->be($this->riderA)->getJson("/api/rider/deliveries/{$delivery->id}/pickup-stops")->assertOk();
        $byId = collect($this->restaurants)->keyBy('id');

        return DeliveryPickupStop::where('delivery_id', $delivery->id)->orderBy('sequence')->pluck('business_id')
            ->map(fn ($id) => $byId[(int) $id])->values()->all();
    }

    private function itemsOf(Order $order, Business $b)
    {
        return $order->fresh()->items->filter(fn ($i) => (int) ($i->business_id ?? $order->business_id) === (int) $b->id)->values();
    }

    /** PayMongo confirms the GCash payment through the webhook. */
    private function payWithGcash(Order|GroupCheckout $payable, string $providerId = 'pay_scn_1'): void
    {
        Payment::create([
            'payment_number' => 'PAY-'.strtoupper(uniqid()), 'payable_type' => $payable::class, 'payable_id' => $payable->id,
            'user_id' => $this->tourist->id, 'amount' => $payable instanceof Order ? $payable->total : $payable->grand_total, 'method' => 'gcash',
            'provider_payment_id' => $providerId, 'status' => 'pending',
        ]);
        $this->postJson('/api/payments/webhook', ['data' => [
            'id' => 'evt_'.$providerId, 'type' => 'event',
            'attributes' => ['type' => 'payment.paid', 'data' => ['id' => $providerId]],
        ]])->assertOk();
    }

    private function deliveryOf(Order $order): ?Delivery
    {
        return $order->fresh()->activeDelivery() ?? Delivery::where('order_id', $order->id)->latest('id')->first();
    }

    private function tripStatus(Delivery $d): string
    {
        return $d->fresh()->status->value;
    }

    private function accept(User $rider, Delivery $d)
    {
        return $this->be($rider)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $d->id]);
    }

    private function riderStatus(User $rider, Delivery $d, string $status)
    {
        return $this->be($rider)->patchJson("/api/rider/deliveries/{$d->id}/status", ['status' => $status]);
    }

    private function arriveStop(User $rider, Delivery $d, Business $b)
    {
        return $this->be($rider)->postJson("/api/rider/deliveries/{$d->id}/pickup-stops/{$b->id}/arrive");
    }

    private function confirmStop(User $rider, Delivery $d, Business $b)
    {
        return $this->be($rider)->postJson("/api/rider/deliveries/{$d->id}/pickup-stops/{$b->id}/confirm");
    }

    private function readyFood(Order $order, Business $b)
    {
        // Single-restaurant orders keep the restaurant on the order (item business_id null).
        $items = $order->fresh()->items->filter(fn ($i) => (int) ($i->business_id ?? $order->business_id) === (int) $b->id);
        $this->assertNotEmpty($items);
        foreach ($items as $item) {
            $this->be($this->owner)
                ->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'ready'])
                ->assertOk();
        }
    }

    private function riderDetailStatus(User $rider): string
    {
        return $rider->fresh()->riderDetail->rider_status;
    }

    // ───────────────────────────────────────────────────────────────
    // 1. GCash, one restaurant: every step in order, with the wrong
    //    step / too far / double tap tried at each stage.
    // ───────────────────────────────────────────────────────────────
    public function test_gcash_order_runs_end_to_end_and_refuses_every_out_of_order_step(): void
    {
        [$group, $order] = $this->placeOrder('gcash');
        $this->assertSame('pending_payment', $order->status);
        $this->assertSame(0, BookingDispatchLog::count(), 'No rider is offered an unpaid GCash order.');

        $this->payWithGcash($group);
        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $delivery = $this->deliveryOf($order);
        $this->assertNotNull($delivery, 'Paying creates the delivery.');
        $this->assertSame($this->riderA->id, BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->value('rider_id'));

        // Restaurant cannot prepare before a rider accepts (AGENTS §4.2).
        $item = $order->items()->first();
        $this->be($this->owner)->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'preparing'])->assertStatus(422);

        // The offered rider accepts; afterwards nobody else can take it
        // (open deliveries are first-accept-wins, RiderOpenDeliveryClaimTest).
        $this->accept($this->riderA, $delivery)->assertOk();
        $this->accept($this->riderB, $delivery)->assertStatus(409);
        $this->assertSame('assigned', $this->tripStatus($delivery));
        $this->assertSame('preparing', $order->fresh()->status);
        $this->assertSame('busy', $this->riderDetailStatus($this->riderA));
        // Double tap on Accept: harmless.
        $this->accept($this->riderA, $delivery);
        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id);
        $this->assertSame(1, Delivery::count());

        // Skipping ahead is refused.
        $this->assertContains($this->riderStatus($this->riderA, $delivery, 'picked_up')->status(), [409, 422]);
        $this->assertContains($this->riderStatus($this->riderA, $delivery, 'arrived_destination')->status(), [409, 422]);
        $this->assertSame('assigned', $this->tripStatus($delivery));

        // Arrival at the restaurant needs the rider within 50 m.
        $this->riderAt($this->riderA, 12.55, 121.35);
        $this->arriveStop($this->riderA, $delivery, $this->restaurantA)->assertStatus(422);
        $this->riderAt($this->riderA, 12.5101, 121.3101);
        $this->arriveStop($this->riderA, $delivery, $this->restaurantA)->assertOk();
        $this->assertSame('arrived_pickup', $this->tripStatus($delivery));

        // The TT-62973 case: confirming pickup before the food is ready is refused…
        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertStatus(422);
        $this->assertSame(DeliveryPickupStop::STATUS_PENDING, DeliveryPickupStop::where('delivery_id', $delivery->id)->value('status'));
        // …and once the restaurant marks it ready, the same button works.
        $this->readyFood($order, $this->restaurantA);
        $this->assertSame('ready', $order->fresh()->status);
        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertOk();
        $this->assertSame('picked_up', $this->tripStatus($delivery), 'The last pickup moves the trip on.');
        // Double tap on Confirm Pickup: refused, nothing changes.
        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertStatus(422);
        $this->assertSame('picked_up', $this->tripStatus($delivery));

        // On the way: far from the tourist, "I've arrived" and completion are refused.
        $this->riderStatus($this->riderA, $delivery, 'in_transit')->assertOk();
        $this->riderAt($this->riderA, 12.55, 121.35);
        $this->riderStatus($this->riderA, $delivery, 'arrived_destination')->assertStatus(422);
        $this->assertSame('in_transit', $this->tripStatus($delivery));

        $this->riderIsAtDropoff($delivery, $this->riderA);
        $this->riderStatus($this->riderA, $delivery, 'arrived_destination')->assertOk();
        $this->riderStatus($this->riderA, $delivery, 'delivered')->assertStatus(422); // photo required

        $this->riderCompletesDelivery($delivery, $this->riderA)->assertOk();
        $this->assertSame('completed', $this->tripStatus($delivery));
        $this->assertSame('completed', $order->fresh()->status);
        $this->assertSame('available', $this->riderDetailStatus($this->riderA), 'Rider is free for the next order.');
        $this->assertSame(1, RiderEarning::where('rider_id', $this->riderA->id)->count());

        // Double tap on Confirm Delivered: refused, still one earning.
        $this->riderCompletesDelivery($delivery, $this->riderA)->assertStatus(422);
        $this->assertSame(1, RiderEarning::where('rider_id', $this->riderA->id)->count());

        // Diagnostics after the trip: nothing to fix.
        $diag = $this->be($this->riderA)->postJson('/api/rider/diagnostics/repair', ['latitude' => 12.6, 'longitude' => 121.4, 'accuracy' => 10])->assertOk()->json('data');
        $this->assertSame([], array_values(array_filter($diag['repaired'], fn ($r) => ! str_starts_with($r, 'Saved your current location'))));
    }

    // ───────────────────────────────────────────────────────────────
    // 2. Grouped GCash order: 4 restaurants × 2 items, one rider. The
    //    trip follows the route, waits for every restaurant, and cannot
    //    leave the pickup area until all 4 are collected.
    // ───────────────────────────────────────────────────────────────
    public function test_grouped_gcash_order_from_four_restaurants_shares_one_rider(): void
    {
        [$group, $order] = $this->placeOrder('gcash', 4, tip: 50);
        $this->assertCount(8, $order->items, '4 restaurants × 2 items in ONE canonical order.');
        $this->assertSame(1, $group->orders()->count());
        $this->assertSame(0, BookingDispatchLog::count(), 'Unpaid: no rider yet.');

        $this->payWithGcash($group);
        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();
        $this->assertSame(1, Delivery::count(), 'One delivery for all 4 restaurants.');

        $route = $this->pickupRoute($delivery);
        $this->assertCount(4, $route);
        $this->assertEqualsCanonicalizing(collect($this->restaurants)->pluck('id')->all(), collect($route)->pluck('id')->all());

        // Half-ready restaurant: one of two dishes ready is not enough.
        $last = $route[3];
        $lastItems = $this->itemsOf($order, $last);
        $this->assertCount(2, $lastItems);
        $this->be($this->owner)->patchJson("/api/business-owner/orders/{$order->id}/items/{$lastItems[0]->id}/status", ['status' => 'ready'])->assertOk();

        // Out of route order: the last restaurant cannot be visited first.
        $this->riderAt($this->riderA, (float) $last->latitude, (float) $last->longitude);
        $this->arriveStop($this->riderA, $delivery, $last)->assertStatus(422);

        foreach (array_slice($route, 0, 3) as $n => $b) {
            $this->readyFood($order, $b);
            $this->riderAt($this->riderA, (float) $b->latitude, (float) $b->longitude);
            $this->arriveStop($this->riderA, $delivery, $b)->assertOk();
            $this->confirmStop($this->riderA, $delivery, $b)->assertOk();
            $this->assertSame('arrived_pickup', $this->tripStatus($delivery), 'Still collecting after stop '.($n + 1).' of 4.');
            $this->riderStatus($this->riderA, $delivery, 'in_transit')->assertStatus(422);
        }
        $this->assertSame('preparing', $order->fresh()->status, 'Order is ready only when every restaurant is.');

        $this->riderAt($this->riderA, (float) $last->latitude, (float) $last->longitude);
        $this->arriveStop($this->riderA, $delivery, $last)->assertOk();
        $this->confirmStop($this->riderA, $delivery, $last)->assertStatus(422); // only 1 of 2 dishes ready
        $this->be($this->owner)->patchJson("/api/business-owner/orders/{$order->id}/items/{$lastItems[1]->id}/status", ['status' => 'ready'])->assertOk();
        $this->assertSame('ready', $order->fresh()->status);
        $this->confirmStop($this->riderA, $delivery, $last)->assertOk();
        $this->assertSame('picked_up', $this->tripStatus($delivery));
        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id);

        $this->riderStatus($this->riderA, $delivery, 'in_transit')->assertOk();
        $this->riderIsAtDropoff($delivery, $this->riderA);
        $this->riderStatus($this->riderA, $delivery, 'arrived_destination')->assertOk();
        $this->riderCompletesDelivery($delivery, $this->riderA)->assertOk();
        $this->assertSame('completed', $order->fresh()->status);
        $earning = RiderEarning::where('rider_id', $this->riderA->id)->sole();
        $this->assertEquals(50.0, (float) $earning->rider_tip, 'One earning, with the tip, for the shared trip.');
        $this->assertSame(0, \App\Models\CodSettlement::count(), 'Paid online: no COD settlement.');
    }

    // ───────────────────────────────────────────────────────────────
    // 3. Cancellation: the tourist may cancel until a rider accepts;
    //    then the cancel is refused and the trip continues.
    // ───────────────────────────────────────────────────────────────
    public function test_tourist_cancel_before_acceptance_withdraws_the_offer(): void
    {
        [, $order] = $this->placeOrder('cash');
        $delivery = $this->deliveryOf($order);
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->count());

        $this->be($this->tourist)->postJson("/api/tourist/food/order/{$order->id}/cancel", ['reason' => 'Changed my mind'])->assertOk();

        $this->assertSame('cancelled_by_tourist', $order->fresh()->status);
        $this->assertSame('cancelled', $this->tripStatus($delivery));
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->count(), 'Offer withdrawn.');

        // The rider tapping Accept on the stale offer gets nothing.
        $this->accept($this->riderA, $delivery)->assertStatus(409);
        $this->assertNull($delivery->fresh()->rider_id);
        $this->assertSame('available', $this->riderDetailStatus($this->riderA));
        $this->be($this->riderA)->getJson('/api/rider/dispatch/offers')->assertOk()->assertJsonPath('data.offers', []);
    }

    public function test_tourist_cannot_cancel_after_a_rider_accepted(): void
    {
        [, $order] = $this->placeOrder('cash');
        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();

        $this->be($this->tourist)->postJson("/api/tourist/food/order/{$order->id}/cancel")->assertStatus(422);

        $this->assertSame('assigned', $this->tripStatus($delivery));
        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id);
        $this->assertSame('busy', $this->riderDetailStatus($this->riderA));
    }

    public function test_another_tourist_cannot_cancel_my_order(): void
    {
        [, $order] = $this->placeOrder('cash');
        $other = User::create(['email' => 'other@scn.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);

        $this->be($other)->postJson("/api/tourist/food/order/{$order->id}/cancel")->assertForbidden();
        $this->assertSame('waiting_restaurant', $order->fresh()->status);
    }

    // ───────────────────────────────────────────────────────────────
    // 4. Decline → the next rider is offered; the decliner cannot take it.
    // ───────────────────────────────────────────────────────────────
    public function test_declined_offer_moves_to_the_next_rider(): void
    {
        [, $order] = $this->placeOrder('cash');
        $delivery = $this->deliveryOf($order);

        $this->be($this->riderA)->patchJson('/api/rider/dispatch/decline', ['delivery_id' => $delivery->id])->assertOk();

        $this->assertSame('declined', BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $this->riderA->id)->value('response'));
        $this->assertSame('pending', BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $this->riderB->id)->value('response'), 'Re-offered to rider B.');

        $this->accept($this->riderB, $delivery)->assertOk();
        $this->accept($this->riderA, $delivery)->assertStatus(409);
        $this->assertSame($this->riderB->id, $delivery->fresh()->rider_id);
        $this->assertSame('available', $this->riderDetailStatus($this->riderA));
    }

    // ───────────────────────────────────────────────────────────────
    // 5. One active delivery per rider (AGENTS §4.3).
    // ───────────────────────────────────────────────────────────────
    public function test_a_rider_on_a_trip_cannot_accept_a_second_one(): void
    {
        [, $order1] = $this->placeOrder('cash');
        $delivery1 = $this->deliveryOf($order1);
        $this->accept($this->riderA, $delivery1)->assertOk();

        [, $order2] = $this->placeOrder('cash');
        $delivery2 = $this->deliveryOf($order2);
        // The busy rider A is not offered it; even forcing the request fails.
        $this->assertNotSame($this->riderA->id, BookingDispatchLog::where('delivery_id', $delivery2->id)->where('response', 'pending')->value('rider_id'));
        $this->assertGreaterThanOrEqual(400, $this->accept($this->riderA, $delivery2)->status());
        $this->assertNotSame($this->riderA->id, $delivery2->fresh()->rider_id);
        $this->assertSame(1, Delivery::where('rider_id', $this->riderA->id)->whereNotIn('status', ['completed', 'cancelled'])->count());
    }

    // ───────────────────────────────────────────────────────────────
    // 6. Ownership: other riders / roles cannot drive the trip.
    // ───────────────────────────────────────────────────────────────
    public function test_only_the_assigned_rider_can_move_the_trip(): void
    {
        [$group, $order] = $this->placeOrder('gcash');
        $this->payWithGcash($group);
        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();
        $this->riderAt($this->riderB, 12.5101, 121.3101);

        $this->arriveStop($this->riderB, $delivery, $this->restaurantA)->assertForbidden();
        $this->confirmStop($this->riderB, $delivery, $this->restaurantA)->assertForbidden();
        $this->riderStatus($this->riderB, $delivery, 'arrived_pickup')->assertForbidden();
        $this->be($this->tourist)->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => 'arrived_pickup'])->assertForbidden();
        $this->riderCompletesDelivery($delivery, $this->riderB)->assertForbidden();

        $this->assertSame('assigned', $this->tripStatus($delivery));
        $this->assertSame($this->riderA->id, $delivery->fresh()->rider_id);
    }

    // ───────────────────────────────────────────────────────────────
    // 7. Location problems mid-trip: a 0,0-axis fix and a teleport are
    //    refused; Diagnostics explains and repairs nothing it shouldn't.
    // ───────────────────────────────────────────────────────────────
    public function test_bad_locations_mid_trip_are_refused_and_diagnostics_explains(): void
    {
        [$group, $order] = $this->placeOrder('gcash');
        $this->payWithGcash($group);
        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();

        $this->be($this->riderA)->postJson('/api/rider/map/location', ['latitude' => 12.96, 'longitude' => 0])->assertStatus(422);

        $this->be($this->riderA)->postJson('/api/rider/map/location', ['latitude' => 12.5101, 'longitude' => 121.3101, 'accuracy' => 10])->assertOk();
        $saved = RiderLocation::where('rider_id', $this->riderA->id)->count();

        // 15 km in the same second (e.g. another tab on the same login): not saved.
        $this->be($this->riderA)->postJson('/api/rider/map/location', ['latitude' => 12.64, 'longitude' => 121.31, 'accuracy' => 10])
            ->assertOk()->assertJsonPath('data.reason', 'implausible_movement');
        // Coarse fix 10 s later (a plausible 210 m move): not saved either.
        $this->travel(10)->seconds();
        $this->be($this->riderA)->postJson('/api/rider/map/location', ['latitude' => 12.512, 'longitude' => 121.3101, 'accuracy' => 150])
            ->assertOk()->assertJsonPath('data.reason', 'low_accuracy');
        $this->assertSame($saved, RiderLocation::where('rider_id', $this->riderA->id)->count());

        $before = $this->tripStatus($delivery); // a fix at the restaurant auto-arrives (100 m geofence)
        $diag = $this->be($this->riderA)->postJson('/api/rider/diagnostics/repair', ['latitude' => 12.64, 'longitude' => 121.31, 'accuracy' => 10])->assertOk()->json('data');
        $location = collect($diag['checks'])->firstWhere('key', 'location');
        $this->assertSame('warn', $location['status']);
        $this->assertSame($saved, RiderLocation::where('rider_id', $this->riderA->id)->count(), 'Diagnostics never saves a teleport.');
        $this->assertSame($before, $this->tripStatus($delivery), 'Diagnostics leaves the trip alone.');
        $this->assertSame('busy', $this->riderDetailStatus($this->riderA));
    }

    // ───────────────────────────────────────────────────────────────
    // 8. Payment edge cases: the same webhook twice; a payment that
    //    lands after the tourist cancelled the unpaid order.
    // ───────────────────────────────────────────────────────────────
    public function test_a_repeated_paid_webhook_dispatches_once(): void
    {
        [$payable, $order] = $this->placeOrder('gcash');
        $this->payWithGcash($payable, 'pay_dup');
        $this->postJson('/api/payments/webhook', ['data' => [
            'id' => 'evt_pay_dup', 'type' => 'event',
            'attributes' => ['type' => 'payment.paid', 'data' => ['id' => 'pay_dup']],
        ]])->assertOk();

        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());
        $this->assertSame(1, BookingDispatchLog::where('response', 'pending')->count());
        $this->assertSame('paid', $order->fresh()->payment_status);
    }

    public function test_a_payment_after_the_tourist_cancelled_never_dispatches_a_rider(): void
    {
        [$payable, $order] = $this->placeOrder('gcash');
        $this->be($this->tourist)->postJson("/api/tourist/food/order/{$order->id}/cancel")->assertOk();
        $this->assertSame('cancelled_by_tourist', $order->fresh()->status);

        Http::fake(['api.paymongo.com/v1/refunds' => Http::response([
            'data' => ['id' => 'ref_late_1', 'attributes' => ['status' => 'pending']],
        ], 200)]);

        $this->payWithGcash($payable, 'pay_late');

        $order->refresh();
        $this->assertContains($order->status, ['cancelled_by_tourist', 'cancelled'], 'A cancelled order is not revived by a late payment.');
        $this->assertSame(0, BookingDispatchLog::where('response', 'pending')->count(), 'No rider is offered a cancelled order.');
        $this->assertSame(0, Delivery::whereNotIn('status', ['cancelled', 'completed'])->count());
        // The money is sent back through PayMongo (provider-authoritative: pending until confirmed).
        // Documented PayMongo "Create a Refund": POST /v1/refunds with payment_id
        // and a reason from PayMongo's fixed list (free text goes in notes).
        Http::assertSent(fn ($request) => str_ends_with($request->url(), '/v1/refunds')
            && $request->data()['data']['attributes']['payment_id'] === 'pay_late'
            && in_array($request->data()['data']['attributes']['reason'], ['duplicate', 'fraudulent', 'requested_by_customer', 'others'], true));
        $this->assertSame('pending_refund', Payment::where('provider_payment_id', 'pay_late')->value('status'));
    }

    public function test_a_late_group_payment_does_not_revive_cancelled_restaurant_orders(): void
    {
        [$group, $order] = $this->placeOrder('gcash', 4);
        $this->be($this->tourist)->postJson("/api/tourist/food/order/{$order->id}/cancel")->assertOk();
        $this->assertSame('cancelled_by_tourist', $order->fresh()->status);

        $this->payWithGcash($group, 'pay_group_late');

        $this->assertSame('cancelled_by_tourist', $order->fresh()->status);
        $this->assertSame(0, BookingDispatchLog::where('response', 'pending')->count());
        $this->assertSame(0, Delivery::whereNotIn('status', ['cancelled', 'completed'])->count());
        $this->assertSame(1, \App\Models\Refund::where('order_id', $order->id)->count(), 'The cancelled order is refunded once.');
    }

    // ═══════════════════════════════════════════════════════════════
    // COD (cash on delivery)
    // ═══════════════════════════════════════════════════════════════

    private function paymentReceived(Order $order, Business $b, ?User $owner = null)
    {
        return $this->be($owner ?? $this->owner)->postJson("/api/business-owner/orders/{$order->id}/cod-payment-received", ['business_id' => $b->id]);
    }

    private function readyOneItem(Order $order, Business $b, int $index = 0)
    {
        $item = $this->itemsOf($order, $b)[$index];

        return $this->be($this->owner)->patchJson("/api/business-owner/orders/{$order->id}/items/{$item->id}/status", ['status' => 'ready']);
    }

    // 9. COD, one restaurant, fast tip: every step plus the wrong ones.
    public function test_cod_order_runs_end_to_end_with_cash_settled_once(): void
    {
        [, $order] = $this->placeOrder('cash', tip: 30);
        $this->assertSame('waiting_restaurant', $order->status);
        $this->assertSame('pending', $order->payment_status);
        $delivery = $this->deliveryOf($order);
        $this->assertNotNull($delivery, 'COD is offered to riders at placement (no online payment).');

        // Before a rider accepts: no payment confirmation, no cooking.
        $this->paymentReceived($order, $this->restaurantA)->assertStatus(422);
        $this->readyOneItem($order, $this->restaurantA)->assertStatus(422);

        $this->accept($this->riderA, $delivery)->assertOk();
        $delivery->refresh();
        $this->assertEquals((float) $order->fresh()->total, (float) $delivery->cash_due, 'Cash due = the whole order total.');
        $this->assertSame('preparing', $order->fresh()->status);

        // Accepted, but the rider is not at the restaurant yet.
        $this->paymentReceived($order, $this->restaurantA)->assertStatus(422);
        $this->readyOneItem($order, $this->restaurantA)->assertStatus(422);

        $this->riderAt($this->riderA, 12.5101, 121.3101);
        $this->arriveStop($this->riderA, $delivery, $this->restaurantA)->assertOk();

        // Pickup stays locked until the restaurant confirms the payment and readies the food.
        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertStatus(422);
        $this->paymentReceived($order, $this->restaurantA)->assertOk();
        $this->paymentReceived($order, $this->restaurantA)->assertOk()->assertJsonPath('data.already_confirmed', true);
        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertStatus(422); // food not ready yet
        $this->readyFood($order, $this->restaurantA);
        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertOk();
        $this->assertSame('picked_up', $this->tripStatus($delivery));

        // Not delivered yet: no cash can be settled.
        $this->be($this->riderA)->postJson("/api/rider/deliveries/{$delivery->id}/settle-cod", ['cash_received' => (float) $delivery->cash_due])->assertStatus(422);

        $this->riderStatus($this->riderA, $delivery, 'in_transit')->assertOk();
        $this->riderIsAtDropoff($delivery, $this->riderA);
        $this->riderStatus($this->riderA, $delivery, 'arrived_destination')->assertOk();
        $this->riderCompletesDelivery($delivery, $this->riderA)->assertOk()->assertJsonPath('data.cod_settled', true);

        $order->refresh();
        $delivery->refresh();
        $this->assertSame('completed', $delivery->status->value);
        $this->assertSame('completed', $order->status);
        $this->assertSame('paid', $order->payment_status);
        $this->assertEquals((float) $order->total, (float) $delivery->cash_received);

        $cash = Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->get();
        $this->assertCount(1, $cash, 'One cash payment.');
        $this->assertSame('cash', $cash[0]->method);
        $this->assertEquals((float) $order->total, (float) $cash[0]->amount);

        $settlements = \App\Models\CodSettlement::where('delivery_id', $delivery->id)->get();
        $this->assertCount(1, $settlements);
        $base = (float) $settlements[0]->settlement_base;
        $this->assertEquals((float) $order->rider_financed_amount, $base, 'Settlement base = rider-financed amount.');
        $this->assertEquals(round($base * 0.8, 2), (float) $settlements[0]->restaurant_share);
        $this->assertEquals(round($base * 0.2, 2), (float) $settlements[0]->platform_fee);
        $this->assertLessThan((float) $order->total, $base, 'The delivery fee and tip are not in the 80/20 base.');

        $earning = RiderEarning::where('rider_id', $this->riderA->id)->sole();
        $this->assertEquals(30.0, (float) $earning->rider_tip, 'The tip belongs to the rider.');
        $this->assertLessThan((float) $order->total, (float) $earning->total_earning, 'Earnings are never the COD cash.');
        $this->assertSame('available', $this->riderDetailStatus($this->riderA));

        // Double taps after completion book nothing more.
        $this->riderCompletesDelivery($delivery, $this->riderA)->assertStatus(422);
        $this->be($this->riderA)->postJson("/api/rider/deliveries/{$delivery->id}/settle-cod", ['cash_received' => (float) $order->total])->assertStatus(422);
        $this->assertSame(1, \App\Models\CodSettlement::where('delivery_id', $delivery->id)->count());
        $this->assertSame(1, Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->count());
        $this->assertSame(1, RiderEarning::where('rider_id', $this->riderA->id)->count());
    }

    // 10. Grouped COD order: 4 restaurants × 2 items. Each restaurant
    //     confirms only its own payment, only while the rider is at it; one
    //     does not unlock another; one settlement per restaurant; one earning.
    public function test_grouped_cod_order_from_four_restaurants_settles_each_restaurant_once(): void
    {
        [$group, $order] = $this->placeOrder('cash', 4, tip: 40);
        $this->assertCount(8, $order->items);
        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();
        $this->assertEquals((float) $group->fresh()->grand_total, (float) $delivery->fresh()->cash_due, 'Cash due = the grouped total.');
        $this->assertSame(4, \App\Models\CodPurchase::where('delivery_id', $delivery->id)->count(), 'One purchase per restaurant.');

        $route = $this->pickupRoute($delivery);
        $this->assertCount(4, $route);

        foreach ($route as $n => $b) {
            $this->riderAt($this->riderA, (float) $b->latitude, (float) $b->longitude);
            $this->arriveStop($this->riderA, $delivery, $b)->assertOk();

            // The NEXT restaurant cannot confirm a payment or cook while the rider is here.
            if (isset($route[$n + 1])) {
                $this->paymentReceived($order, $route[$n + 1])->assertStatus(422);
                $this->readyOneItem($order, $route[$n + 1])->assertStatus(422);
            }

            $this->readyOneItem($order, $b)->assertStatus(422); // not paid yet
            $this->paymentReceived($order, $b)->assertOk();
            $this->readyOneItem($order, $b, 0)->assertOk();
            $this->confirmStop($this->riderA, $delivery, $b)->assertStatus(422); // 1 of 2 dishes ready
            $this->readyOneItem($order, $b, 1)->assertOk();
            $this->confirmStop($this->riderA, $delivery, $b)->assertOk();

            $this->assertSame($n < 3 ? 'arrived_pickup' : 'picked_up', $this->tripStatus($delivery), 'After stop '.($n + 1).' of 4.');
        }
        $this->assertSame(4, \App\Models\CodPurchase::where('delivery_id', $delivery->id)->where('status', 'collected')->count());

        $this->riderStatus($this->riderA, $delivery, 'in_transit')->assertOk();
        $this->riderIsAtDropoff($delivery, $this->riderA);
        $this->riderStatus($this->riderA, $delivery, 'arrived_destination')->assertOk();
        $this->riderCompletesDelivery($delivery, $this->riderA)->assertOk()->assertJsonPath('data.cod_settled', true);

        $order->refresh();
        $settlements = \App\Models\CodSettlement::where('delivery_id', $delivery->id)->get();
        $this->assertCount(4, $settlements, 'One settlement per restaurant.');
        $this->assertEqualsCanonicalizing(collect($this->restaurants)->pluck('id')->all(), $settlements->pluck('business_id')->map(fn ($id) => (int) $id)->all());
        $this->assertEquals((float) $order->rider_financed_amount, round($settlements->sum(fn ($x) => (float) $x->settlement_base), 2), 'The 4 bases add up to the financed amount.');
        foreach ($settlements as $x) {
            $this->assertEquals((float) $x->settlement_base, round((float) $x->restaurant_share + (float) $x->platform_fee, 2));
            $this->assertEquals(80, round((float) $x->restaurant_share / (float) $x->settlement_base * 100));
        }
        $cash = Payment::where('method', 'cash')->get();
        $this->assertCount(1, $cash, 'The tourist pays the rider once for all 4 restaurants.');
        $this->assertEquals((float) $group->fresh()->grand_total, (float) $cash[0]->amount);
        $earning = RiderEarning::where('rider_id', $this->riderA->id)->sole();
        $this->assertEquals(40.0, (float) $earning->rider_tip);
        $this->assertSame('completed', $order->status);
        $this->assertSame('available', $this->riderDetailStatus($this->riderA));
    }

    // 11. COD ownership: only the restaurant's owner can confirm its payment.
    public function test_cod_payment_can_only_be_confirmed_by_the_restaurant_owner(): void
    {
        [, $order] = $this->placeOrder('cash');
        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();
        $this->riderAt($this->riderA, 12.5101, 121.3101);
        $this->arriveStop($this->riderA, $delivery, $this->restaurantA)->assertOk();

        $stranger = User::create(['email' => 'stranger@scn.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->paymentReceived($order, $this->restaurantA, $stranger)->assertForbidden();
        $this->be($this->riderA)->postJson("/api/business-owner/orders/{$order->id}/cod-payment-received", ['business_id' => $this->restaurantA->id])->assertForbidden();
        $this->be($this->tourist)->postJson("/api/business-owner/orders/{$order->id}/cod-payment-received", ['business_id' => $this->restaurantA->id])->assertForbidden();

        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertStatus(422);
    }

    // 12. COD paid online with GCash mid-trip: no restaurant payment step,
    //     no cash collected at the door, no COD settlement.
    public function test_cod_paid_online_mid_trip_needs_no_cash(): void
    {
        [, $order] = $this->placeOrder('cash');
        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();

        $this->payWithGcash($order->fresh(), 'pay_cod_online');
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertSame('preparing', $order->fresh()->status, 'Progress kept.');

        $this->riderAt($this->riderA, 12.5101, 121.3101);
        $this->arriveStop($this->riderA, $delivery, $this->restaurantA)->assertOk();
        $this->readyFood($order, $this->restaurantA); // no "Payment received" needed
        $this->confirmStop($this->riderA, $delivery, $this->restaurantA)->assertOk();
        $this->riderStatus($this->riderA, $delivery, 'in_transit')->assertOk();
        $this->riderIsAtDropoff($delivery, $this->riderA);
        $this->riderStatus($this->riderA, $delivery, 'arrived_destination')->assertOk();
        $this->riderCompletesDelivery($delivery, $this->riderA)->assertOk();

        $this->assertSame('completed', $order->fresh()->status);
        $this->assertSame(0, \App\Models\CodSettlement::where('delivery_id', $delivery->id)->count(), 'No COD settlement for an order paid online.');
        $this->assertSame(0, Payment::where('method', 'cash')->count(), 'No cash recorded.');
        $this->assertSame(1, RiderEarning::where('rider_id', $this->riderA->id)->count());
        $this->assertSame('available', $this->riderDetailStatus($this->riderA));
    }

    // 13. Grouped COD cancelled before acceptance: no money trail at all.
    public function test_grouped_cod_cancelled_before_acceptance_leaves_no_money_trail(): void
    {
        [, $order] = $this->placeOrder('cash', 4);
        $delivery = $this->deliveryOf($order);
        $this->be($this->tourist)->postJson("/api/tourist/food/order/{$order->id}/cancel")->assertOk();

        $this->assertSame('cancelled', $this->tripStatus($delivery));
        $this->assertSame(0, \App\Models\CodPurchase::where('delivery_id', $delivery->id)->count());
        $this->assertSame(0, \App\Models\CodSettlement::count());
        $this->assertSame(0, Payment::count());
        $this->assertSame(0, RiderEarning::count());
        $this->assertSame(0, \App\Models\Refund::count(), 'Nothing was paid, so nothing is refunded.');
    }

    // 14. Grouped COD: the tourist drops one restaurant (both its items)
    //     before a rider accepts. The rider then carries cash for 3
    //     restaurants, visits 3, and 3 are settled. Nothing was paid, so
    //     nothing is "refunded".
    public function test_grouped_cod_with_one_restaurant_dropped_before_acceptance(): void
    {
        [$group, $order] = $this->placeOrder('cash', 4);
        $dropped = $this->restaurantD;
        foreach ($this->itemsOf($order, $dropped) as $item) {
            $this->be($this->tourist)->postJson("/api/tourist/food/order/{$order->id}/cancel-item", ['item_id' => $item->id, 'quantity' => 1])->assertOk();
        }
        $this->assertSame(0, \App\Models\Refund::count(), 'Unpaid COD: no refund record for money never paid.');

        $delivery = $this->deliveryOf($order);
        $this->accept($this->riderA, $delivery)->assertOk();
        $order->refresh();

        $activeTotal = round($order->items->sum(fn ($i) => $i->activeQuantity() * (float) $i->unit_price), 2);
        $droppedTotal = round($this->itemsOf($order, $dropped)->sum(fn ($i) => (float) $i->subtotal), 2);
        $this->assertGreaterThan(0, $droppedTotal);
        $this->assertLessThanOrEqual((float) $order->total, (float) $delivery->fresh()->cash_due);
        $this->assertSame(3, \App\Models\CodPurchase::where('delivery_id', $delivery->id)->count(), 'No purchase for the dropped restaurant.');
        $this->assertEquals($activeTotal, (float) $order->subtotal, 'Unpaid COD is re-priced: the dropped food is off the bill.');
        $this->assertEquals(\App\Models\Order::calculateRiderFinancedAmount($activeTotal, \App\Models\Order::calculateSystemFee($activeTotal)), (float) $order->rider_financed_amount);
        $this->assertEquals((float) $order->total, (float) $delivery->fresh()->cash_due, 'Cash due = the reduced total.');
        $this->assertEquals((float) $group->fresh()->grand_total, (float) $order->total);
        $this->assertEquals((float) $order->rider_financed_amount, round(\App\Models\CodPurchase::where('delivery_id', $delivery->id)->sum('purchase_amount'), 2), 'Purchases = food still ordered + service fee.');

        $route = $this->pickupRoute($delivery);
        $this->assertCount(3, $route, 'The rider is not sent to the dropped restaurant.');
        $this->assertNotContains($dropped->id, collect($route)->pluck('id')->all());

        foreach ($route as $b) {
            $this->riderAt($this->riderA, (float) $b->latitude, (float) $b->longitude);
            $this->arriveStop($this->riderA, $delivery, $b)->assertOk();
            $this->paymentReceived($order, $b)->assertOk();
            $this->readyFood($order, $b);
            $this->confirmStop($this->riderA, $delivery, $b)->assertOk();
        }
        $this->assertSame('picked_up', $this->tripStatus($delivery));
        $this->paymentReceived($order, $dropped)->assertStatus(403); // no active items of D any more

        $this->riderStatus($this->riderA, $delivery, 'in_transit')->assertOk();
        $this->riderIsAtDropoff($delivery, $this->riderA);
        $this->riderStatus($this->riderA, $delivery, 'arrived_destination')->assertOk();
        $this->riderCompletesDelivery($delivery, $this->riderA)->assertOk()->assertJsonPath('data.cod_settled', true);

        $settlements = \App\Models\CodSettlement::where('delivery_id', $delivery->id)->get();
        $this->assertCount(3, $settlements);
        $this->assertNotContains($dropped->id, $settlements->pluck('business_id')->map(fn ($id) => (int) $id)->all());
        $this->assertEquals((float) $order->fresh()->rider_financed_amount, round($settlements->sum(fn ($x) => (float) $x->settlement_base), 2), 'Settled on the food actually delivered.');
        $cash = Payment::where('method', 'cash')->sole();
        $this->assertEquals((float) $delivery->fresh()->cash_received, (float) $cash->amount);
        $this->assertEquals(round((float) $order->fresh()->total, 2), round((float) $cash->amount, 2), 'The tourist pays the reduced total.');
    }

    // 2026-11-11: a CASH ride booking end to end. A ride has no restaurant, so
    // it must never create COD restaurant purchases or an 80/20 settlement;
    // claiming it used to fail with 409, and "Passenger On Board" with
    // "Collect food from every restaurant before leaving the pickup area."
    public function test_cash_ride_booking_runs_end_to_end(): void
    {
        $rider = $this->riderA;
        $rider->riderDetail()->update(['current_service' => 'transport']);

        $this->be($this->tourist)->postJson('/api/tourist/transport/book', [
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Gloria, Oriental Mindoro',
            'destination_lat' => 12.53, 'destination_lng' => 121.33, 'destination_address' => 'Pag-asa, Bansud',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ])->assertStatus(201);

        $order = Order::where('order_type', 'transport')->latest('id')->firstOrFail();
        $delivery = $this->deliveryOf($order);
        $this->assertNotNull($delivery);

        $this->accept($rider, $delivery)->assertOk();
        $this->assertSame(0, \App\Models\CodPurchase::where('delivery_id', $delivery->id)->count(), 'A ride buys no food.');

        $this->riderAt($rider, 12.5101, 121.3101);
        $this->riderStatus($rider, $delivery, 'arrived_pickup')->assertOk();
        $this->riderStatus($rider, $delivery, 'picked_up')->assertOk();
        $this->assertSame('picked_up', $this->tripStatus($delivery));

        $this->riderStatus($rider, $delivery, 'in_transit')->assertOk();
        $this->riderIsAtDropoff($delivery, $rider);
        $this->riderStatus($rider, $delivery, 'arrived_destination')->assertOk();
        // Rides never use the food "complete with photo" endpoint.
        $this->riderCompletesDelivery($delivery, $rider)->assertStatus(422);
        // A ride ends at the drop-off; a cash ride then records the fare collected.
        $this->riderStatus($rider, $delivery, 'delivered')->assertOk();
        $this->be($rider)->postJson("/api/rider/deliveries/{$delivery->id}/settle-cod", ['cash_received' => (float) $order->fresh()->total])
            ->assertOk();

        $order->refresh();
        $delivery->refresh();
        $this->assertSame('completed', $delivery->status->value);
        $this->assertSame('paid', $order->payment_status);
        $cash = Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->sole();
        $this->assertEquals((float) $order->total, (float) $cash->amount, 'The passenger paid the fare in cash.');
        $this->assertSame(0, \App\Models\CodSettlement::where('delivery_id', $delivery->id)->count(), 'No restaurant split for a ride.');
        $this->assertSame(1, RiderEarning::where('rider_id', $rider->id)->count());
        $this->assertSame('available', $this->riderDetailStatus($rider));

        // History: the ride is on the Ride Hailing tab with its fare and the
        // rider's earning, and never on the Deliveries (food) tab.
        $ride = $this->be($rider)->getJson('/api/rider/deliveries/completed?type=ride')->assertOk()->json('data');
        $this->assertCount(1, $ride);
        $this->assertSame($order->order_number, $ride[0]['order_number']);
        $this->assertSame('ride', $ride[0]['type']);
        $this->assertSame($order->customer_name, $ride[0]['customer_name']);
        $this->assertTrue($ride[0]['is_cod']);
        $this->assertEquals((float) $order->total, $ride[0]['total_amount']);
        $this->assertEquals((float) RiderEarning::where('rider_id', $rider->id)->sole()->total_earning, $ride[0]['earning']);
        $this->assertSame([], $this->be($rider)->getJson('/api/rider/deliveries/completed?type=food')->assertOk()->json('data'));
        $this->be($rider)->getJson('/api/rider/deliveries/completed?type=bogus')->assertStatus(422);
    }

    // 2026-11-11: the app knew the rider was at the drop-off while the server
    // still had the ride 'picked_up' (location saves lagged). "Complete Ride"
    // records the arrival first, then delivered, then the cash fare.
    public function test_cash_ride_completes_straight_from_picked_up(): void
    {
        $rider = $this->riderA;
        $rider->riderDetail()->update(['current_service' => 'transport']);
        $this->be($this->tourist)->postJson('/api/tourist/transport/book', [
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Gloria',
            'destination_lat' => 12.53, 'destination_lng' => 121.33, 'destination_address' => 'Pag-asa, Bansud',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ])->assertStatus(201);
        $order = Order::where('order_type', 'transport')->latest('id')->firstOrFail();
        $delivery = $this->deliveryOf($order);

        $this->accept($rider, $delivery)->assertOk();
        $this->riderAt($rider, 12.5101, 121.3101);
        $this->riderStatus($rider, $delivery, 'arrived_pickup')->assertOk();
        $this->riderStatus($rider, $delivery, 'picked_up')->assertOk();

        // Straight to delivered is refused, with wording that says where the trip is.
        $this->riderStatus($rider, $delivery, 'delivered')
            ->assertStatus(409)
            ->assertJsonPath('message', 'This trip is PICKED UP, so it cannot move to DELIVERED yet.');

        // The app's sequence: arrival (repeatable) → delivered → fare.
        $this->riderStatus($rider, $delivery, 'arrived_destination')->assertOk();
        $this->riderStatus($rider, $delivery, 'arrived_destination')->assertOk();
        $this->riderStatus($rider, $delivery, 'delivered')->assertOk();
        $this->be($rider)->postJson("/api/rider/deliveries/{$delivery->id}/settle-cod", ['cash_received' => (float) $order->fresh()->total])
            ->assertOk();

        $this->assertSame('completed', $delivery->fresh()->status->value);
        $this->assertSame('paid', $order->fresh()->payment_status);
    }
}
