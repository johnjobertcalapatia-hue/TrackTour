<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\User;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * P7 (rescoped): Fast Delivery requires a ₱20–₱100 rider tip that is part of
 * the original order transaction — never a separate post-delivery payment.
 *
 * The tip is folded into `order.total`, so it is collected with the PayMongo
 * charge (online) or with the COD `cash_due` (= order total), and it flows into
 * the rider's earning at completion/settlement. Normal delivery carries no tip.
 */
class FastDeliveryTipTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private User $rider;
    private Business $businessA;
    private Business $businessB;
    private Offering $offeringA;
    private Offering $offeringB;

    protected function setUp(): void
    {
        parent::setUp();

        // Force the delivery-fee routing lookup to fall back to the straight-line
        // estimate instead of making a real OSRM request.
        Http::fake();

        $this->tourist = User::create([
            'email' => 'tourist-tip@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->rider = User::create([
            'email' => 'rider-tip@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        $this->businessA = $this->makeBusiness('Tip Restaurant A', 12.51, 121.31);
        $this->businessB = $this->makeBusiness('Tip Restaurant B', 12.52, 121.32);

        $this->offeringA = $this->makeOffering($this->businessA, 'Adobo', 250.00);
        $this->offeringB = $this->makeOffering($this->businessB, 'Pizza', 400.00);
    }

    // ---------- helpers ----------

    private function makeBusiness(string $name, float $latitude, float $longitude): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]
        );

        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59']]
        );

        return Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => $latitude,
            'longitude' => $longitude,
        ]);
    }

    private function makeOffering(Business $business, string $name, float $price): Offering
    {
        return Offering::create([
            'business_id' => $business->id,
            'name' => $name,
            'description' => 'Test menu item',
            'price' => $price,
            'is_available' => true,
            'status' => 'available',
        ]);
    }

    private function orderPayload(array $overrides = []): array
    {
        return array_merge([
            'business_id' => $this->businessA->id,
            'items' => [
                ['offering_id' => $this->offeringA->id, 'quantity' => 1, 'notes' => null],
            ],
            'order_type' => 'delivery',
            'delivery_speed' => 'fast',
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
            'notes' => null,
        ], $overrides);
    }

    private function groupPayload(array $overrides = []): array
    {
        return array_merge([
            'restaurants' => [
                [
                    'business_id' => $this->businessA->id,
                    'items' => [['offering_id' => $this->offeringA->id, 'quantity' => 1, 'notes' => null]],
                ],
                [
                    'business_id' => $this->businessB->id,
                    'items' => [['offering_id' => $this->offeringB->id, 'quantity' => 1, 'notes' => null]],
                ],
            ],
            'order_type' => 'delivery',
            'delivery_speed' => 'fast',
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
            'notes' => null,
        ], $overrides);
    }

    private function placeOrder(array $payload)
    {
        return $this->be($this->tourist)
            ->postJson('/api/tourist/food/order', $payload);
    }

    private function makeOrder(array $overrides = []): Order
    {
        return Order::create(array_merge([
            'order_number' => 'ORD-'.strtoupper(uniqid()),
            'business_id' => $this->businessA->id,
            'user_id' => $this->tourist->id,
            'customer_name' => $this->tourist->fullName,
            'customer_email' => $this->tourist->email,
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'delivery_speed' => 'fast',
            'payment_method' => 'gcash',
            'payment_status' => 'pending',
            'status' => 'delivered',
            'subtotal' => 250.00,
            'delivery_fee' => 50.00,
            'rider_tip' => 30.00,
            'system_fee' => 25.00,
            'rider_financed_amount' => 275.00,
            'total' => 355.00,
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
        ], $overrides));
    }

    private function makeDelivery(Order $order, array $overrides = []): Delivery
    {
        return Delivery::create(array_merge([
            'order_id' => $order->id,
            'rider_id' => $this->rider->id,
            'delivery_fee' => 50.00,
            'rider_commission' => 50.00,
            'status' => 'delivered',
        ], $overrides));
    }

    // ---------- single order: mandatory tip ----------

    public function test_fast_delivery_requires_a_rider_tip(): void
    {
        $response = $this->placeOrder($this->orderPayload(['delivery_speed' => 'fast']));

        $response->assertStatus(422);
        $this->assertSame(0, Order::count(), 'No order is created without the required fast-delivery tip.');
    }

    public function test_fast_delivery_rejects_a_tip_below_the_minimum(): void
    {
        $response = $this->placeOrder($this->orderPayload(['delivery_speed' => 'fast', 'rider_tip' => 19]));

        $response->assertStatus(422);
        $this->assertSame(0, Order::count());
    }

    public function test_fast_delivery_rejects_a_tip_above_the_maximum(): void
    {
        $response = $this->placeOrder($this->orderPayload(['delivery_speed' => 'fast', 'rider_tip' => 101]));

        $response->assertStatus(422);
        $this->assertSame(0, Order::count());
    }

    public function test_fast_delivery_tip_is_included_in_the_order_total(): void
    {
        $response = $this->placeOrder($this->orderPayload(['delivery_speed' => 'fast', 'rider_tip' => 30]));

        $response->assertCreated();

        $order = Order::firstOrFail();
        $this->assertSame('fast', $order->delivery_speed);
        $this->assertEquals(30.00, (float) $order->rider_tip);

        $expectedSystemFee = round(250.00 * ((float) config('delivery.system_fee_percentage', 10.0) / 100), 2);
        $this->assertEquals($expectedSystemFee, (float) $order->system_fee);
        $this->assertEquals(
            round((float) $order->subtotal + (float) $order->delivery_fee + (float) $order->system_fee + 30.00, 2),
            (float) $order->total,
            'The tip is part of the original order total.'
        );
    }

    public function test_standard_delivery_ignores_any_rider_tip(): void
    {
        $response = $this->placeOrder($this->orderPayload([
            'delivery_speed' => 'standard',
            'rider_tip' => 50,
        ]));

        $response->assertCreated();

        $order = Order::firstOrFail();
        $this->assertSame('standard', $order->delivery_speed);
        $this->assertEquals(0.00, (float) $order->rider_tip, 'Normal delivery carries no tip.');
        $this->assertEquals(
            round((float) $order->subtotal + (float) $order->delivery_fee + (float) $order->system_fee, 2),
            (float) $order->total,
            'No tip is added to a normal-delivery total.'
        );
    }

    // ---------- group order: mandatory tip + split ----------

    public function test_group_fast_delivery_requires_a_rider_tip(): void
    {
        $response = $this->be($this->tourist)
            ->postJson('/api/tourist/food/group-order', $this->groupPayload(['delivery_speed' => 'fast']));

        $response->assertStatus(422);
        $this->assertSame(0, GroupCheckout::count());
    }

    public function test_group_fast_delivery_tip_lives_on_the_single_order(): void
    {
        $response = $this->be($this->tourist)
            ->postJson('/api/tourist/food/group-order', $this->groupPayload(['delivery_speed' => 'fast', 'rider_tip' => 40]));

        $response->assertCreated();

        $group = GroupCheckout::firstOrFail();
        $this->assertEquals(40.00, (float) $group->rider_tip);

        // ONE canonical order carries the full group tip — never split across
        // per-restaurant child orders (AGENTS.md §4.1).
        $orders = $group->orders()->get();
        $this->assertCount(1, $orders);

        $order = $orders->first();
        $this->assertSame('fast', $order->delivery_speed);
        $this->assertEquals(40.00, (float) $order->rider_tip, 'The single canonical order carries the full tip.');
        $this->assertEquals(
            round((float) $order->subtotal + (float) $order->delivery_fee + (float) $order->system_fee + 40.00, 2),
            (float) $order->total,
            'The canonical order total includes the full tip.'
        );
    }

    // ---------- tip reaches rider earnings ----------

    public function test_prepaid_delivery_records_the_tip_in_rider_earnings(): void
    {
        $order = $this->makeOrder(['payment_method' => 'gcash', 'rider_tip' => 30.00]);
        $delivery = $this->makeDelivery($order, ['status' => 'in_transit']);

        app(NearestRiderService::class)->completeDelivery($delivery->fresh()->load('order'));

        $earning = RiderEarning::where('order_id', $order->id)->firstOrFail();
        $this->assertSame('earned', $earning->status);
        $this->assertEquals(30.00, (float) $earning->rider_tip);
        $this->assertEquals(80.00, (float) $earning->total_earning, 'Earning = delivery commission + tip.');
    }

    public function test_cod_cash_due_and_earning_include_the_tip(): void
    {
        $order = $this->makeOrder([
            'payment_method' => 'cash',
            'rider_tip' => 30.00,
            'total' => 355.00,
        ]);
        $delivery = $this->makeDelivery($order);

        $service = app(NearestRiderService::class);
        $service->markCodDelivered($delivery->fresh()->load('order'));

        $delivery->refresh();
        $this->assertEquals(355.00, (float) $delivery->cash_due, 'cash_due = order total, tip included.');

        $result = $service->settleCodDelivery($delivery->fresh()->load('order'), (float) $delivery->cash_due);

        $this->assertTrue($result['success']);
        $this->assertEquals(355.00, $result['cash_received']);

        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $this->assertEquals(355.00, (float) $order->paid_amount);

        $earning = RiderEarning::where('order_id', $order->id)->firstOrFail();
        $this->assertEquals(30.00, (float) $earning->rider_tip);
        $this->assertEquals(80.00, (float) $earning->total_earning);
    }
}
