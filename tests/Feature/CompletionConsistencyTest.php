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
 * P10 — delivery-to-order completion consistency.
 *
 * The delivery lifecycle ends at 'completed' for BOTH payment methods, and the
 * order must reach the canonical 'completed' terminal state (with completed_at)
 * — not hang on a dangling 'delivered' that business-owner reports and the
 * order repository would never count as done.
 *
 *   1. prepaid: rider confirms delivered -> delivery completed + order completed
 *   2. COD:     rider confirms delivered -> order stays 'delivered' (cash not
 *               collected yet), settle-cod -> delivery + order completed
 *   3. business-owner manual 'completed' stamps completed_at
 */
class CompletionConsistencyTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $rider;
    private User $customer;
    private Business $restaurant;
    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-comp@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->customer = User::create([
            'email' => 'customer-comp@example.com',
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
            'business_name' => 'Completion Test Restaurant',
            'status' => 'approved',
        ]);

        $this->rider = User::create([
            'email' => 'rider-comp@example.com',
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

    private function makeOrder(string $paymentMethod, string $orderNumber): Order
    {
        return Order::create([
            'order_number' => $orderNumber,
            'business_id' => $this->restaurant->id,
            'user_id' => $this->customer->id,
            'customer_name' => 'John Jobert Jasa Calapatia',
            'customer_email' => $this->customer->email,
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentMethod === 'cash' ? 'unpaid' : 'paid',
            'status' => 'ready',
            'subtotal' => 1200.00,
            'system_fee' => 25.00,
            'delivery_fee' => 182.70,
            'rider_tip' => 0,
            'rider_financed_amount' => 1200.00,
            'total' => 1407.70,
            'delivery_address' => '123 Test St, Bansud',
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

    public function test_prepaid_delivery_confirmation_completes_delivery_and_order(): void
    {
        $order = $this->makeOrder('gcash', 'TT-COMP-PREPAID');
        $delivery = $this->makeDelivery($order);

        // P14 — the rider cannot mark a food delivery delivered; the tourist
        // confirms receipt at the drop-off, which completes the prepaid order.
        $this->withHeader('Authorization', 'Bearer '.$this->riderToken())
            ->patchJson('/api/rider/deliveries/'.$delivery->id.'/status', ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The tourist must confirm the delivery before it can be marked as delivered.');

        $this->withHeader('Authorization', 'Bearer '.$this->customerToken())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'completed');

        $this->assertSame('completed', $delivery->fresh()->status->value ?? $delivery->fresh()->status,
            'Prepaid delivery reaches completed.');
        $this->assertNotNull($delivery->fresh()->delivery_confirmed_at, 'Tourist confirmation is stamped.');
        $this->assertSame((int) $this->customer->id, (int) $delivery->fresh()->delivery_confirmed_by);
        $this->assertSame('completed', $order->fresh()->status,
            'Prepaid ORDER reaches completed (no dangling delivered).');
        $this->assertNotNull($order->fresh()->completed_at, 'Order completed_at is stamped.');
        $this->assertSame(1, RiderEarning::where('rider_id', $this->rider->id)->where('order_id', $order->id)->count(),
            'Rider earning recorded exactly once.');
        $this->assertSame('available', $this->rider->fresh()->riderDetail->rider_status,
            'Rider is free to take the next delivery.');
    }

    public function test_cod_delivery_completes_only_after_cash_settlement(): void
    {
        $order = $this->makeOrder('cash', 'TT-COMP-COD');
        $delivery = $this->makeDelivery($order);

        // Confirm delivered: cash NOT collected yet, so the order must NOT be
        // terminal — it hangs on 'delivered' until the rider hands over cash.
        // P14 — delivery is confirmed by the TOURIST, not the rider.
        $token = $this->riderToken();
        $this->withHeader('Authorization', 'Bearer '.$token)
            ->patchJson('/api/rider/deliveries/'.$delivery->id.'/status', ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The tourist must confirm the delivery before it can be marked as delivered.');

        $this->withHeader('Authorization', 'Bearer '.$this->customerToken())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'delivered');

        $this->assertSame('delivered', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertNotNull($delivery->fresh()->delivery_confirmed_at);
        $this->assertSame((int) $this->customer->id, (int) $delivery->fresh()->delivery_confirmed_by);
        $this->assertSame('delivered', $order->fresh()->status, 'Order stays delivered while cash is pending.');
        $this->assertNull($order->fresh()->completed_at);
        $this->assertSame((float) $order->total, (float) $delivery->fresh()->cash_due, 'Cash due snapshot frozen.');

        // Settle the cash: only now does delivery + order complete.
        $this->withHeader('Authorization', 'Bearer '.$token)
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/settle-cod', [
                'cash_received' => (float) $order->total,
            ])
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertSame('completed', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertSame('completed', $order->fresh()->status, 'COD ORDER reaches completed after settlement.');
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertNotNull($order->fresh()->completed_at);
        $this->assertSame(1, Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('method', 'cash')
            ->where('status', 'paid')
            ->count());
        $this->assertSame(1, RiderEarning::where('rider_id', $this->rider->id)->where('order_id', $order->id)->count(),
            'COD earning recorded exactly once.');
        $this->assertSame('available', $this->rider->fresh()->riderDetail->rider_status);
    }

    public function test_business_owner_cannot_mark_order_completed(): void
    {
        // Business owners must not be able to set an order to completed;
        // completion is reserved for the tourist/rider settlement flow.
        $order = $this->makeOrder('gcash', 'TT-COMP-BO');
        $order->update(['status' => 'preparing']);
        $this->makeDelivery($order);

        $token = $this->owner->createToken('test')->plainTextToken;

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->patchJson('/api/business-owner/orders/'.$order->id.'/status', ['status' => 'completed'])
            ->assertStatus(422);

        $this->assertNotSame('completed', $order->fresh()->status);
        $this->assertNull($order->fresh()->completed_at, 'completed_at must not be stamped by a business owner.');
    }
}