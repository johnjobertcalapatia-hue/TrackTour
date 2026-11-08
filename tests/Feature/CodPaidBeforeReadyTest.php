<?php

namespace Tests\Feature;

use App\Exceptions\CodPaymentPendingException;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\PickupSequenceService;
use App\Services\PreparationStartService;
use App\Services\PurchasingCashService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Rider trip flow, Stage B — COD "paid before ready" (decision 2026-11-08).
 *
 * For a COD delivery, a restaurant's food may only become READY after the
 * RESTAURANT confirms it received the rider's payment for its stop. Pinned on
 * every path that can make food ready:
 *   owner order status / mark-ready / item status, kitchen order / item,
 *   direct model saves (covers staff and any future path), and the
 *   preparation timer (readies only paid restaurants' items).
 * Confirmation requires the rider to have checked in at that restaurant
 * (≤ 50 m), is restaurant-scoped, idempotent, and the rider can never unlock
 * it himself (his purchase ledger doesn't count). Prepaid is unaffected.
 *
 * Canonical multi-restaurant COD order: Restaurant A (owner A) and
 * Restaurant B (owner B), one shared delivery assigned to the rider.
 */
class CodPaidBeforeReadyTest extends TestCase
{
    use RefreshDatabase;

    private User $ownerA;
    private User $ownerB;
    private User $rider;
    private Business $restaurantA;
    private Business $restaurantB;

    protected function setUp(): void
    {
        parent::setUp();
        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]);
        $this->ownerA = User::create(['email' => 'owner-a@paid.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->ownerB = User::create(['email' => 'owner-b@paid.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->restaurantA = Business::create(['owner_id' => $this->ownerA->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id, 'business_name' => 'Restaurant A', 'status' => 'approved', 'force_closed' => false, 'latitude' => 12.51, 'longitude' => 121.31]);
        $this->restaurantB = Business::create(['owner_id' => $this->ownerB->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id, 'business_name' => 'Restaurant B', 'status' => 'approved', 'force_closed' => false, 'latitude' => 12.52, 'longitude' => 121.32]);
        $this->rider = User::create(['email' => 'rider@paid.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'food', 'municipality_id' => $muni->id]);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'food']);
    }

    // ---------- fixtures ----------

    private function makeOrder(string $paymentMethod = 'cash'): Order
    {
        $order = Order::create([
            'order_number' => 'TT-PAID-'.random_int(10000, 99999),
            'business_id' => $this->restaurantA->id,
            'customer_name' => 'Tourist',
            'customer_email' => 'tourist@paid.test',
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentMethod === 'cash' ? 'pending' : 'paid',
            'status' => 'preparing',
            'subtotal' => 440.00, 'delivery_fee' => 60.00, 'system_fee' => 0,
            'rider_financed_amount' => 440.00, 'total' => 500.00,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
            'preparation_started_at' => now()->subMinutes(10),
            'predicted_ready_at' => now()->addMinutes(10),
        ]);
        $order->items()->create(['business_id' => $this->restaurantA->id, 'product_name' => 'Adobo', 'quantity' => 1, 'unit_price' => 200, 'subtotal' => 200, 'status' => 'preparing']);
        $order->items()->create(['business_id' => $this->restaurantB->id, 'product_name' => 'Halo-halo', 'quantity' => 2, 'unit_price' => 120, 'subtotal' => 240, 'status' => 'preparing']);

        return $order;
    }

    private function makeDelivery(Order $order): Delivery
    {
        $delivery = Delivery::create([
            'order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'assigned', 'assigned_at' => now(),
            'pickup_address' => 'Restaurant A', 'pickup_latitude' => 12.51, 'pickup_longitude' => 121.31,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
        ]);
        app(PurchasingCashService::class)->initializeForDelivery($delivery);
        app(PickupSequenceService::class)->ensureStops($delivery);

        return $delivery->fresh();
    }

    /** Tourism Office issues the purchasing cash and the rider receives it (flow step 1). */
    private function riderHoldsPurchasingCash(Delivery $delivery): void
    {
        $officer = User::create(['name' => 'Tourism Office', 'email' => uniqid('to-').'@paid.test', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $this->be($officer)->postJson("/api/admin/deliveries/{$delivery->id}/issue-purchasing-cash")->assertOk();
        $this->be($this->rider)->postJson("/api/rider/deliveries/{$delivery->id}/purchasing-cash/receive")->assertOk();
    }

    private function riderArrivesAt(Delivery $delivery, Business $business): void
    {
        RiderLocation::where('rider_id', $this->rider->id)->delete();
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => $business->latitude, 'longitude' => $business->longitude, 'recorded_at' => now()]);
        $this->be($this->rider)->postJson("/api/rider/deliveries/{$delivery->id}/pickup-stops/{$business->id}/arrive")->assertOk();
    }

    private function confirmPayment(Order $order, User $owner, ?Business $business = null)
    {
        return $this->be($owner)->postJson("/api/business-owner/orders/{$order->id}/cod-payment-received",
            $business ? ['business_id' => $business->id] : []);
    }

    private function itemOf(Order $order, Business $business)
    {
        return $order->items()->where('business_id', $business->id)->first();
    }

    private const PENDING = 'Waiting for the rider\'s payment. Confirm "Payment received" before marking this food ready.';

    // ---------- every "ready" path is refused while unpaid ----------

    public function test_owner_item_order_and_mark_ready_paths_are_refused_while_unpaid(): void
    {
        $order = $this->makeOrder();
        $this->makeDelivery($order);
        $itemA = $this->itemOf($order, $this->restaurantA);

        $this->be($this->ownerA)->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemA->id}/status", ['status' => 'ready'])
            ->assertStatus(422)->assertJsonPath('message', self::PENDING)
            ->assertJsonPath('unpaid_business_ids', [$this->restaurantA->id]);

        $this->be($this->ownerA)->postJson("/api/business-owner/orders/{$order->id}/mark-ready")
            ->assertStatus(422)->assertJsonPath('message', self::PENDING);

        $this->be($this->ownerA)->patchJson("/api/business-owner/orders/{$order->id}/status", ['status' => 'ready'])
            ->assertStatus(422)->assertJsonPath('message', self::PENDING);

        $this->assertSame('preparing', $order->fresh()->status);
        $this->assertSame(0, $order->items()->where('status', 'ready')->count(), 'No item was touched by any refused path.');
    }

    public function test_kitchen_order_and_item_paths_are_refused_while_unpaid(): void
    {
        $order = $this->makeOrder();
        $this->makeDelivery($order);
        $itemA = $this->itemOf($order, $this->restaurantA);

        $this->be($this->ownerA)->patchJson("/api/business-owner/kitchen/orders/{$order->id}/status", ['status' => 'ready'])
            ->assertStatus(422)->assertJsonPath('message', self::PENDING);
        $this->be($this->ownerA)->patchJson("/api/business-owner/kitchen/orders/{$order->id}/items/{$itemA->id}/status", ['status' => 'ready'])
            ->assertStatus(422);

        $this->assertSame(0, $order->items()->where('status', 'ready')->count());
        $this->assertSame('preparing', $order->fresh()->status);
    }

    public function test_any_model_save_to_ready_is_refused_covering_staff_and_future_paths(): void
    {
        $order = $this->makeOrder();
        $this->makeDelivery($order);

        try {
            $order->update(['status' => 'ready']);
            $this->fail('Order save to ready must be refused while unpaid.');
        } catch (CodPaymentPendingException $e) {
            $this->assertEqualsCanonicalizing([$this->restaurantA->id, $this->restaurantB->id], $e->businessIds);
        }

        $this->expectException(CodPaymentPendingException::class);
        $this->itemOf($order, $this->restaurantB)->update(['status' => 'ready']);
    }

    // ---------- payment confirmation ----------

    public function test_restaurant_confirms_payment_only_after_the_rider_checked_in_then_its_food_can_be_ready(): void
    {
        $order = $this->makeOrder();
        $delivery = $this->makeDelivery($order);

        // Rider not here yet.
        $this->confirmPayment($order, $this->ownerA)->assertStatus(422)
            ->assertJsonPath('message', 'The rider has not arrived at your restaurant yet. Confirm payment once the rider is here and has paid.');

        $this->riderArrivesAt($delivery, $this->restaurantA);

        // Owner A's order view says confirmation is possible now.
        $records = $this->be($this->ownerA)->getJson("/api/business-owner/orders/{$order->id}")->assertOk()->json('data.restaurant_purchases');
        $this->assertTrue($records[0]['can_confirm_payment']);
        $this->assertNull($records[0]['payment_confirmed_at']);
        $this->assertNotNull($records[0]['rider_arrived_at']);

        $this->confirmPayment($order, $this->ownerA)->assertOk()
            ->assertJsonPath('data.already_confirmed', false)
            ->assertJsonPath('data.business_id', $this->restaurantA->id)
            ->assertJsonPath('message', 'Payment received. You can now mark the food ready.');

        $purchase = CodPurchase::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantA->id)->first();
        $this->assertNotNull($purchase->payment_confirmed_at);
        $this->assertSame($this->ownerA->id, (int) $purchase->payment_confirmed_by);
        $this->assertSame(CodPurchase::STATUS_PURCHASED, $purchase->status, 'The rider ledger agrees: paid means purchased.');

        // A can now mark its food ready; B still can't.
        $itemA = $this->itemOf($order, $this->restaurantA);
        $this->be($this->ownerA)->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemA->id}/status", ['status' => 'ready'])->assertOk();
        $this->assertSame('ready', $itemA->fresh()->status);

        $this->expectException(CodPaymentPendingException::class);
        $this->itemOf($order, $this->restaurantB)->update(['status' => 'ready']);
    }

    public function test_confirmation_is_scoped_to_the_restaurant_and_idempotent(): void
    {
        $order = $this->makeOrder();
        $delivery = $this->makeDelivery($order);
        $this->riderArrivesAt($delivery, $this->restaurantA);

        // Owner B can't confirm A's payment, and an outsider can't confirm at all.
        $this->confirmPayment($order, $this->ownerB, $this->restaurantA)->assertStatus(403);
        $stranger = User::create(['email' => 'stranger@paid.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->confirmPayment($order, $stranger)->assertStatus(403);
        // Owner B (whose rider hasn't arrived) is refused for B.
        $this->confirmPayment($order, $this->ownerB)->assertStatus(422);

        $this->confirmPayment($order, $this->ownerA)->assertOk();
        $first = CodPurchase::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantA->id)->value('payment_confirmed_at');
        $this->travel(1)->minutes();
        $this->confirmPayment($order, $this->ownerA)->assertOk()->assertJsonPath('data.already_confirmed', true);
        $this->assertEquals($first, CodPurchase::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantA->id)->value('payment_confirmed_at'), 'A repeat tap changes nothing.');
        $this->assertNull(CodPurchase::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantB->id)->value('payment_confirmed_at'));
    }

    public function test_the_rider_cannot_unlock_ready_through_his_own_purchase_ledger(): void
    {
        $order = $this->makeOrder();
        $delivery = $this->makeDelivery($order);
        $this->riderArrivesAt($delivery, $this->restaurantA);

        $purchase = CodPurchase::where('delivery_id', $delivery->id)->where('business_id', $this->restaurantA->id)->first();
        $purchase->update(['status' => CodPurchase::STATUS_PURCHASED, 'purchased_at' => now()]); // rider "Bought ✓"

        $itemA = $this->itemOf($order, $this->restaurantA);
        $this->be($this->ownerA)->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemA->id}/status", ['status' => 'ready'])
            ->assertStatus(422)->assertJsonPath('message', self::PENDING);
    }

    public function test_no_confirmation_outside_the_pickup_stage_or_for_prepaid_orders(): void
    {
        $order = $this->makeOrder();
        $delivery = $this->makeDelivery($order);
        $this->riderArrivesAt($delivery, $this->restaurantA);
        $delivery->update(['status' => 'picked_up']);
        $this->confirmPayment($order, $this->ownerA)->assertStatus(422)
            ->assertJsonPath('message', 'Payment can only be confirmed while the rider is picking up the food.');

        $prepaid = $this->makeOrder('gcash');
        $this->makeDelivery($prepaid);
        $this->confirmPayment($prepaid, $this->ownerA)->assertStatus(422)->assertJsonPath('message', 'This is not a cash-on-delivery order.');
    }

    // ---------- rider pickup ----------

    public function test_rider_pickup_waits_for_the_restaurant_payment_confirmation(): void
    {
        $order = $this->makeOrder();
        $delivery = $this->makeDelivery($order);
        $this->riderHoldsPurchasingCash($delivery);
        $this->riderArrivesAt($delivery, $this->restaurantA);

        // Even food readied before this rule (bulk/legacy) can't be collected unpaid.
        $order->items()->where('business_id', $this->restaurantA->id)->update(['status' => 'ready', 'ready_at' => now()]);

        $stopA = collect($this->be($this->rider)->getJson("/api/rider/deliveries/{$delivery->id}/pickup-stops")->assertOk()->json('data.stops'))
            ->firstWhere('business_id', $this->restaurantA->id);
        $this->assertSame('waiting_payment', $stopA['reason']);
        $this->assertFalse($stopA['payment_confirmed']);
        $this->assertFalse($stopA['can_confirm']);

        $this->be($this->rider)->postJson("/api/rider/deliveries/{$delivery->id}/pickup-stops/{$this->restaurantA->id}/confirm")
            ->assertStatus(422)->assertJsonPath('message', 'Pay the restaurant first and wait for it to confirm "Payment received".');

        $this->confirmPayment($order, $this->ownerA)->assertOk();

        $stopA = collect($this->be($this->rider)->getJson("/api/rider/deliveries/{$delivery->id}/pickup-stops")->json('data.stops'))
            ->firstWhere('business_id', $this->restaurantA->id);
        $this->assertTrue($stopA['payment_confirmed']);
        $this->assertTrue($stopA['can_confirm']);
        $this->be($this->rider)->postJson("/api/rider/deliveries/{$delivery->id}/pickup-stops/{$this->restaurantA->id}/confirm")->assertOk();
    }

    // ---------- preparation timer ----------

    public function test_the_timer_readies_only_paid_restaurants_and_payment_after_the_timer_readies_at_once(): void
    {
        $order = $this->makeOrder();
        $delivery = $this->makeDelivery($order);
        $this->riderHoldsPurchasingCash($delivery);
        $this->riderArrivesAt($delivery, $this->restaurantA);
        $this->confirmPayment($order, $this->ownerA)->assertOk();

        // Timer runs out with only A paid.
        $order->update(['predicted_ready_at' => now()->subMinute()]);
        app(PreparationStartService::class)->completeDuePreparations();

        $this->assertSame('ready', $this->itemOf($order, $this->restaurantA)->fresh()->status, 'Paid restaurant: ready on time.');
        $this->assertSame('preparing', $this->itemOf($order, $this->restaurantB)->fresh()->status, 'Unpaid restaurant: held.');
        $this->assertSame('preparing', $order->fresh()->status, 'The order is ready only when every restaurant is.');

        // Later timer runs still hold B.
        app(PreparationStartService::class)->completeDuePreparations();
        $this->assertSame('preparing', $this->itemOf($order, $this->restaurantB)->fresh()->status);

        // Rider reaches B and pays: B's food is ready immediately (timer already done).
        $this->be($this->rider)->postJson("/api/rider/deliveries/{$delivery->id}/pickup-stops/{$this->restaurantA->id}/confirm")->assertOk();
        $this->riderArrivesAt($delivery->fresh(), $this->restaurantB);
        $this->confirmPayment($order, $this->ownerB)->assertOk()->assertJsonPath('data.order_ready', true);

        $this->assertSame('ready', $this->itemOf($order, $this->restaurantB)->fresh()->status);
        $this->assertSame('ready', $order->fresh()->status);
    }

    // ---------- unaffected ----------

    public function test_prepaid_orders_are_not_gated(): void
    {
        $order = $this->makeOrder('gcash');
        $this->makeDelivery($order);

        $this->be($this->ownerA)->postJson("/api/business-owner/orders/{$order->id}/mark-ready")->assertOk();
        $this->assertSame('ready', $order->fresh()->status);
    }
}
