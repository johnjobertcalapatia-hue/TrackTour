<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Staff;
use App\Models\StaffRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class StaffApiTest extends TestCase
{
    use RefreshDatabase;

    private User $staffUser;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $owner = User::create([
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
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Restaurant',
            'status' => 'approved',
        ]);

        $this->staffUser = User::create([
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
            'user_id' => $this->staffUser->id,
            'staff_role_id' => $staffRole->id,
            'status' => 'active',
            'employee_id' => 'EMP-00001',
        ]);
    }

    public function test_staff_can_get_dashboard(): void
    {
        $response = $this->actingAs($this->staffUser, 'sanctum')
            ->getJson('/api/staff/dashboard');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonStructure([
                'data' => [
                    'staff',
                    'business',
                    'dashboard_type',
                    'today_summary',
                    'recent_orders',
                    'recent_bookings',
                ],
            ]);
    }

    public function test_staff_can_list_orders(): void
    {
        Order::create([
            'order_number' => 'ORD-STAFF001',
            'business_id' => $this->business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'pickup',
            'status' => 'pending',
            'subtotal' => 250.00,
            'total' => 250.00,
        ]);

        $response = $this->actingAs($this->staffUser, 'sanctum')
            ->getJson('/api/staff/orders');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonStructure([
                'data' => [
                    'orders',
                    'status_counts',
                    'today_summary',
                    'pagination',
                ],
            ]);
    }

    public function test_staff_can_update_order_status(): void
    {
        $order = Order::create([
            'order_number' => 'ORD-STAFF-UPD001',
            'business_id' => $this->business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'pickup',
            'status' => 'pending',
            'subtotal' => 250.00,
            'total' => 250.00,
        ]);

        $response = $this->actingAs($this->staffUser, 'sanctum')
            ->patchJson("/api/staff/orders/{$order->id}/status", [
                'status' => 'preparing',
            ]);

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'status' => 'preparing',
        ]);
    }

    public function test_staff_can_list_bookings(): void
    {
        Booking::create([
            'booking_number' => 'BK-STAFF001',
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

        $response = $this->actingAs($this->staffUser, 'sanctum')
            ->getJson('/api/staff/bookings');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonStructure([
                'data' => [
                    'bookings',
                    'status_counts',
                    'today_summary',
                    'pagination',
                ],
            ]);
    }

    public function test_staff_can_update_booking_status(): void
    {
        $booking = Booking::create([
            'booking_number' => 'BK-STAFF-UPD001',
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

        $response = $this->actingAs($this->staffUser, 'sanctum')
            ->patchJson("/api/staff/bookings/{$booking->id}/status", [
                'status' => 'confirmed',
            ]);

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);

        $this->assertDatabaseHas('bookings', [
            'id' => $booking->id,
            'status' => 'confirmed',
        ]);
    }

    public function test_non_staff_cannot_access(): void
    {
        $tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($tourist, 'sanctum')
            ->getJson('/api/staff/dashboard');

        $response->assertStatus(403);
    }
}
