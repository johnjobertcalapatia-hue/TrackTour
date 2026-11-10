<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\User;
use App\Services\CodPickupPaymentGuard;
use App\Services\NearestRiderService;
use App\Services\PickupSequenceService;
use App\Services\PurchasingCashService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A cash-on-delivery order the tourist pays online while it is already under
 * way ("Complete payment" in the To Pay tab), decision 2026-11-10.
 *
 * The restaurant already has the money, so: no "Payment received" step before
 * Ready (the restaurant only marks the food ready, then the rider confirms the
 * pickup), the rider buys nothing and collects no cash. The order keeps its
 * progress: no new acceptance window, no second dispatch.
 *
 * Before the fix the paid webhook skipped orders already accepted / preparing
 * / ready, so the online payment never reached the order: it stayed
 * "cash, unpaid", the restaurant still had to confirm a rider payment and the
 * rider would have collected the cash a second time.
 */
class CodOrderPaidOnlineTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private User $ownerA;
    private User $ownerB;
    private User $rider;
    private Business $restaurantA;
    private Business $restaurantB;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.paymongo.secret_key' => 'sk_test_cod_online', 'services.paymongo.webhook_secret' => '']);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]);
        $this->tourist = User::create(['email' => 'tourist@codonline.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->ownerA = User::create(['email' => 'owner-a@codonline.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->ownerB = User::create(['email' => 'owner-b@codonline.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->restaurantA = Business::create(['owner_id' => $this->ownerA->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id, 'business_name' => 'Restaurant A', 'status' => 'approved', 'force_closed' => false, 'latitude' => 12.51, 'longitude' => 121.31]);
        $this->restaurantB = Business::create(['owner_id' => $this->ownerB->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id, 'business_name' => 'Restaurant B', 'status' => 'approved', 'force_closed' => false, 'latitude' => 12.52, 'longitude' => 121.32]);
        $this->rider = User::create(['email' => 'rider@codonline.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'food', 'municipality_id' => $muni->id]);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'food']);
    }

    /** Canonical multi-restaurant COD order (A + B items), already being prepared. */
    private function codOrder(string $status = 'preparing', ?GroupCheckout $group = null): Order
    {
        $order = Order::create([
            'order_number' => 'TT-CODON-'.random_int(10000, 99999),
            'business_id' => $this->restaurantA->id,
            'user_id' => $this->tourist->id,
            'group_order_id' => $group?->id,
            'customer_name' => 'Tourist',
            'customer_email' => $this->tourist->email,
            'order_type' => 'delivery',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => $status,
            'subtotal' => 440.00, 'delivery_fee' => 60.00, 'system_fee' => 0,
            'rider_financed_amount' => 440.00, 'total' => 500.00,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
            'preparation_started_at' => now()->subMinutes(10),
        ]);
        $order->items()->create(['business_id' => $this->restaurantA->id, 'product_name' => 'Adobo', 'quantity' => 1, 'unit_price' => 200, 'subtotal' => 200, 'status' => 'preparing']);
        $order->items()->create(['business_id' => $this->restaurantB->id, 'product_name' => 'Halo-halo', 'quantity' => 2, 'unit_price' => 120, 'subtotal' => 240, 'status' => 'preparing']);

        $delivery = Delivery::create([
            'order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'assigned', 'assigned_at' => now(),
            'pickup_address' => 'Restaurant A', 'pickup_latitude' => 12.51, 'pickup_longitude' => 121.31,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
        ]);
        app(PurchasingCashService::class)->initializeForDelivery($delivery);
        app(PickupSequenceService::class)->ensureStops($delivery);

        return $order->fresh();
    }

    private function payOnline(string $payableType, int $payableId, float $amount, string $providerId): void
    {
        Payment::create([
            'payment_number' => 'PAY-'.strtoupper(uniqid()),
            'payable_type' => $payableType,
            'payable_id' => $payableId,
            'user_id' => $this->tourist->id,
            'amount' => $amount,
            'method' => 'gcash',
            'provider_payment_id' => $providerId,
            'status' => 'pending',
        ]);

        $this->postJson('/api/payments/webhook', ['data' => [
            'id' => 'evt_'.$providerId, 'type' => 'event',
            'attributes' => ['type' => 'payment.paid', 'data' => ['id' => $providerId]],
        ]])->assertOk();
    }

    public function test_paid_online_mid_way_the_restaurant_only_marks_ready_no_payment_confirmation(): void
    {
        $order = $this->codOrder();
        $guard = app(CodPickupPaymentGuard::class);
        // Cash: both restaurants would wait for the rider's payment.
        $this->assertEqualsCanonicalizing([$this->restaurantA->id, $this->restaurantB->id], $guard->unpaidBusinessIds($order));

        $this->payOnline(Order::class, $order->id, 500.00, 'pm_cod_online_1');

        $order->refresh();
        $this->assertSame('gcash', $order->payment_method);
        $this->assertSame('paid', $order->payment_status);
        $this->assertEquals(500.00, (float) $order->paid_amount);
        // Progress kept: still preparing, no new acceptance window, no second delivery.
        $this->assertSame('preparing', $order->status);
        $this->assertNull($order->acceptance_started_at);
        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());

        // No COD steps left anywhere.
        $delivery = $order->activeDelivery();
        $this->assertFalse(app(NearestRiderService::class)->isCodDelivery($delivery));
        $this->assertSame([], $guard->unpaidBusinessIds($order));
        $this->assertNull(app(PickupSequenceService::class)->paymentConfirmation($delivery, $this->restaurantA->id));

        // Each restaurant just marks its own food ready.
        $itemA = $order->items()->where('business_id', $this->restaurantA->id)->first();
        $this->be($this->ownerA)->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemA->id}/status", ['status' => 'ready'])->assertOk();
        $itemB = $order->items()->where('business_id', $this->restaurantB->id)->first();
        $this->be($this->ownerB)->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemB->id}/status", ['status' => 'ready'])->assertOk();
        $this->assertSame('ready', $itemA->fresh()->status);
        $this->assertSame('ready', $itemB->fresh()->status);

        // The restaurant's order list no longer asks for a rider payment.
        $list = $this->be($this->ownerA)->getJson('/api/business-owner/orders')->assertOk();
        $row = collect($list->json('data'))->firstWhere('id', $order->id);
        $this->assertSame([], $row['restaurant_purchases'] ?? []);
    }

    public function test_a_still_unpaid_cod_order_keeps_the_payment_confirmation_step(): void
    {
        $order = $this->codOrder();
        $itemA = $order->items()->where('business_id', $this->restaurantA->id)->first();

        $this->be($this->ownerA)->patchJson("/api/business-owner/orders/{$order->id}/items/{$itemA->id}/status", ['status' => 'ready'])
            ->assertStatus(422)
            ->assertJsonPath('unpaid_business_ids', [$this->restaurantA->id]);
    }

    public function test_paid_online_while_on_the_road_keeps_the_delivery_status(): void
    {
        $order = $this->codOrder('in_transit');
        $this->payOnline(Order::class, $order->id, 500.00, 'pm_cod_online_road');

        $order->refresh();
        $this->assertSame('in_transit', $order->status); // never reset to waiting_restaurant
        $this->assertSame('paid', $order->payment_status);
        $this->assertSame('gcash', $order->payment_method);
        $this->assertNull($order->acceptance_started_at);
    }

    public function test_group_checkout_paid_online_mid_way_records_it_on_the_canonical_order(): void
    {
        $group = GroupCheckout::create([
            'reference_number' => 'GRP-CODON-1', 'user_id' => $this->tourist->id,
            'customer_name' => 'Tourist', 'customer_email' => $this->tourist->email,
            'order_type' => 'delivery', 'subtotal' => 440, 'delivery_total' => 60, 'system_fee_total' => 0,
            'rider_tip' => 0, 'discount' => 0, 'grand_total' => 500,
            'payment_method' => 'cash', 'payment_status' => 'pending', 'status' => 'preparing',
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
        ]);
        $order = $this->codOrder('preparing', $group);

        $this->payOnline(GroupCheckout::class, $group->id, 500.00, 'pm_cod_online_group');

        $order->refresh();
        $this->assertSame('paid', $group->fresh()->payment_status);
        $this->assertSame('gcash', $order->payment_method);
        $this->assertSame('paid', $order->payment_status);
        $this->assertSame('preparing', $order->status);
        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());
        $this->assertSame([], app(CodPickupPaymentGuard::class)->unpaidBusinessIds($order));
    }
}
