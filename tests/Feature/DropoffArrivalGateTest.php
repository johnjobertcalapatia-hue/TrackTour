<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * "I've arrived" at the tourist (2026-11-10): a food delivery only moves to
 * arrived_destination when the rider's own fresh saved GPS fix is within
 * tracking.dropoff_radius_meters (50 m) of the delivery address, like the
 * restaurant arrival (50 m) and the delivery proof (50 m). Before this, the
 * button worked from anywhere.
 */
class DropoffArrivalGateTest extends TestCase
{
    use RefreshDatabase;

    private User $rider;
    private Delivery $delivery;

    protected function setUp(): void
    {
        parent::setUp();
        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $owner = User::create(['email' => 'owner@arrive.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $business = Business::create(['owner_id' => $owner->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id, 'business_name' => 'Restaurant', 'status' => 'approved', 'latitude' => 12.51, 'longitude' => 121.31]);
        $this->rider = User::create(['email' => 'rider@arrive.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'food', 'municipality_id' => $muni->id]);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'food']);

        $order = Order::create([
            'order_number' => 'TT-ARRIVE-1', 'business_id' => $business->id, 'customer_name' => 'Tourist', 'customer_email' => 't@arrive.test',
            'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'ready',
            'subtotal' => 200, 'delivery_fee' => 60, 'system_fee' => 0, 'total' => 260,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
        ]);
        $this->delivery = Delivery::create([
            'order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'in_transit', 'assigned_at' => now(), 'picked_up_at' => now(),
            'pickup_address' => 'Restaurant', 'pickup_latitude' => 12.51, 'pickup_longitude' => 121.31,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
        ]);
    }

    private function riderAt(float $lat, float $lng, $recordedAt = null): void
    {
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => $lat, 'longitude' => $lng, 'recorded_at' => $recordedAt ?? now()]);
    }

    private function arrive()
    {
        return $this->be($this->rider)->patchJson("/api/rider/deliveries/{$this->delivery->id}/status", ['status' => 'arrived_destination']);
    }

    public function test_without_a_location_the_rider_cannot_confirm_arrival(): void
    {
        $this->arrive()->assertStatus(422)
            ->assertJsonPath('message', 'We need your current location. Keep the map open with location on, then try again.');
        $this->assertSame('in_transit', $this->delivery->fresh()->status->value);
    }

    public function test_far_from_the_drop_off_the_rider_cannot_confirm_arrival(): void
    {
        $this->riderAt(12.55, 121.35); // several km away

        $response = $this->arrive()->assertStatus(422);
        $this->assertStringStartsWith('Move closer to the delivery address to confirm arrival (within 50 m; you are ', $response->json('message'));
        // Long distances read in km (not "12948945 m").
        $this->assertMatchesRegularExpression('/you are \d+\.\d km away\)\.$/', $response->json('message'));
        $this->assertSame('in_transit', $this->delivery->fresh()->status->value);
    }

    public function test_an_old_location_does_not_count(): void
    {
        $this->riderAt(12.60, 121.40, now()->subMinutes(10));

        $this->arrive()->assertStatus(422);
        $this->assertSame('in_transit', $this->delivery->fresh()->status->value);
    }

    public function test_70_m_away_is_still_too_far(): void
    {
        $this->riderAt(12.6005, 121.4004); // ≈ 70 m from the drop-off

        $response = $this->arrive()->assertStatus(422);
        $this->assertMatchesRegularExpression('/^Move closer to the delivery address to confirm arrival \(within 50 m; you are 7\d m away\)\.$/', $response->json('message'));
        $this->assertSame('in_transit', $this->delivery->fresh()->status->value);
    }

    public function test_within_50_m_the_rider_confirms_arrival(): void
    {
        $this->riderAt(12.6002, 121.4002); // ≈ 30 m from the drop-off

        $this->arrive()->assertOk();
        $this->assertSame('arrived_destination', $this->delivery->fresh()->status->value);
        $this->assertNotNull($this->delivery->fresh()->arrived_destination_at);

        // Confirming again (already arrived) stays allowed.
        $this->arrive()->assertOk();
    }
}
