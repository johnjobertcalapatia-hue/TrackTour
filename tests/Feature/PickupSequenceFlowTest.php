<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * The per-restaurant pickup-confirmation sequence (delivery_pickup_stops) over
 * the canonical rider HTTP endpoints:
 *
 *   GET  /api/rider/deliveries/{d}/pickup-stops
 *   POST /api/rider/deliveries/{d}/pickup-stops/{business}/confirm
 *
 * Spec gate (applies to COD AND prepaid group trips alike):
 *
 *     CAN_CONFIRM_PICKUP =
 *         stop is the current (next unconfirmed) stop in route order
 *         AND rider distance to the restaurant <= configured pickup radius
 *         AND that restaurant's order items are all READY
 *
 * The delivery may not leave the pickup area (picked_up / in_transit) until
 * every restaurant stop is confirmed. For COD the confirmation also collects
 * the matching cod_purchases row so the purchasing-cash ledger stays in step;
 * a cod_purchases row collected through the legacy mark flow counts as the
 * stop confirmed. Prepaid trips never touch the purchasing-cash ledger.
 *
 * Restaurants A (12.51, 121.31, prep 5) and B (12.52, 121.32, prep 10) so the
 * drive order is A then B; the rider's home location is Restaurant A's
 * coordinates (inside the radius for A, >1km from B).
 */
class PickupSequenceFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $rider;
    private User $otherRider;
    private Business $restaurantA;
    private Business $restaurantB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-pickup-seq@example.com',
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

        $this->restaurantA = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Pickup Seq Restaurant A',
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);

        $this->restaurantB = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Pickup Seq Restaurant B',
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.52,
            'longitude' => 121.32,
        ]);

        $this->rider = $this->makeRider('rider-pickup-seq-a@example.com');
        $this->otherRider = $this->makeRider('rider-pickup-seq-b@example.com');
    }

    // ---------- helpers ----------

    private function makeRider(string $email): User
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

    /**
     * A canonical delivery order fulfilled by both restaurants: A holds two
     * items (shortest prep → picked up first), B holds one item.
     */
    private function makeOrder(string $paymentMethod): Order
    {
        $order = Order::create([
            'order_number' => 'TT-PICKUP-SEQ-'.random_int(10000, 99999),
            'business_id' => $this->restaurantA->id,
            'customer_name' => 'Pickup Sequence Tester',
            'customer_email' => 'pickup-seq-customer@example.com',
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentMethod === 'cash' ? 'pending' : 'paid',
            'status' => $paymentMethod === 'cash' ? 'waiting_restaurant' : 'pending_payment',
            'subtotal' => 600.00,
            'delivery_fee' => 120.00,
            'system_fee' => 30.00,
            'rider_financed_amount' => 630.00,
            'rider_delivery_earnings' => 120.00,
            'delivery_address' => '123 Test St, Bansud',
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
            'delivery_distance_km' => 3.2,
            'total' => 750.00,
        ]);

        foreach ([
            ['business_id' => $this->restaurantA->id, 'product_name' => 'Burger', 'quantity' => 1, 'unit_price' => 120.00, 'subtotal' => 120.00, 'preparation_time' => 5],
            ['business_id' => $this->restaurantA->id, 'product_name' => 'Fries', 'quantity' => 2, 'unit_price' => 80.00, 'subtotal' => 160.00, 'preparation_time' => 5],
            ['business_id' => $this->restaurantB->id, 'product_name' => 'Pizza', 'quantity' => 1, 'unit_price' => 320.00, 'subtotal' => 320.00, 'preparation_time' => 10],
        ] as $item) {
            $order->items()->create($item);
        }

        return $order;
    }

    private function makeDelivery(Order $order): Delivery
    {
        return Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $this->rider->id,
            'status' => 'assigned',
            'pickup_address' => $this->restaurantA->business_name,
            'pickup_latitude' => $this->restaurantA->latitude,
            'pickup_longitude' => $this->restaurantA->longitude,
            'delivery_address' => '123 Test St, Bansud',
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
            'assigned_at' => now(),
        ]);
    }

    private function issuePurchasingCash(Delivery $delivery): void
    {
        $officer = User::create([
            'name' => 'Tourism Office',
            'email' => 'tourism-office-'.uniqid().'@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
        ]);

        $this->be($officer)
            ->postJson("/api/admin/deliveries/{$delivery->id}/issue-purchasing-cash")
            ->assertOk();

    }

    private function issueAndReceivePurchasingCash(Delivery $delivery): void
    {
        $this->issuePurchasingCash($delivery);
        $this->be($this->rider)
            ->postJson("/api/rider/deliveries/{$delivery->id}/purchasing-cash/receive")
            ->assertOk();
    }

    private function readyItems(Order $order, Business $business): void
    {
        $order->items()
            ->where('business_id', $business->id)
            ->update(['status' => 'ready', 'ready_at' => now()]);
    }

    private function placeLocation(User $rider, float $lat, float $lng): void
    {
        RiderLocation::where('rider_id', $rider->id)->delete();
        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => $lat,
            'longitude' => $lng,
            'recorded_at' => now(),
        ]);
    }

    private function latitudeAtPickupDistance(float $distanceMeters): float
    {
        $latitude = round(
            (float) $this->restaurantA->latitude + ($distanceMeters / 6371000) * (180 / M_PI),
            7
        );
        $measuredDistance = app(\App\Services\PickupSequenceService::class)->distanceMeters(
            $latitude,
            (float) $this->restaurantA->longitude,
            (float) $this->restaurantA->latitude,
            (float) $this->restaurantA->longitude
        );

        if ($distanceMeters <= 50 && $measuredDistance > 50) {
            $latitude = round($latitude - 0.0000001, 7);
        } elseif ($distanceMeters > 50 && $measuredDistance <= 50) {
            $latitude = round($latitude + 0.0000001, 7);
        }

        return $latitude;
    }

    private function stopsUrl(Delivery $delivery): string
    {
        return "/api/rider/deliveries/{$delivery->id}/pickup-stops";
    }

    private function confirmUrl(Delivery $delivery, Business $business): string
    {
        return "/api/rider/deliveries/{$delivery->id}/pickup-stops/{$business->id}/confirm";
    }

    private function arriveUrl(Delivery $delivery, Business $business): string
    {
        return "/api/rider/deliveries/{$delivery->id}/pickup-stops/{$business->id}/arrive";
    }

    // ───────────────────────────────────────────────────────────────
    // 1. Prepaid group trip: readiness, route order, radius and the
    //    picked_up/in_transit gate, end to end.
    // ───────────────────────────────────────────────────────────────
    public function test_prepaid_pickup_stops_sequence_ready_radius_and_picked_up_gate(): void
    {
        $deliveryStatuses = [];
        Event::listen(\App\Events\DeliveryStatusChanged::class, function ($event) use (&$deliveryStatuses): void {
            $deliveryStatuses[] = $event->newStatus;
        });

        $order = $this->makeOrder('gcash');
        $delivery = $this->makeDelivery($order);

        // ---- The unified payload exposes both stops in drive order ----
        $payload = $this->be($this->rider)
            ->getJson($this->stopsUrl($delivery))
            ->assertOk()
            ->assertJsonPath('data.is_cod', false)
            ->assertJsonPath('data.fully_collected', false)
            ->assertJsonPath('data.pickup_origin.business_id', $this->restaurantB->id)
            ->json('data');

        $stops = $payload['stops'];
        $this->assertCount(2, $stops);
        $this->assertSame([$this->restaurantA->id, $this->restaurantB->id], array_column($stops, 'business_id'), 'Shortest-preparation restaurant drives first.');
        $this->assertSame([1, 2], array_column($stops, 'sequence'));
        $this->assertSame([false, false], array_column($stops, 'can_confirm'));
        $this->assertSame(['waiting_arrival', 'not_current'], array_column($stops, 'reason'));

        // ---- The rider reaches the pickup area; the gate blocks leaving before
        //      confirmation, whichever way the status is skipped ----
        $this->be($this->rider)
            ->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => 'arrived_pickup'])
            ->assertOk();

        foreach (['picked_up', 'in_transit'] as $skipStatus) {
            $this->be($this->rider)
                ->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => $skipStatus])
                ->assertStatus(422)
                ->assertJsonPath('message', 'Collect food from every restaurant before leaving the pickup area.');
        }
        $this->assertSame('arrived_pickup', $delivery->fresh()->status->value, 'Delivery never left the pickup stage.');

        // ---- Restaurant A readies its items: stop A alone becomes confirmable ----
        $this->readyItems($order, $this->restaurantA);
        $this->be($this->rider)->postJson($this->arriveUrl($delivery, $this->restaurantA))->assertOk();

        $afterReadyA = $this->be($this->rider)
            ->getJson($this->stopsUrl($delivery))
            ->assertOk()
            ->json('data.stops');

        $this->assertTrue($afterReadyA[0]['is_ready'], 'Stop A ready once its items are ready.');
        $this->assertSame('ready', $afterReadyA[0]['ready_label']);
        $this->assertTrue($afterReadyA[0]['can_confirm'], 'Rider sits inside the pickup radius of A.');
        $this->assertSame(0, $afterReadyA[0]['distance_meters']);

        // ---- Confirm A: sequence advances but the trip is still gated on B ----
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.success', true)
            ->assertJsonPath('data.all_confirmed', false)
            ->assertJsonPath('data.stop.business_id', $this->restaurantA->id)
            ->assertJsonPath('data.stop.status', DeliveryPickupStop::STATUS_COLLECTED);

        $stopARow = DeliveryPickupStop::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantA->id)->sole();
        $this->assertSame(DeliveryPickupStop::STATUS_COLLECTED, $stopARow->status);
        $this->assertNotNull($stopARow->pickup_confirmed_at);
        $confirmedAt = $stopARow->pickup_confirmed_at->copy();

        // Re-confirming an already-confirmed stop is an idempotent no-op.
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertOk()
            ->assertJsonPath('data.success', true)
            ->assertJsonPath('data.stop.status', DeliveryPickupStop::STATUS_COLLECTED)
            ->assertJsonPath('data.all_confirmed', false);
        $this->assertSame(
            $confirmedAt->toISOString(),
            $stopARow->fresh()->pickup_confirmed_at->toISOString(),
            'Duplicate confirmation does not create a second pickup transition.'
        );
        $this->assertSame(
            1,
            DeliveryPickupStop::where('delivery_id', $delivery->id)
                ->where('business_id', $this->restaurantA->id)
                ->where('status', DeliveryPickupStop::STATUS_COLLECTED)
                ->count()
        );

        // ---- Stop B is not confirmable until ITS items are ready ----
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantB))
            ->assertStatus(422)
            ->assertJsonPath('success', false);

        $this->readyItems($order, $this->restaurantB);
        $this->placeLocation($this->rider, 12.52, 121.32);
        $this->be($this->rider)->postJson($this->arriveUrl($delivery, $this->restaurantB))->assertOk();

        // ---- Confirm B: both stops confirmed, the pickup area opens ----
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantB))
            ->assertOk()
            ->assertJsonPath('data.all_confirmed', true);

        $this->assertSame(0, CodPurchase::count(), 'Prepaid trips never touch the purchasing-cash ledger.');

        $this->assertSame('picked_up', $delivery->fresh()->status->value, 'The final stop atomically starts the delivery leg.');
        $this->assertNotNull($delivery->fresh()->picked_up_at);
        $pickedUpAt = $delivery->fresh()->picked_up_at->toISOString();
        $this->assertSame(1, count(array_filter($deliveryStatuses, fn ($status) => $status === 'picked_up')));

        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantB))
            ->assertStatus(422);
        $this->assertSame($pickedUpAt, $delivery->fresh()->picked_up_at->toISOString());
        $this->assertSame(1, count(array_filter($deliveryStatuses, fn ($status) => $status === 'picked_up')));

        $this->be($this->rider)
            ->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => 'in_transit'])
            ->assertOk();

        // After the pickup stage, confirmations are rejected outright.
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(422);

        $this->assertSame(
            DeliveryPickupStop::STATUS_COLLECTED,
            DeliveryPickupStop::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantB->id)->sole()->status
        );
    }

    // ───────────────────────────────────────────────────────────────
    // 2. Ownership and route-order isolation on the confirm endpoint.
    // ───────────────────────────────────────────────────────────────
    public function test_confirmed_pickup_stops_are_not_reconfirmable_even_when_ready_and_in_range(): void
    {
        $order = $this->makeOrder('gcash');
        $delivery = $this->makeDelivery($order);
        $this->readyItems($order, $this->restaurantA);
        $this->placeLocation($this->rider, 12.51, 121.31);

        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantA))
            ->assertOk();
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertOk();

        $payload = $this->be($this->rider)
            ->getJson($this->stopsUrl($delivery))
            ->assertOk()
            ->json('data.stops');

        $this->assertSame('collected', $payload[0]['status']);
        $this->assertFalse($payload[0]['can_confirm']);
        $this->assertSame('already_confirmed', $payload[0]['reason']);
    }

    public function test_confirm_pickup_enforces_ownership_and_route_order(): void
    {
        $order = $this->makeOrder('gcash');
        $delivery = $this->makeDelivery($order);
        $this->readyItems($order, $this->restaurantA);
        $this->readyItems($order, $this->restaurantB);

        // Another rider cannot confirm pickups on this delivery.
        $this->be($this->otherRider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(403)
            ->assertJsonPath('message', 'You are not assigned to this delivery.');

        // A tourist cannot act inside the rider surface at all.
        $tourist = User::create([
            'email' => 'tourist-pickup-seq@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
        $this->be($tourist)
            ->getJson($this->stopsUrl($delivery))
            ->assertStatus(403);

        // Stop B cannot be confirmed before stop A: confirmations follow the drive order.
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantB))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Confirm the pickup in route order. Pickup Seq Restaurant B is not the next pickup yet.');

        // The rejected attempt left every stop untouched.
        $this->assertSame(0, DeliveryPickupStop::where('status', DeliveryPickupStop::STATUS_COLLECTED)->count());
        $this->assertSame('assigned', $delivery->fresh()->status->value);
    }

    // ───────────────────────────────────────────────────────────────
    // 3. The radius gate: a rider too far from the restaurant cannot
    //    confirm the pickup.
    // ───────────────────────────────────────────────────────────────
    public function test_confirm_pickup_requires_the_rider_to_be_within_the_pickup_radius(): void
    {
        $order = $this->makeOrder('gcash');
        $delivery = $this->makeDelivery($order);
        $this->readyItems($order, $this->restaurantA);

        // Move the rider far away (~130km): within-radius check must block.
        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantA))
            ->assertOk();
        $this->placeLocation($this->rider, 13.0, 122.0);

        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(422)
            ->assertJsonPath('message', 'You must be within the pickup area before confirming the order items.');

        $this->assertSame(0, DeliveryPickupStop::where('status', DeliveryPickupStop::STATUS_COLLECTED)->count());

        // Back inside the radius: confirmation succeeds.
        $this->placeLocation($this->rider, 12.51, 121.31);

        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertOk()
            ->assertJsonPath('data.stop.status', DeliveryPickupStop::STATUS_COLLECTED);
    }

    public function test_pickup_requires_confirmed_arrival_and_retries_preserve_arrival_time(): void
    {
        $order = $this->makeOrder('gcash');
        $delivery = $this->makeDelivery($order);
        $this->readyItems($order, $this->restaurantA);

        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Confirm your arrival at this restaurant before confirming pickup.');

        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantA))
            ->assertOk();
        $arrivedAt = DeliveryPickupStop::where('delivery_id', $delivery->id)
            ->where('business_id', $this->restaurantA->id)
            ->sole()
            ->arrived_at;

        $this->travel(30)->seconds();
        $this->placeLocation($this->rider, 13.0, 122.0);
        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantA))
            ->assertOk()
            ->assertJsonPath('data.arrival_changed', false);

        $this->assertSame(
            $arrivedAt->toISOString(),
            DeliveryPickupStop::where('delivery_id', $delivery->id)
                ->where('business_id', $this->restaurantA->id)
                ->sole()
                ->arrived_at
                ->toISOString(),
            'Retry must preserve the server-recorded arrival timestamp.'
        );

        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(422)
            ->assertJsonPath('message', 'You must be within the pickup area before confirming the order items.');

        $this->travelBack();
    }

    public function test_pickup_radius_allows_49_9_and_50_meters_but_blocks_50_1_meters(): void
    {
        config(['tracking.pickup_radius_meters' => 50]);

        $order = $this->makeOrder('gcash');
        $delivery = $this->makeDelivery($order);
        $this->readyItems($order, $this->restaurantA);

        foreach ([
            [49.9, true],
            [50.0, true],
            [50.1, false],
        ] as [$distanceMeters, $expected]) {
            $latitude = $this->latitudeAtPickupDistance((float) $distanceMeters);
            $this->placeLocation($this->rider, $latitude, (float) $this->restaurantA->longitude);

            $stop = $this->be($this->rider)
                ->getJson($this->stopsUrl($delivery))
                ->assertOk()
                ->assertJsonPath('data.pickup_radius_meters', 50)
                ->json('data.stops.0');

            $this->assertSame(
                $expected,
                $stop['arrival_can_confirm'],
                "Arrival at approximately {$distanceMeters} m should be ".($expected ? 'allowed' : 'blocked').'.'
            );
        }

        // The 50.1 m arrival is blocked; exactly 50 m remains inclusive.
        $latitudeAtFiftyMeters = $this->latitudeAtPickupDistance(50.0);
        $this->placeLocation($this->rider, $latitudeAtFiftyMeters, (float) $this->restaurantA->longitude);
        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantA))
            ->assertOk();

        $this->placeLocation($this->rider, $this->latitudeAtPickupDistance(49.9), (float) $this->restaurantA->longitude);
        $this->assertTrue($this->be($this->rider)->getJson($this->stopsUrl($delivery))->json('data.stops.0.can_confirm'));

        $this->placeLocation($this->rider, $this->latitudeAtPickupDistance(50.1), (float) $this->restaurantA->longitude);
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(422);

        $this->placeLocation($this->rider, $latitudeAtFiftyMeters, (float) $this->restaurantA->longitude);
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertOk()
            ->assertJsonPath('data.stop.status', DeliveryPickupStop::STATUS_COLLECTED);
    }

    // ───────────────────────────────────────────────────────────────
    // 4. COD: confirming a pickup stop also collects its cod_purchases row
    //    in the same transaction, and the picked_up gate stays closed until
    //    every restaurant stop is confirmed.
    // ───────────────────────────────────────────────────────────────
    public function test_cod_confirm_collects_the_purchasing_cash_row_in_step(): void
    {
        $order = $this->makeOrder('cash');
        $delivery = $this->makeDelivery($order);
        app(\App\Services\PurchasingCashService::class)->initializeForDelivery($delivery);

        $purchases = CodPurchase::where('delivery_id', $delivery->id)->orderBy('business_id')->get();
        $this->assertCount(2, $purchases);
        $this->assertSame(CodPurchase::STATUS_PENDING, $purchases->first()->status);
        $this->assertNull($delivery->fresh()->purchasing_cash_issued_at);

        // The pickup-stop ledger seeds lazily for the COD trip too.
        $this->assertCount(2, app(\App\Services\PickupSequenceService::class)->stops($delivery));

        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Purchasing cash has not been issued yet.');

        $this->issuePurchasingCash($delivery);
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Confirm receipt of the purchasing cash before purchasing food.');

        $this->be($this->rider)
            ->postJson("/api/rider/deliveries/{$delivery->id}/purchasing-cash/receive")
            ->assertOk();
        $this->readyItems($order, $this->restaurantA);
        $this->readyItems($order, $this->restaurantB);

        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantA))
            ->assertOk();
        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantA))
            ->assertOk()
            ->assertJsonPath('data.all_confirmed', false);

        // The cod_purchases row for A is now purchased + collected atomically.
        $purchaseA = CodPurchase::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantA->id)->sole();
        $this->assertSame(CodPurchase::STATUS_COLLECTED, $purchaseA->status);
        $this->assertNotNull($purchaseA->purchased_at);
        $this->assertNotNull($purchaseA->collected_at);

        // B is still pending: the pickup area stays closed.
        $this->be($this->rider)
            ->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => 'arrived_pickup'])
            ->assertOk();

        $this->be($this->rider)
            ->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => 'picked_up'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Collect food from every restaurant before leaving the pickup area.');

        // The rider rides to Restaurant B for the final stop.
        $this->placeLocation($this->rider, 12.52, 121.32);
        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantB))
            ->assertOk();

        $this->be($this->rider)
            ->postJson($this->confirmUrl($delivery, $this->restaurantB))
            ->assertOk()
            ->assertJsonPath('data.all_confirmed', true);

        $this->assertSame(
            CodPurchase::STATUS_COLLECTED,
            CodPurchase::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantB->id)->sole()->status
        );

        $this->assertSame('picked_up', $delivery->fresh()->status->value);
    }

    // ───────────────────────────────────────────────────────────────
    // 5. Legacy COD collection delegates to the canonical arrival/pickup flow.
    // ───────────────────────────────────────────────────────────────
    public function test_legacy_cod_mark_flow_confirms_the_pickup_stop(): void
    {
        $order = $this->makeOrder('cash');
        $delivery = $this->makeDelivery($order);
        app(\App\Services\PurchasingCashService::class)->initializeForDelivery($delivery);
        $this->issueAndReceivePurchasingCash($delivery);
        $this->readyItems($order, $this->restaurantA);
        $this->readyItems($order, $this->restaurantB);

        $purchases = CodPurchase::where('delivery_id', $delivery->id)->orderBy('business_id')->get();
        foreach ($purchases as $purchase) {
            $this->be($this->rider)
                ->postJson("/api/rider/deliveries/{$delivery->id}/purchases/{$purchase->id}/mark", ['status' => 'purchased'])
                ->assertOk();
        }

        $this->be($this->rider)
            ->postJson("/api/rider/deliveries/{$delivery->id}/purchases/{$purchases[0]->id}/mark", ['status' => 'collected'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Confirm your arrival at this restaurant before confirming pickup.');

        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantA))
            ->assertOk();

        $this->be($this->rider)
            ->postJson("/api/rider/deliveries/{$delivery->id}/purchases/{$purchases[0]->id}/mark", ['status' => 'collected'])
            ->assertOk();
        $this->placeLocation($this->rider, 12.52, 121.32);
        $this->be($this->rider)
            ->postJson($this->arriveUrl($delivery, $this->restaurantB))
            ->assertOk();
        $this->be($this->rider)
            ->postJson("/api/rider/deliveries/{$delivery->id}/purchases/{$purchases[1]->id}/mark", ['status' => 'collected'])
            ->assertOk();

        $this->assertSame('picked_up', $delivery->fresh()->status->value);

        foreach ([$this->restaurantA, $this->restaurantB] as $restaurant) {
            $stop = DeliveryPickupStop::where('delivery_id', $delivery->id)->where('business_id', $restaurant->id)->sole();
            $this->assertSame(DeliveryPickupStop::STATUS_COLLECTED, $stop->status, 'Legacy collection must use canonical pickup confirmation.');
            $this->assertTrue(app(\App\Services\PickupSequenceService::class)->stopConfirmed($delivery->fresh(), $stop));
        }
    }

    public function test_tourist_delivery_route_activates_only_after_every_stop_and_picked_up_transition(): void
    {
        $tourist = User::create([
            'email' => 'tourist-pickup-progress@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
        $order = $this->makeOrder('gcash');
        $order->update(['user_id' => $tourist->id]);
        $delivery = $this->makeDelivery($order);
        $statusUrl = "/api/tourist/food/order/{$order->id}/status";

        $this->be($tourist)
            ->getJson($statusUrl)
            ->assertOk()
            ->assertJsonPath('data.delivery_route_active', false)
            ->assertJsonPath('data.pickup_stops.0.status', 'pending');

        $this->readyItems($order, $this->restaurantA);
        $this->readyItems($order, $this->restaurantB);
        $this->be($this->rider)->postJson($this->arriveUrl($delivery, $this->restaurantA))->assertOk();
        $this->be($this->rider)->postJson($this->confirmUrl($delivery, $this->restaurantA))->assertOk();

        $this->be($tourist)
            ->getJson($statusUrl)
            ->assertOk()
            ->assertJsonPath('data.delivery_route_active', false)
            ->assertJsonPath('data.pickup_stops.0.status', 'collected')
            ->assertJsonPath('data.pickup_stops.1.status', 'pending');

        $this->placeLocation($this->rider, 12.52, 121.32);
        $this->be($this->rider)->postJson($this->arriveUrl($delivery, $this->restaurantB))->assertOk();
        $this->be($this->rider)->postJson($this->confirmUrl($delivery, $this->restaurantB))->assertOk();

        $this->be($tourist)
            ->getJson($statusUrl)
            ->assertOk()
            ->assertJsonPath('data.delivery_route_active', true)
            ->assertJsonPath('data.delivery.status', 'picked_up')
            ->assertJsonPath('data.pickup_stops.0.status', 'collected')
            ->assertJsonPath('data.pickup_stops.1.status', 'collected');
    }
}