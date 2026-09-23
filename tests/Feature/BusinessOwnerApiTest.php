<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Barangay;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Staff;
use App\Models\StaffRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BusinessOwnerApiTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
        ]);
    }

    public function test_business_owner_can_get_dashboard(): void
    {
        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/dashboard');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_business_owner_can_list_businesses(): void
    {
        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/businesses');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonCount(1, 'data');
    }

    public function test_business_owner_can_list_orders(): void
    {
        Order::create([
            'order_number' => 'ORD-TEST001',
            'business_id' => $this->business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'pickup',
            'status' => 'pending',
            'subtotal' => 250.00,
            'total' => 250.00,
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/orders');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
    }

    /**
     * The Orders card list expands inline (no second request), so the index
     * payload must already carry the per-item detail the cards render:
     * name, qty, price, per-item preparation_time snapshot and item status.
     */
    public function test_order_index_exposes_item_detail_for_expandable_cards(): void
    {
        $order = Order::create([
            'order_number' => 'ORD-CARD001',
            'business_id' => $this->business->id,
            'customer_name' => 'Card Customer',
            'customer_email' => 'card@example.com',
            'customer_phone' => '09171234567',
            'delivery_address' => '123 Sampaguita St, Bansud',
            'order_type' => 'delivery',
            'status' => 'preparing',
            'subtotal' => 300.00,
            'delivery_fee' => 45.00,
            'total' => 345.00,
            'notes' => 'Extra rice, no chili',
            'preparation_time' => 12,
        ]);

        $order->items()->create([
            'business_id' => $this->business->id,
            'product_name' => 'Adobo',
            'quantity' => 2,
            'unit_price' => 150.00,
            'subtotal' => 300.00,
            'preparation_time' => 12,
            'status' => 'preparing',
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/orders');

        $response->assertOk()
            ->assertJsonPath('data.0.order_number', 'ORD-CARD001')
            ->assertJsonPath('data.0.customer_name', 'Card Customer')
            ->assertJsonPath('data.0.customer_phone', '09171234567')
            ->assertJsonPath('data.0.delivery_address', '123 Sampaguita St, Bansud')
            ->assertJsonPath('data.0.subtotal', 300)
            ->assertJsonPath('data.0.delivery_fee', 45)
            ->assertJsonPath('data.0.total', 345)
            ->assertJsonPath('data.0.special_instructions', 'Extra rice, no chili')
            ->assertJsonPath('data.0.items.0.product_name', 'Adobo')
            ->assertJsonPath('data.0.items.0.quantity', 2)
            ->assertJsonPath('data.0.items.0.unit_price', 150)
            ->assertJsonPath('data.0.items.0.total_price', 300)
            ->assertJsonPath('data.0.items.0.status', 'preparing')
            ->assertJsonPath('data.0.items.0.preparation_time', 12);
    }

    public function test_business_owner_can_list_bookings(): void
    {
        Booking::create([
            'booking_number' => 'BK-TEST001',
            'business_id' => $this->business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'customer_phone' => '09171234567',
            'booking_type' => 'accommodation',
            'status' => 'pending',
            'check_in_date' => now()->addDays(5)->toDateString(),
            'check_out_date' => now()->addDays(7)->toDateString(),
            'guests' => 2,
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/bookings');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
    }

    public function test_business_owner_can_list_staff(): void
    {
        $staffUser = User::create([
            'email' => 'staff@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'staff',
            'account_status' => 'approved',
        ]);

        $staffRole = StaffRole::create([
            'name' => 'Cashier',
            'description' => 'Handles transactions',
        ]);

        Staff::create([
            'business_id' => $this->business->id,
            'user_id' => $staffUser->id,
            'staff_role_id' => $staffRole->id,
            'status' => 'active',
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/staff');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonStructure([
                'data' => [
                    'staff',
                    'status_counts',
                ],
            ]);
    }

    public function test_business_owner_can_list_menu(): void
    {
        Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Adobo',
            'description' => 'Classic Filipino dish',
            'price' => 150.00,
            'status' => 'available',
            'is_available' => true,
            'type' => 'product',
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/menu');

        $response->assertOk();
    }

    public function test_business_owner_can_view_order(): void
    {
        $order = Order::create([
            'order_number' => 'ORD-UPD001',
            'business_id' => $this->business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'pickup',
            'status' => 'pending',
            'subtotal' => 300.00,
            'total' => 300.00,
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson("/api/business-owner/orders/{$order->id}");

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_business_owner_can_view_booking(): void
    {
        $booking = Booking::create([
            'booking_number' => 'BK-UPD001',
            'business_id' => $this->business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'customer_phone' => '09171234567',
            'booking_type' => 'accommodation',
            'status' => 'pending',
            'check_in_date' => now()->addDays(5)->toDateString(),
            'check_out_date' => now()->addDays(7)->toDateString(),
            'guests' => 2,
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson("/api/business-owner/bookings/{$booking->id}");

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_business_owner_can_list_promotions(): void
    {
        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/business-owner/promotions');

        $response->assertOk();
    }

    public function test_non_business_owner_cannot_access(): void
    {
        $tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($tourist, 'sanctum')
            ->getJson('/api/business-owner/dashboard');

        $response->assertStatus(403);
    }
}
