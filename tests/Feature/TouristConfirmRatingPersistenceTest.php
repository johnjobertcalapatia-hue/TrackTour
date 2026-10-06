<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Review;
use App\Models\RiderDetail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Rating persistence/flow on the tourist-confirmation gate's completion path.
 *
 * The tourist-confirmation gate is the only way a food delivery becomes
 * terminal:
 *
 *   prepaid confirm -> order 'completed' (canonical prepaid terminal)
 *   COD    confirm -> delivery 'delivered' (stays until cash settlement)
 *
 * Rating is part of that completion path: once the gate closes, the tourist
 * must be able to rate the trip and the delivery_rating must persist so the
 * rider's average rating reflects it (rider stats read orders.delivery_rating).
 *
 * This file deliberately does NOT re-test the gate mechanics already pinned by
 * TouristConfirmDeliveryTest (rider gate, prepaid->completed, COD->delivered,
 * idempotency, ownership 403, transport retention). It covers ONLY the grading
 * contract of the completion path.
 */
class TouristConfirmRatingPersistenceTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $customer;
    private User $otherCustomer;
    private User $rider;
    private Business $restaurant;
    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-rating@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->customer = User::create([
            'email' => 'customer-rating@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->otherCustomer = User::create([
            'email' => 'other-rating@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->rider = User::create([
            'email' => 'rider-rating@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderDetail::create([
            'user_id' => $this->rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        $this->municipality = Municipality::create([
            'name' => 'Bongabong',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.7,
            'longitude' => 121.4,
        ]);

        $this->restaurant = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => 'Rating Gate Restaurant',
            'status' => 'approved',
        ]);
    }

    // ---------- helpers ----------

    private function makeOrder(string $paymentMethod, string $orderNumber): Order
    {
        return Order::create([
            'order_number' => $orderNumber,
            'business_id' => $this->restaurant->id,
            'user_id' => $this->customer->id,
            'customer_name' => 'Rating Gate Tourist',
            'customer_email' => $this->customer->email,
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentMethod === 'cash' ? 'unpaid' : 'paid',
            'status' => 'ready',
            'subtotal' => 450.00,
            'system_fee' => 15.00,
            'delivery_fee' => 80.00,
            'rider_tip' => 20.00,
            'rider_financed_amount' => $paymentMethod === 'cash' ? 450.00 : 0,
            'total' => 565.00,
            'delivery_address' => '456 Rating St, Bongabong',
            'delivery_latitude' => 12.72,
            'delivery_longitude' => 121.38,
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
            'pickup_latitude' => 12.70,
            'pickup_longitude' => 121.30,
            'delivery_latitude' => 12.72,
            'delivery_longitude' => 121.38,
        ]);
    }

    private function customerToken(): string
    {
        return $this->customer->createToken('test')->plainTextToken;
    }

    private function otherCustomerToken(): string
    {
        return $this->otherCustomer->createToken('test')->plainTextToken;
    }

    private function customerHeader(): array
    {
        return ['Authorization' => 'Bearer '.$this->customerToken()];
    }

    // ---------- prepaid: rating after the gate completes --------------

    public function test_prepaid_tourist_confirmation_allows_rating_and_persists_delivery_rating(): void
    {
        $order = $this->makeOrder('gcash', 'TT-RATE-PREPAID');
        $this->confirmPayment($order);
        $delivery = $this->makeDelivery($order);

        // Gate closes prepaid: tourist confirms receipt -> terminal 'completed'.
        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'completed');

        $this->assertSame('completed', $order->fresh()->status);
        $this->assertSame('completed', $delivery->fresh()->status->value);

        // Rating is part of the completion path and must persist delivery_rating.
        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/rate', [
                'rating' => 5,
                'food_rating' => 5,
                'service_rating' => 4,
                'delivery_rating' => 4,
                'review' => 'Fast and friendly rider.',
            ])
            ->assertOk()
            ->assertJsonPath('message', 'Thank you for your review!');

        $order->refresh();
        $this->assertSame(5, (int) $order->rating, 'Overall rating persisted on the order.');
        $this->assertSame(4, (int) $order->delivery_rating, 'Delivery rating persisted on the order for rider stats.');
        $this->assertSame('Fast and friendly rider.', $order->review, 'Review persisted on the order.');
        $this->assertSame('completed', $order->status, 'Rating does not regress the terminal state.');

        // A Review row carries the delivery_rating alongside the food/service splits.
        $review = Review::where('order_id', $order->id)->sole();
        $this->assertSame(5, (int) $review->rating);
        $this->assertSame(4, (int) $review->delivery_rating);

        // Rider average: orders.delivery_rating now feeds the stats AVG.
        $this->assertSame(
            1,
            Payment::where('payable_type', Order::class)
                ->where('payable_id', $order->id)
                ->where('method', 'gcash')
                ->where('status', 'paid')
                ->count(),
            'Prepaid payment already recorded; rating only adds the review.'
        );
    }

    public function test_cod_exposes_delivered_to_rating_then_settlement_completes(): void
    {
        $order = $this->makeOrder('cash', 'TT-RATE-COD');
        $delivery = $this->makeDelivery($order);
        $cashDue = (float) $order->total;

        // Gate closes COD: tourist confirms -> 'delivered' (NOT terminal yet).
        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk()
            ->assertJsonPath('data.new_status', 'delivered');

        $this->assertSame('delivered', $order->fresh()->status);

        // The tourist may rate the trip while the COD order sits at 'delivered'.
        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/rate', [
                'rating' => 4,
                'delivery_rating' => 3,
                'review' => 'Waited a little but all good.',
            ])
            ->assertOk()
            ->assertJsonPath('message', 'Thank you for your review!');

        $order->refresh();
        $this->assertSame(3, (int) $order->delivery_rating, 'Delivery rating persisted at the COD delivered gate.');
        $this->assertSame('delivered', $order->status, 'Rating keeps COD delivered until cash settlement.');

        // Settlement then reaches the canonical completed terminal.
        $this->withHeaders(['Authorization' => 'Bearer '.$this->riderToken()])
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/settle-cod', ['cash_received' => $cashDue])
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertSame('completed', $order->fresh()->status);
        $this->assertSame(3, (int) $order->fresh()->delivery_rating, 'Delivery rating survives the COD settlement.');

        $this->assertSame(
            1,
            Payment::where('payable_type', Order::class)
                ->where('payable_id', $order->id)
                ->where('method', 'cash')
                ->where('status', 'paid')
                ->count(),
            'Cash payment recorded only after settlement.'
        );
    }

    // ---------- negative + ownership ----------

    public function test_rating_is_rejected_while_the_gate_has_not_closed(): void
    {
        $order = $this->makeOrder('gcash', 'TT-RATE-EARLY');
        $this->makeDelivery($order, 'in_transit');

        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/rate', [
                'rating' => 5,
                'delivery_rating' => 5,
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'You can only rate completed orders.');
    }

    public function test_only_the_owning_tourist_can_rate_the_order(): void
    {
        $order = $this->makeOrder('gcash', 'TT-RATE-OWNER');
        $this->makeDelivery($order, 'arrived_destination');

        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk();

        $this->withHeaders(['Authorization' => 'Bearer '.$this->otherCustomerToken()])
            ->postJson('/api/tourist/food/order/'.$order->id.'/rate', [
                'rating' => 5,
            ])
            ->assertStatus(403);
    }

    public function test_unauthenticated_rating_request_is_rejected(): void
    {
        $order = $this->makeOrder('gcash', 'TT-RATE-UNAUTH');
        $this->makeDelivery($order);

        $this->postJson('/api/tourist/food/order/'.$order->id.'/rate', [
            'rating' => 5,
        ])->assertStatus(401);
    }

    public function test_rating_after_the_gate_is_idempotent_and_does_not_fork_orders(): void
    {
        $order = $this->makeOrder('gcash', 'TT-RATE-IDEMP');
        $this->makeDelivery($order);

        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertOk();

        $rateBody = ['rating' => 4, 'delivery_rating' => 4, 'review' => 'Good ride.'];

        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/rate', $rateBody)
            ->assertOk();

        $this->withHeaders($this->customerHeader())
            ->postJson('/api/tourist/food/order/'.$order->id.'/rate', $rateBody)
            ->assertOk();

        $this->assertSame(1, Review::where('order_id', $order->id)->count(),
            'Re-rating updates the existing review instead of stacking duplicates.');
        $this->assertSame('completed', $order->fresh()->status);
    }

    private function riderToken(): string
    {
        return $this->rider->createToken('test')->plainTextToken;
    }

    private function confirmPayment(Order $order): void
    {
        Payment::create([
            'payment_number' => 'PAY-RATE-'.uniqid(),
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $order->user_id,
            'amount' => $order->total,
            'currency' => 'PHP',
            'method' => 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'pi-rate-'.uniqid(),
            'status' => 'paid',
            'paid_at' => now(),
        ]);
    }
}
