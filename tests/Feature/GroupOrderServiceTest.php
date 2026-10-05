<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\User;
use App\Services\DeliveryFeeService;
use App\Services\GroupOrderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class GroupOrderServiceTest extends TestCase
{
    use RefreshDatabase;

    private User $user;
    private Business $restaurantA;
    private Business $restaurantB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::create([
            'email' => 'tourist-group@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
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

        // Open 24/7 so isAcceptingOrders() returns true regardless of the wall clock.
        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59']]
        );

        $this->restaurantA = Business::create([
            'owner_id' => $this->user->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant A',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);

        $this->restaurantB = Business::create([
            'owner_id' => $this->user->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant B',
            'business_description' => 'Another test restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.52,
            'longitude' => 121.32,
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

    private function basePayload(array $restaurants): array
    {
        return [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'delivery_address' => '123 Test St',
            'payment_method' => 'gcash',
            'notes' => null,
            'restaurants' => $restaurants,
        ];
    }

    public function test_create_group_creates_one_order_with_restaurant_owned_items(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 80.00);
        $coke = $this->makeOffering($this->restaurantA, 'Coke', 50.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);
        $pasta = $this->makeOffering($this->restaurantB, 'Pasta', 250.00);

        $group = app(GroupOrderService::class)->createGroup($this->user, $this->basePayload([
            [
                'business_id' => $this->restaurantA->id,
                'items' => [
                    ['offering_id' => $burger->id, 'quantity' => 2, 'notes' => 'No onions'],
                    ['offering_id' => $fries->id, 'quantity' => 1, 'notes' => 'Extra ketchup'],
                    ['offering_id' => $coke->id, 'quantity' => 2, 'notes' => null],
                ],
            ],
            [
                'business_id' => $this->restaurantB->id,
                'items' => [
                    ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
                    ['offering_id' => $pasta->id, 'quantity' => 1, 'notes' => null],
                ],
            ],
        ]));

        $this->assertInstanceOf(GroupCheckout::class, $group);

        $order = $group->orders()->sole()->load('items');

        $this->assertCount(1, $group->orders()->get(), 'The checkout has one canonical order.');
        $this->assertEquals($this->restaurantA->id, $order->business_id, 'The primary business anchors the order route.');
        $this->assertCount(5, $order->items, 'All restaurant items belong to the canonical order.');
        $this->assertSame(
            [$this->restaurantA->id, $this->restaurantA->id, $this->restaurantA->id, $this->restaurantB->id, $this->restaurantB->id],
            $order->items->sortBy('id')->pluck('business_id')->values()->all()
        );

        // Restaurant A items remain grouped by business_id inside the order.
        $restaurantAItems = $order->items->where('business_id', $this->restaurantA->id);
        $this->assertCount(3, $restaurantAItems, 'Restaurant A owns its three items.');
        $this->assertSame(
            ['Burger', 'Fries', 'Coke'],
            $restaurantAItems->sortBy('id')->pluck('product_name')->values()->all()
        );

        // Each item keeps its own quantity, price, subtotal and notes.
        $burgerItem = $order->items->firstWhere('product_name', 'Burger');
        $this->assertSame(2, (int) $burgerItem->quantity);
        $this->assertSame(120.00, (float) $burgerItem->unit_price);
        $this->assertSame(240.00, (float) $burgerItem->subtotal);
        $this->assertSame('No onions', $burgerItem->notes);
        $this->assertEquals($burger->id, $burgerItem->offering_id);

        $friesItem = $order->items->firstWhere('product_name', 'Fries');
        $this->assertSame(1, (int) $friesItem->quantity);
        $this->assertSame(80.00, (float) $friesItem->subtotal);
        $this->assertSame('Extra ketchup', $friesItem->notes);

        $cokeItem = $order->items->firstWhere('product_name', 'Coke');
        $this->assertSame(2, (int) $cokeItem->quantity);
        $this->assertSame(50.00, (float) $cokeItem->unit_price);
        $this->assertSame(100.00, (float) $cokeItem->subtotal);
        $this->assertNull($cokeItem->notes);

        // Restaurant B owns its two items in the same order.
        $restaurantBItems = $order->items->where('business_id', $this->restaurantB->id);
        $this->assertCount(2, $restaurantBItems);
        $this->assertSame(
            ['Pizza', 'Pasta'],
            $restaurantBItems->sortBy('id')->pluck('product_name')->values()->all()
        );

        $this->assertSame(1070.00, (float) $order->subtotal, 'The canonical subtotal includes every restaurant item.');
    }

    public function test_create_group_groups_items_sharing_same_business_into_one_order(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 100.00);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 60.00);

        // Restaurant A appears twice in the payload; both groups must collapse into a single Order.
        $group = app(GroupOrderService::class)->createGroup($this->user, $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null]]],
            ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $fries->id, 'quantity' => 1, 'notes' => null]]],
        ]));

        $this->assertCount(1, $group->orders()->get(), 'Repeated restaurant groups must collapse into one Order.');
        $this->assertCount(2, $group->orders()->first()->items, 'Both items should live under the single Order.');
    }

    public function test_pickup_only_creates_orders_without_delivery_fee(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 100.00);

        $payload = $this->basePayload([
            ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null]]],
        ]);
        $payload['order_type'] = 'pickup';
        $payload['delivery_latitude'] = null;
        $payload['delivery_longitude'] = null;

        $group = app(GroupOrderService::class)->createGroup($this->user, $payload);

        $order = $group->orders()->first();
        $this->assertSame('pickup', $order->order_type);
        $this->assertSame(0.0, (float) $order->delivery_fee);
        $this->assertEquals(100.00, (float) $order->subtotal);
    }
}
