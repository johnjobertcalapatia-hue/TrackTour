<?php

namespace Tests\Feature;

use App\Http\Controllers\Rider\RiderController;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\User;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Stale-busy rider release on delivery cancellation.
 *
 * Invariant under test:
 *
 *   A rider must not remain 'busy' when the delivery that made them busy has
 *   been cancelled, unless another active assignment legitimately keeps them
 *   busy.
 *
 * Before this guard, cancelDelivery() flipped only deliveries.status to
 * 'cancelled' and never touched rider_details.rider_status, so the rider was
 * stuck at 'busy' forever and every later POST /rider/availability/toggle
 * answered 409 Conflict ("You are currently on a delivery") even with no
 * operational delivery left.
 *
 * Covered:
 *   1. cancelling the owning delivery releases the busy rider -> toggle 200
 *   2. a genuinely occupied rider still gets the legitimate 409
 *   3. a rider with ANOTHER active delivery is NOT released (conditional guard)
 *   4. a rider who is not 'busy' is never flipped to 'available'
 *   5. the shared caller (cancelDeliveryForOrder: auto-reject / refund /
 *      restaurant-cancel) inherits the release
 *   6. a COD delivery at 'delivered' (awaiting settle-cod) is not cancelled
 *      and keeps the rider busy
 */
class RiderBusyReleaseTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $tourist;
    private NearestRiderService $dispatchService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-busy-release@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'email' => 'tourist-busy-release@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->dispatchService = app(NearestRiderService::class);
    }

    // ---------- 1. the fix: cancellation releases the owning rider ----------

    public function test_cancelling_the_delivery_releases_the_busy_rider(): void
    {
        $rider = $this->makeRider('release-busy@example.com', 'busy');
        $delivery = $this->makeDeliveryFor($rider, 'arrived_destination');

        $this->assertSame('busy', $rider->fresh()->riderDetail->rider_status);

        $this->dispatchService->cancelDelivery($delivery->fresh());

        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertSame(
            'available',
            $rider->fresh()->riderDetail->rider_status,
            'Cancelling the delivery that owned the busy state must release the rider.'
        );

        // The original symptom: the availability toggle now succeeds.
        $this->assertSame(200, $this->toggleAvailability($rider)->getStatusCode());
    }

    // ---------- 2. the legitimate conflict is preserved ----------

    public function test_toggle_still_conflicts_while_the_rider_really_is_on_a_delivery(): void
    {
        $rider = $this->makeRider('genuinely-busy@example.com', 'busy');
        $this->makeDeliveryFor($rider, 'in_transit');

        $response = $this->toggleAvailability($rider);

        $this->assertSame(409, $response->getStatusCode());
        $this->assertStringContainsString(
            'currently on a delivery',
            (string) json_decode($response->getContent())->message
        );
    }

    // ---------- 3. conditional guard: never release an occupied rider ----------

    public function test_cancellation_does_not_release_a_rider_with_another_active_delivery(): void
    {
        $rider = $this->makeRider('occupied-elsewhere@example.com', 'busy');

        // Delivery being cancelled…
        $cancelledDelivery = $this->makeDeliveryFor($rider, 'arrived_destination');
        // …while a SECOND non-terminal delivery still occupies the rider.
        $this->makeDeliveryFor($rider, 'assigned');

        $this->dispatchService->cancelDelivery($cancelledDelivery->fresh());

        $this->assertSame('cancelled', $cancelledDelivery->fresh()->status->value ?? $cancelledDelivery->fresh()->status);
        $this->assertSame(
            'busy',
            $rider->fresh()->riderDetail->rider_status,
            'The other active assignment legitimately keeps the rider busy.'
        );
        $this->assertSame(409, $this->toggleAvailability($rider)->getStatusCode());
    }

    // ---------- 4. never flip a rider who is not busy ----------

    public function test_cancellation_does_not_touch_a_rider_who_is_not_busy(): void
    {
        $rider = $this->makeRider('offline-rider@example.com', 'offline');
        $delivery = $this->makeDeliveryFor($rider, 'assigned');

        $this->dispatchService->cancelDelivery($delivery->fresh());

        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertSame(
            'offline',
            $rider->fresh()->riderDetail->rider_status,
            'A release must never promote a rider who is not marked busy.'
        );
    }

    // ---------- 5. every cancellation CALLER inherits the release ----------

    public function test_order_level_cancellation_path_releases_the_rider(): void
    {
        // This is the path used by auto-reject, auto-cancel, refund and
        // restaurant/order cancellation — all of them funnel through
        // cancelDeliveryForOrder() -> cancelDelivery().
        $rider = $this->makeRider('order-cancel-rider@example.com', 'busy');
        $order = $this->makeOrder($this->makeBusiness('Busy Release Eatery'));
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => 'assigned',
            'pickup_address' => 'Pickup',
            'delivery_address' => $order->delivery_address,
        ]);

        $this->dispatchService->cancelDeliveryForOrder($order);

        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertSame('available', $rider->fresh()->riderDetail->rider_status);
        $this->assertSame(200, $this->toggleAvailability($rider)->getStatusCode());
    }

    // ---------- 6. COD delivered-but-unsettled stays busy (intentional) ----------

    public function test_cod_delivered_delivery_is_not_cancelled_and_keeps_the_rider_busy(): void
    {
        $rider = $this->makeRider('cod-settling@example.com', 'busy');
        $delivery = $this->makeDeliveryFor($rider, 'delivered', 'cod');

        $this->dispatchService->cancelDelivery($delivery->fresh());

        $this->assertSame(
            'delivered',
            $delivery->fresh()->status->value ?? $delivery->fresh()->status,
            'A delivered COD delivery must not be cancelled by this path.'
        );
        $this->assertSame(
            'busy',
            $rider->fresh()->riderDetail->rider_status,
            'The rider stays busy until settle-cod completes the delivery.'
        );
        $this->assertSame(409, $this->toggleAvailability($rider)->getStatusCode());
    }

    // ---------- helpers ----------

    private function toggleAvailability(User $rider)
    {
        $request = Request::create('/api/rider/availability/toggle', 'POST');
        $request->setUserResolver(fn () => $rider);

        return app(RiderController::class)->toggleAvailability($request);
    }

    private function makeBusiness(string $name): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            [
                'district' => '1st',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.5,
                'longitude' => 121.3,
            ]
        );

        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeRider(string $email, string $status): User
    {
        $rider = User::create([
            'email' => $email,
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => $status,
            'current_service' => 'food',
        ]);

        return $rider;
    }

    private function makeOrder(Business $business, string $paymentMethod = 'gcash'): Order
    {
        return Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust-busy@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
            'payment_status' => 'paid',
            'status' => 'preparing',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_address' => '123 Test St',
            'predicted_ready_at' => now()->addMinutes(15),
            'predicted_preparation_seconds' => 900,
        ]);
    }

    private function makeDeliveryFor(User $rider, string $status, string $paymentMethod = 'gcash'): Delivery
    {
        $order = $this->makeOrder($this->makeBusiness('Busy Release Eatery '.Str::random(4)), $paymentMethod);

        return Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => $status,
            'pickup_address' => 'Pickup',
            'delivery_address' => $order->delivery_address,
        ]);
    }
}
