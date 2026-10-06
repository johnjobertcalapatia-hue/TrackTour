<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * P14 — the tourist delivery-confirmation gate.
 *
 * A food delivery only becomes 'delivered' when the TOURIST confirms receipt at
 * the drop-off. The rider may never mark a food delivery 'delivered' on their
 * own (422 tourist_confirmation_required). Standalone transport rides remain
 * rider-driven and never hit the tourist gate.
 *
 *   COD    confirm -> delivered  (cash_due frozen; completes at settle-cod)
 *   Prepaid confirm -> completed (canonical terminal state, rider released)
 */
class TouristConfirmDeliveryTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $rider;
    private User $customer;
    private User $otherCustomer;
    private Business $restaurant;
    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->customer = User::create([
            'email' => 'customer-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->otherCustomer = User::create([
            'email' => 'other-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        $this->restaurant = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => 'Confirm Test Restaurant',
            'status' => 'approved',
        ]);

        $this->rider = User::create([
            'email' => 'rider-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        RiderDetail::create([
            'user_id' => $this->rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);
    }

    private function makeOrder(string $paymentMethod, string $orderNumber, string $orderType = 'delivery'): Order
    {
        return Order::create([
            'order_number' => $orderNumber,
            'business_id' => $this->restaurant->id,
            'user_id' => $this->customer->id,
            'customer_name' => 'P14 Confirmation Tourist',
            'customer_email' => $this->customer->email,
            'order_type' => $orderType,
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentMethod === 'cash' ? 'unpaid' : 'paid',
            'status' => 'ready',
            'subtotal' => 900.00,
            'system_fee' => 25.00,
            'delivery_fee' => 150.00,
            'rider_tip' => 0,
            'rider_financed_amount' => 900.00,
            'total' => 1075.00,
            'delivery_address' => '123 Confirmation St, Bansud',
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
        ]);
    }

    private function makeDelivery(Order $order, string $status = 'arrived_destination'): Delivery
    {
        return Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $this->rider->id,
            'status' => $status,
            'pickup_address' => $this->restaurant->business_name,
            'delivery_address' => $order->delivery_address,
            'pickup_latitude' => 12.51,
            'pickup_longitude' => 121.31,
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
        ]);
    }

    private function riderToken(): string
    {
        return $this->rider->createToken('test')->plainTextToken;
    }

    private function customerToken(): string
    {
        return $this->customer->createToken('test')->plainTextToken;
    }

    public function test_rider_cannot_mark_a_food_delivery_delivered_without_tourist_confirmation(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-GATE');
        $delivery = $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->riderToken())
            ->patchJson('/api/rider/deliveries/'.$delivery->id.'/status', ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The tourist must confirm the delivery before it can be marked as delivered.');

        $this->assertSame('arrived_destination', $delivery->fresh()->status->value ?? $delivery->fresh()->status,
            'The delivery stays at the destination until the tourist confirms.');
        $this->assertNull($delivery->fresh()->delivered_at);
    }

    public function test_tourist_confirms_prepaid_delivery_to_completed(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-PREPAID');
        $delivery = $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->customerToken())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'completed')
            ->assertJsonPath('message', 'Delivery confirmed. Thank you!');

        $delivery->refresh();
        $this->assertSame('completed', $delivery->status->value ?? $delivery->status);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNotNull($delivery->delivery_confirmed_at, 'Tourist confirmation is stamped.');
        $this->assertSame($this->customer->id, (int) $delivery->delivery_confirmed_by);

        $this->assertSame('completed', $order->fresh()->status, 'Prepaid order completes on confirmation.');
        $this->assertNotNull($order->fresh()->completed_at);
        $this->assertSame(1, RiderEarning::where('rider_id', $this->rider->id)->where('order_id', $order->id)->count());
        $this->assertSame('available', $this->rider->fresh()->riderDetail->rider_status, 'Rider is released.');
    }

    public function test_tourist_confirms_cod_delivery_to_delivered_then_settlement_completes(): void
    {
        $order = $this->makeOrder('cash', 'TT-CONFIRM-COD');
        $delivery = $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->customerToken())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'delivered');

        $delivery->refresh();
        $this->assertSame('delivered', $delivery->status->value ?? $delivery->status,
            'COD stays delivered until the cash is settled — never auto-completed.');
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNotNull($delivery->delivery_confirmed_at);
        $this->assertSame((float) $order->total, (float) $delivery->cash_due, 'Cash due snapshot frozen.');
        $this->assertSame('delivered', $order->fresh()->status);
        $this->assertNull($order->fresh()->completed_at, 'COD order is not terminal while cash is pending.');

        $token = $this->riderToken();
        $this->withHeader('Authorization', 'Bearer '.$token)
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/settle-cod', [
                'cash_received' => (float) $order->total,
            ])
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertSame('completed', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertSame('completed', $order->fresh()->status);
        $this->assertNotNull($order->fresh()->completed_at);
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertSame(1, Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('method', 'cash')
            ->where('status', 'paid')
            ->count());
        $this->assertSame('available', $this->rider->fresh()->riderDetail->rider_status);
    }

    public function test_reconfirming_an_already_confirmed_delivery_is_idempotent(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-IDEMPOTENT');
        $this->makeDelivery($order);

        $token = $this->customerToken();

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'completed');

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'completed');

        $this->assertSame('completed', $order->fresh()->status);
    }

    public function test_other_tourist_cannot_confirm_someone_elses_delivery(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-403');
        $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->otherCustomer->createToken('test')->plainTextToken)
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertStatus(403);

        $this->assertNotSame('completed', $order->fresh()->status);
    }

    public function test_rider_role_cannot_call_the_tourist_confirm_endpoint(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-ROLE');
        $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->riderToken())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertStatus(403);
    }

    public function test_confirmation_before_arrival_is_rejected(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-EARLY');
        $this->makeDelivery($order, 'in_transit');

        $this->withHeader('Authorization', 'Bearer '.$this->customerToken())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertStatus(422)
            ->assertJsonPath('message', 'Your order has not arrived yet. Please confirm once the rider reaches you.');
    }

    public function test_unauthenticated_request_is_rejected(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-UNAUTH');
        $this->makeDelivery($order);

        $this->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertStatus(401);
    }

    public function test_transport_rides_stay_rider_driven_and_are_not_gated(): void
    {
        $order = $this->makeOrder('gcash', 'TT-TRANSPORT', 'transport');
        $delivery = $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->riderToken())
            ->patchJson('/api/rider/deliveries/'.$delivery->id.'/status', ['status' => 'delivered'])
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertSame('completed', $delivery->fresh()->status->value ?? $delivery->fresh()->status,
            'A transport ride completes on the riders own delivered action.');
    }
}