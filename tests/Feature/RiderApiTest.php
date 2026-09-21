<?php

namespace Tests\Feature;

use App\Http\Controllers\Rider\RiderController;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class RiderApiTest extends TestCase
{
    use RefreshDatabase;

    private User $rider;

    protected function setUp(): void
    {
        parent::setUp();

        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->rider = User::create([
            'email' => 'rider@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'online',
            'current_service' => 'food',
            'municipality_id' => $municipality->id,
        ]);
    }

    public function test_rider_can_get_dashboard(): void
    {
        $response = $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/rider/dashboard');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_rider_can_get_profile(): void
    {
        $response = $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/rider/profile');

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'email' => 'rider@example.com',
                    'role' => 'rider',
                ],
            ]);
    }

    public function test_rider_can_get_earnings(): void
    {
        $response = $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/rider/earnings');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_rider_can_list_pending_deliveries(): void
    {
        $owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $business = Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Test Restaurant',
            'status' => 'approved',
        ]);

        $order = Order::create([
            'order_number' => 'ORD-RIDER001',
            'business_id' => $business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'delivery',
            'status' => 'confirmed',
            'subtotal' => 250.00,
            'total' => 300.00,
        ]);

        Delivery::create([
            'order_id' => $order->id,
            'status' => 'waiting',
            'pickup_address' => $business->business_name,
            'delivery_address' => '123 Main St',
        ]);

        $response = $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/rider/deliveries/pending');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_rider_can_list_active_deliveries(): void
    {
        $response = $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/rider/deliveries/active');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_rider_can_list_completed_deliveries(): void
    {
        $response = $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/rider/deliveries/completed');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_rider_dashboard_counts_canonical_delivery_states(): void
    {
        $owner = User::create([
            'email' => 'owner-dashboard@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $business = Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Dashboard Restaurant',
            'status' => 'approved',
        ]);

        $order = Order::create([
            'order_number' => 'ORD-DASH001',
            'business_id' => $business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'delivery',
            'status' => 'ready',
            'subtotal' => 250.00,
            'total' => 300.00,
        ]);

        // Canonical pending offer: a waiting delivery with a pending dispatch log.
        $waiting = Delivery::create([
            'order_id' => $order->id,
            'status' => 'waiting',
            'pickup_address' => $business->business_name,
            'delivery_address' => '123 Main St',
        ]);

        BookingDispatchLog::create([
            'delivery_id' => $waiting->id,
            'rider_id' => $this->rider->id,
            'distance_km' => 1.5,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);

        // Canonical active delivery. (P9: one delivery per order is enforced by
        // UNIQUE(deliveries.order_id), so the active delivery gets its own order.)
        $activeOrder = Order::create([
            'order_number' => 'ORD-DASH002',
            'business_id' => $business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'delivery',
            'status' => 'ready',
            'subtotal' => 250.00,
            'total' => 300.00,
        ]);

        Delivery::create([
            'order_id' => $activeOrder->id,
            'rider_id' => $this->rider->id,
            'status' => 'assigned',
            'pickup_address' => $business->business_name,
            'delivery_address' => '123 Main St',
        ]);

        // HTTP feature routes are guarded by TokenOnlyAuth (Bearer token only),
        // so exercise the controller directly with an authenticated request.
        $request = Request::create('/api/rider/dashboard', 'GET');
        $request->setUserResolver(fn () => $this->rider);

        $payload = app(RiderController::class)->dashboard($request)->getData(true);

        $this->assertSame(1, $payload['data']['pending_deliveries']);
        $this->assertSame(1, $payload['data']['active_deliveries']);
    }

    public function test_non_rider_cannot_access(): void
    {
        $tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($tourist, 'sanctum')
            ->getJson('/api/rider/dashboard');

        $response->assertStatus(403);
    }
}
