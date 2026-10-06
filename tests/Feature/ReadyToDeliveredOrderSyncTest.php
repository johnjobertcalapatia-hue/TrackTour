<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Verifies that when a rider advances a delivery through the fulfilment
 * lifecycle, the order-level status (shown to business owners and tourists)
 * is kept in sync instead of staying stuck on "ready".
 */
class ReadyToDeliveredOrderSyncTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $rider;
    private User $customer;
    private Business $restaurant;
    private Order $order;
    private Delivery $delivery;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-sync@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->customer = User::create([
            'email' => 'customer-sync@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);

        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->restaurant = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Sync Test Restaurant',
            'status' => 'approved',
        ]);

        $this->rider = User::create([
            'email' => 'rider-sync@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'online',
            'current_service' => 'food',
            'municipality_id' => $municipality->id,
        ]);

        RiderDetail::create([
            'user_id' => $this->rider->id,
            'rider_status' => 'online',
            'current_service' => 'food',
        ]);

        $this->order = Order::create([
            'order_number' => 'TT-SYNC-001',
            'business_id' => $this->restaurant->id,
            'user_id' => $this->customer->id,
            'customer_name' => 'John Jobert Jasa Calapatia',
            'customer_email' => 'customer-sync@example.com',
            'order_type' => 'delivery',
            'status' => 'ready',
            'payment_status' => 'paid',
            'subtotal' => 1200.00,
            'delivery_fee' => 182.70,
            'total' => 1382.70,
        ]);

        $this->delivery = Delivery::create([
            'order_id' => $this->order->id,
            'rider_id' => $this->rider->id,
            'status' => 'assigned',
            'pickup_address' => $this->restaurant->business_name,
            'delivery_address' => '123 Test St, Bansud',
            'pickup_latitude' => 12.51,
            'pickup_longitude' => 121.31,
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
        ]);
    }

    public function test_order_status_syncs_ready_to_delivered_as_rider_advances(): void
    {
        $this->assertSame('ready', $this->order->fresh()->status, 'Starts at ready.');

        // Rider arrives at pickup.
        $this->patchStatus('arrived_pickup');
        $this->assertSame('ready', $this->order->fresh()->status, 'Pre-pickup advance keeps order ready.');

        // Rider picks up the food.
        $this->patchStatus('picked_up');
        $this->assertSame('picked_up', $this->order->fresh()->status);

        // Rider is on the way.
        $this->patchStatus('in_transit');
        $this->assertSame('out_for_delivery', $this->order->fresh()->status);

        // Rider arrives at the destination.
        $this->patchStatus('arrived_destination');
        $this->assertSame('out_for_delivery', $this->order->fresh()->status);

        // P14 — the rider cannot mark a food delivery delivered; the TOURIST must
        // confirm receipt at the drop-off. This is a prepaid order, so the
        // delivery is complete on confirmation and the order reaches 'completed'
        // (the canonical terminal state), not a dangling 'delivered'.
        $this->withHeader('Authorization', 'Bearer '.$this->rider->createToken('test')->plainTextToken)
            ->patchJson('/api/rider/deliveries/'.$this->delivery->id.'/status', ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJson(['success' => false]);

        $this->withHeader('Authorization', 'Bearer '.$this->customer->createToken('test')->plainTextToken)
            ->postJson('/api/tourist/food/order/'.$this->order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertSame('completed', $this->order->fresh()->status);
        $this->assertNotNull($this->order->fresh()->completed_at, 'completed_at set on delivery.');
    }

    public function test_server_proximity_transition_syncs_order_to_out_for_delivery(): void
    {
        // Simulate the server-side proximity controller (RiderMapController),
        // which fires DeliveryStatusChanged -> the sync listener when the rider
        // reaches the pickup/delivery geofence rather than the manual PATCH.
        $this->delivery->update(['status' => 'picked_up', 'picked_up_at' => now()]);

        event(new \App\Events\DeliveryStatusChanged($this->delivery->fresh(), 'picked_up', 'arrived_destination'));
        $this->assertSame('out_for_delivery', $this->order->fresh()->status);
    }

    public function test_tourist_confirmation_event_syncs_prepaid_order_to_completed(): void
    {
        // P14 — the tourist confirm endpoint dispatches the final delivery state
        // (prepaid -> 'completed'), and the sync listener keeps the order in
        // lockstep so no dangling 'delivered' remains.
        $this->delivery->update(['status' => 'completed', 'delivered_at' => now()]);

        event(new \App\Events\DeliveryStatusChanged($this->delivery->fresh(), 'arrived_destination', 'completed'));
        $this->assertSame('completed', $this->order->fresh()->status);
        $this->assertNotNull($this->order->fresh()->completed_at, 'completed_at reserved for the completed state.');
    }

    private function patchStatus(string $status): void
    {
        // The API authenticates exclusively via a Sanctum Bearer token (see
        // TokenOnlyAuth), so build a real token for the rider and send it in the
        // Authorization header instead of relying on actingAs().
        $token = $this->rider->createToken('test')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer '.$token)
            ->patchJson('/api/rider/deliveries/'.$this->delivery->id.'/status', [
                'status' => $status,
            ]);

        $response->assertOk()
            ->assertJson(['success' => true]);
    }
}
