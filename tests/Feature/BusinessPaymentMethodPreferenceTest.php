<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BusinessPaymentMethodPreferenceTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $otherOwner;
    private User $tourist;
    private Business $business;
    private Business $restaurantA;
    private Business $restaurantB;
    private BusinessCategory $category;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->otherOwner = User::create([
            'email' => 'owner2@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $this->category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
        ]);

        // Open 24/7 so isAcceptingOrders() returns true regardless of the wall clock.
        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59'], ['open' => '23:59', 'close' => '00:00']]
        );

        $this->restaurantA = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $this->category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant A',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
        ]);

        $this->restaurantB = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $this->category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant B',
            'business_description' => 'Another test restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
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

    public function test_owner_can_update_payment_methods_and_they_are_returned(): void
    {
        $response = $this->actingAs($this->owner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/payment-methods', [
                'payment_methods' => ['cash', 'gcash'],
            ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.payment_methods', ['cash', 'gcash']);

        $this->assertSame(['cash', 'gcash'], $this->business->fresh()->payment_methods);
    }

    public function test_owner_can_restrict_to_online_only(): void
    {
        $response = $this->actingAs($this->owner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/payment-methods', [
                'payment_methods' => ['gcash'],
            ]);

        $response->assertOk();
        $this->assertSame(['gcash'], $this->business->fresh()->payment_methods);
        $this->assertFalse($this->business->fresh()->acceptsPaymentMethod('cash'));
        $this->assertTrue($this->business->fresh()->acceptsPaymentMethod('gcash'));
    }

    public function test_payment_methods_require_at_least_one_and_valid_values(): void
    {
        $this->actingAs($this->owner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/payment-methods', [
                'payment_methods' => [],
            ])
            ->assertStatus(422);

        $this->actingAs($this->owner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/payment-methods', [
                'payment_methods' => ['paypal'],
            ])
            ->assertStatus(422);

        $this->assertNull($this->business->fresh()->payment_methods, 'Failed attempts must not persist.');
    }

    public function test_other_owner_cannot_update_payment_methods(): void
    {
        $this->actingAs($this->otherOwner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/payment-methods', [
                'payment_methods' => ['cash'],
            ])
            ->assertStatus(403);
    }

    public function test_tourist_cannot_update_payment_methods(): void
    {
        $this->actingAs($this->tourist, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/payment-methods', [
                'payment_methods' => ['cash'],
            ])
            ->assertStatus(403);
    }

    public function test_business_accepts_every_method_when_none_configured(): void
    {
        $business = $this->business->fresh();

        $this->assertTrue($business->acceptsPaymentMethod('cash'));
        $this->assertTrue($business->acceptsPaymentMethod('gcash'));
        $this->assertTrue($business->acceptsPaymentMethod('card'));
    }

    public function test_single_order_rejected_when_payment_method_not_accepted(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $this->restaurantA->update(['payment_methods' => ['cash']]);

        $payload = [
            'items' => [['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null]],
            'order_type' => 'pickup',
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
            'notes' => null,
        ];

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/food/order', $payload)
            ->assertStatus(422);

        $this->assertSame(0, Order::count(), 'No order may be created for a disallowed payment method.');
    }

    public function test_single_order_accepted_once_payment_method_enabled(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $this->restaurantA->update(['payment_methods' => ['cash']]);

        $payload = [
            'items' => [['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null]],
            'order_type' => 'pickup',
            'customer_phone' => '09171234567',
            'payment_method' => 'cash',
            'notes' => null,
        ];

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/food/order', $payload);

        $response->assertStatus(201);

        $order = Order::sole();
        $this->assertSame('cash', $order->payment_method, 'The order payment method must be recorded.');
        $this->assertSame($this->restaurantA->id, $order->business_id);
    }

    public function test_group_order_rejected_when_a_restaurant_does_not_accept_method(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);
        $this->restaurantB->update(['payment_methods' => ['cash']]);

        $payload = [
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null]]],
                ['business_id' => $this->restaurantB->id, 'items' => [['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null]]],
            ],
            'order_type' => 'pickup',
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
            'notes' => null,
        ];

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/food/group-order', $payload);

        $response->assertStatus(422);
        $this->assertStringContainsString('Restaurant B', $response->json('message'));
        $this->assertSame(0, Order::count(), 'No order may be created for a group with a disallowed method.');
    }

    public function test_group_order_accepted_when_all_restaurants_accept_method(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);
        $this->restaurantA->update(['payment_methods' => ['gcash']]);
        $this->restaurantB->update(['payment_methods' => ['gcash', 'cash']]);

        $payload = [
            'restaurants' => [
                ['business_id' => $this->restaurantA->id, 'items' => [['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null]]],
                ['business_id' => $this->restaurantB->id, 'items' => [['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null]]],
            ],
            'order_type' => 'pickup',
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
            'notes' => null,
        ];

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/food/group-order', $payload)
            ->assertStatus(201);

        $order = Order::sole();
        $this->assertSame('gcash', $order->payment_method, 'The group order payment method must be recorded.');
        $this->assertCount(2, $order->items, 'One canonical shared order is created for the group checkout.');
    }

    public function test_orders_record_cash_vs_online_payment_methods(): void
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);

        $payload = [
            'items' => [['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null]],
            'order_type' => 'pickup',
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
            'notes' => null,
        ];

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/food/order', $payload)
            ->assertStatus(201);

        $order = Order::sole();
        $this->assertSame('gcash', $order->payment_method);
        $this->assertNull($order->group_order_id, 'Single orders have no group checkout.');
    }
}