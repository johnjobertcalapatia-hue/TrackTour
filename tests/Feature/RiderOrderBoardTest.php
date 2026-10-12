<?php

namespace Tests\Feature;

use App\Enums\TripStatus;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The rider order board (GET /api/rider/dispatch/board): a read-only view of
 * what a rider may act on (their own live offers) plus nearby read-only rows
 * (claimed by another rider / cancelled). Laravel stays authoritative for
 * eligibility and acceptance; the board only presents it.
 */
class RiderOrderBoardTest extends TestCase
{
    use RefreshDatabase;

    private function makeBusiness(string $name = 'Bansud Bay Eatery'): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]
        );

        return Business::create([
            'owner_id' => $this->makeOwner()->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'address' => '123 Poblacion, Bansud',
            'latitude' => 12.865,
            'longitude' => 121.452,
        ]);
    }

    private function makeOwner(): User
    {
        return User::firstOrCreate(
            ['email' => 'board-owner@example.com'],
            ['password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']
        );
    }

    private function makeRider(string $email, string $riderStatus = 'available'): User
    {
        $rider = User::create([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => $riderStatus,
            'current_service' => 'food',
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => $riderStatus,
            'current_service' => 'food',
        ]);

        return $rider;
    }

    private function placeRiderNear(User $rider, Business $business): void
    {
        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => $business->latitude,
            'longitude' => $business->longitude,
            'recorded_at' => now(),
        ]);
    }

    private function makeOrder(Business $business, string $number, string $method = 'cash'): Order
    {
        $order = Order::create([
            'order_number' => $number,
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'board-cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => $method,
            'payment_status' => $method === 'cash' ? 'pending' : 'paid',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.86,
            'delivery_longitude' => 121.45,
            'delivery_address' => '456 Test St, Bansud',
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'business_id' => $business->id,
            'product_name' => 'Chicken Adobo',
            'quantity' => 2,
            'unit_price' => 150,
            'subtotal' => 300,
        ]);

        return $order;
    }

    private function makeDelivery(Order $order, ?User $rider, string $status): Delivery
    {
        return Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider?->id,
            'status' => $status,
            'rider_commission' => 39.20,
            'delivery_fee' => 40,
            'estimated_duration_minutes' => 12,
            'pickup_address' => 'Bansud Bay Eatery',
            'delivery_address' => $order->delivery_address,
            'pickup_latitude' => 12.865,
            'pickup_longitude' => 121.452,
            'delivery_latitude' => 12.86,
            'delivery_longitude' => 121.45,
        ]);
    }

    private function makeOffer(Delivery $delivery, User $rider, float $distanceKm = 0.6): BookingDispatchLog
    {
        return BookingDispatchLog::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'distance_km' => $distanceKm,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);
    }

    public function test_board_lists_rider_pending_offer_as_actionable(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('board-rider@example.com');
        $this->placeRiderNear($rider, $business);

        $delivery = $this->makeDelivery($this->makeOrder($business, 'TT-BOARD-001'), null, 'waiting');
        $this->makeOffer($delivery, $rider);

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $response->assertOk()
            ->assertJsonPath('data.orders.0.rider_status', 'looking_for_riders')
            ->assertJsonPath('data.orders.0.can_accept', true)
            ->assertJsonPath('data.orders.0.accept_blocked_reason', null)
            ->assertJsonPath('data.orders.0.order_number', 'TT-BOARD-001')
            ->assertJsonPath('data.eligibility.location_ok', true)
            ->assertJsonPath('data.eligibility.has_active_delivery', false);

        // Only actionable offers expose the per-restaurant item breakdown.
        $response->assertJsonPath('data.orders.0.restaurants.0.name', 'Bansud Bay Eatery')
            ->assertJsonPath('data.orders.0.restaurants.0.items.0.name', 'Chicken Adobo')
            ->assertJsonPath('data.orders.0.restaurants.0.items.0.quantity', 2);
    }

    public function test_board_blocks_accept_when_rider_already_has_an_active_delivery(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('board-busy@example.com');
        $this->placeRiderNear($rider, $business);

        $active = $this->makeDelivery($this->makeOrder($business, 'TT-BOARD-ACTIVE'), $rider, 'picked_up');
        $offerDelivery = $this->makeDelivery($this->makeOrder($business, 'TT-BOARD-002'), null, 'waiting');
        $this->makeOffer($offerDelivery, $rider);

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $response->assertOk()
            ->assertJsonPath('data.eligibility.has_active_delivery', true)
            ->assertJsonPath('data.orders.0.can_accept', false)
            ->assertJsonPath('data.orders.0.accept_blocked_reason', 'active_delivery');

        $this->assertNotNull($active->id);
    }

    public function test_board_marks_another_riders_active_delivery_as_read_only(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('board-free@example.com');
        $this->placeRiderNear($rider, $business);

        $otherRider = $this->makeRider('board-other@example.com');
        $otherDelivery = $this->makeDelivery($this->makeOrder($business, 'TT-BOARD-003'), $otherRider, 'in_transit');

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $response->assertOk()
            ->assertJsonPath('data.orders.0.rider_status', 'accepted_by_other')
            ->assertJsonPath('data.orders.0.can_accept', false)
            ->assertJsonPath('data.orders.0.accept_blocked_reason', 'accepted_by_other');

        // Someone else's trip never leaks the item breakdown.
        $this->assertSame([], $response->json('data.orders.0.restaurants'));
        $this->assertSame([], $response->json('data.orders.0.items'));
        $this->assertNotNull($otherDelivery->id);
    }

    public function test_board_blocks_accept_without_a_fresh_location(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('board-noloc@example.com'); // no rider_locations row

        $delivery = $this->makeDelivery($this->makeOrder($business, 'TT-BOARD-004'), null, 'waiting');
        $this->makeOffer($delivery, $rider);

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $response->assertOk()
            ->assertJsonPath('data.eligibility.location_ok', false)
            ->assertJsonPath('data.orders.0.can_accept', false)
            ->assertJsonPath('data.orders.0.accept_blocked_reason', 'location_stale');
    }

    public function test_board_requires_the_rider_role(): void
    {
        $tourist = User::create([
            'email' => 'board-tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->actingAs($tourist, 'sanctum')->getJson('/api/rider/dispatch/board')->assertForbidden();
        $this->getJson('/api/rider/dispatch/board')->assertForbidden();
    }

    public function test_cancelled_offer_is_surfaced_as_read_only(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('board-cancel@example.com');

        $delivery = $this->makeDelivery($this->makeOrder($business, 'TT-BOARD-005'), null, 'waiting');
        $this->makeOffer($delivery, $rider);
        $delivery->update(['status' => TripStatus::CANCELLED]);

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $response->assertOk();
        $statuses = array_column($response->json('data.orders'), 'rider_status');
        $this->assertContains('cancelled', $statuses, 'A cancelled delivery the rider was offered is shown read-only.');
    }
}
