<?php

namespace Tests\Feature;

use App\Events\OrderStatusChanged;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use App\Services\GroupOrderService;
use App\Services\PreparationStartService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Direct coverage of the AGENTS §4.2 rider-acceptance gate at its CANONICAL
 * layer: PreparationStartService::startForOrder().
 *
 *     NO ACCEPTED RIDER  ⇒  NO PREPARATION
 *
 * RiderAcceptanceGateTest exercises the gate through the HTTP entry points
 * (start-preparation, mark-ready, item/order status). This file pins the
 * service itself, because every preparation path funnels through it:
 *
 *   - NearestRiderService   rider accepts the delivery
 *   - PaymentController     online payment confirmed
 *   - FoodController        COD placement path (moved off the removed
 *                           restaurant accept endpoints)
 *   - GroupOrderService     pickup placement (no rider required)
 *   - AdvancePreparationOrders  scheduler recovery sweep
 *
 * Pinning the service means no future caller — HTTP, scheduler or event —
 * can reach 'preparing' for a delivery order without an accepted rider.
 */
class PreparationStartServiceGateTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $tourist;
    private User $rider;
    private Business $business;
    private Offering $offering;
    private GroupOrderService $groupService;
    private PreparationStartService $preparation;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'name' => 'Owner', 'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner', 'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'name' => 'John Tourist', 'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist', 'account_status' => 'approved',
        ]);

        // Created WITHOUT a rider_detail row on purpose: the real dispatch
        // lookup finds no eligible rider, so the delivery stays unaccepted —
        // exactly the state the gate must refuse.
        $this->rider = User::create([
            'name' => 'Rider', 'email' => 'rider@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider', 'account_status' => 'approved',
            'rider_status' => 'available', 'current_service' => 'food',
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

        $this->business = Business::create([
            'owner_id' => $this->owner->id, 'business_category_id' => $category->id,
            'municipality_id' => $municipality->id, 'business_name' => 'Test Restaurant',
            'status' => 'approved', 'force_closed' => false, 'business_hours' => $allDays,
            'latitude' => 12.51, 'longitude' => 121.31,
        ]);

        $this->offering = Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Burger', 'price' => 120.00,
            'is_available' => true, 'status' => 'available',
        ]);

        $this->groupService = $this->app->make(GroupOrderService::class);
        $this->preparation = $this->app->make(PreparationStartService::class);
    }

    /**
     * A COD delivery order at waiting_restaurant with one physical delivery
     * that no rider has accepted yet.
     */
    private function createDeliveryOrder(): Order
    {
        $group = $this->groupService->createGroup($this->tourist, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.55,
            'delivery_longitude' => 121.35,
            'delivery_address' => 'Beachfront Resort, Bansud',
            'customer_phone' => '09170001122',
            'payment_method' => 'cash',
            'restaurants' => [
                [
                    'business_id' => $this->business->id,
                    'items' => [['offering_id' => $this->offering->id, 'quantity' => 1]],
                ],
            ],
        ]);

        return $group->orders()->where('business_id', $this->business->id)->first();
    }

    /**
     * A bare pickup order parked at waiting_restaurant (payment already
     * settled). Pickup is deliberately isolated here so the test pins only
     * the gate predicate: pickup must never wait on a rider.
     */
    private function createPickupOrder(): Order
    {
        $order = Order::create([
            'order_number' => 'ORD-'.strtoupper(uniqid()),
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => $this->tourist->name,
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09170001122',
            'order_type' => 'pickup',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => 'waiting_restaurant',
            'subtotal' => 120.00,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => 120.00,
        ]);

        $order->items()->create([
            'offering_id' => $this->offering->id,
            'product_name' => 'Burger',
            'quantity' => 1,
            'unit_price' => 120.00,
            'subtotal' => 120.00,
        ]);

        return $order;
    }

    /** Simulate rider acceptance without the auto-start side effect. */
    private function bindAcceptedRider(Order $order): void
    {
        // handleRiderResponse() would already have called startForOrder(),
        // so binding the rider directly isolates the gate predicate itself
        // from that side effect.
        $order->activeDelivery()->update(['rider_id' => $this->rider->id]);
    }

    public function test_start_for_order_is_blocked_until_a_rider_has_accepted_the_delivery(): void
    {
        $order = $this->createDeliveryOrder();
        $delivery = $order->activeDelivery();
        $item = $order->items()->first();

        $this->assertNotNull($delivery, 'A delivery order owns exactly one physical delivery.');
        $this->assertNull($delivery->rider_id, 'No rider has accepted the trip yet.');
        $this->assertFalse($order->hasAcceptedRider());

        Event::fake([OrderStatusChanged::class]);

        $started = $this->preparation->startForOrder($order);
        $this->assertFalse($started, 'Gate refuses to start a delivery order with no accepted rider.');

        $order->refresh();
        $item->refresh();
        $this->assertSame('waiting_restaurant', $order->status, 'Order must stay in Finding Rider.');
        $this->assertNull($order->preparation_started_at, 'No preparation countdown may be stamped.');
        $this->assertNull($order->predicted_ready_at);
        $this->assertSame('pending', $item->status, 'No item may start cooking without an accepted rider.');
        $this->assertNull($item->preparation_started_at);

        Event::assertNotDispatched(
            OrderStatusChanged::class,
            fn (OrderStatusChanged $event) => $event->newStatus === 'preparing'
        );
    }

    public function test_start_for_order_runs_once_the_delivery_has_an_accepted_rider(): void
    {
        $order = $this->createDeliveryOrder();
        $item = $order->items()->first();

        $this->bindAcceptedRider($order);
        $this->assertTrue($order->fresh()->hasAcceptedRider(), 'Delivery is now bound to an accepted rider.');

        Event::fake([OrderStatusChanged::class]);

        $started = $this->preparation->startForOrder($order->fresh());
        $this->assertTrue($started, 'Gate opens once the delivery has an accepted rider.');

        $order->refresh();
        $item->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertNotNull($order->preparation_started_at, 'Countdown timer started.');
        $this->assertNotNull($order->predicted_ready_at, 'Ready time projected from the menu prep time.');
        $this->assertSame('restaurant_default', $order->prediction_source, 'Restaurant menu time is authoritative.');
        $this->assertSame('preparing', $item->status, 'Items advance with the order.');
        $this->assertNotNull($item->preparation_started_at);
        $this->assertNotNull($item->accepted_at);

        Event::assertDispatchedTimes(OrderStatusChanged::class, 1, 'Exactly one waiting → preparing broadcast.');

        // The transition is one-shot: a second call cannot re-run it.
        $this->assertFalse(
            $this->preparation->startForOrder($order->fresh()),
            'The gate is idempotent once the order left waiting_restaurant.'
        );
        $this->assertSame('preparing', $order->fresh()->status);
        Event::assertDispatchedTimes(OrderStatusChanged::class, 1, 'No duplicate preparing broadcast.');
    }

    public function test_the_gate_is_delivery_only_so_pickup_needs_no_rider(): void
    {
        $order = $this->createPickupOrder();

        $this->assertSame('waiting_restaurant', $order->status);
        $this->assertNull($order->activeDelivery(), 'Pickup orders never own a delivery trip.');
        $this->assertFalse($order->hasAcceptedRider());

        $started = $this->preparation->startForOrder($order);
        $this->assertTrue($started, 'Pickup orders are outside the rider gate (AGENTS §4.2 gates delivery only).');

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertNotNull($order->preparation_started_at);
    }

    public function test_start_eligible_waiting_orders_recovers_eligible_orders_but_skips_riderless_deliveries(): void
    {
        $deliveryOrder = $this->createDeliveryOrder();
        $pickupOrder = $this->createPickupOrder();

        $promoted = $this->preparation->startEligibleWaitingOrders();

        $this->assertSame(1, $promoted, 'Only the rider-free pickup order is eligible.');
        $this->assertSame('preparing', $pickupOrder->fresh()->status);
        $this->assertSame(
            'waiting_restaurant',
            $deliveryOrder->fresh()->status,
            'The recovery sweep must never strand-open a delivery with no accepted rider.'
        );

        // Once a rider accepts, the same sweep un-strands the delivery order
        // (missed event / legacy row / payment-path gap recovery).
        $this->bindAcceptedRider($deliveryOrder);

        $this->assertSame(1, $this->preparation->startEligibleWaitingOrders(), 'Now the delivery order is eligible.');
        $this->assertSame('preparing', $deliveryOrder->fresh()->status);

        $this->assertSame(0, $this->preparation->startEligibleWaitingOrders(), 'Nothing left to promote.');
    }

    public function test_start_for_order_captures_an_authorized_online_payment(): void
    {
        $order = $this->createDeliveryOrder();

        $payment = Payment::create([
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $order->user_id,
            'payment_number' => 'PAY-'.Str::upper(Str::random(10)),
            'amount' => $order->total,
            'currency' => 'PHP',
            'method' => 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'pm_'.Str::random(20),
            'status' => 'authorized',
        ]);

        // Capture must not happen while the gate is closed.
        $this->assertFalse($this->preparation->startForOrder($order));
        $this->assertSame('authorized', $payment->fresh()->status, 'A blocked start never captures the payment.');

        $this->bindAcceptedRider($order);
        $this->assertTrue($this->preparation->startForOrder($order->fresh()));

        $order->refresh();
        $this->assertSame('preparing', $order->status);
        $this->assertSame('paid', $order->payment_status, 'Authorized online payment is captured on a real start.');
        $this->assertSame('paid', $payment->fresh()->status, 'The payment row is captured exactly once.');
    }
}
