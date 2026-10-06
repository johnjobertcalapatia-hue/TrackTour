<?php

namespace Tests\Feature;

use App\Enums\TripStatus;
use App\Http\Controllers\Rider\RiderController;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Rider must stay online for the WHOLE trip.
 *
 * Invariant under test:
 *
 *   A rider may only go offline (or switch service) when they hold no
 *   delivery/trip that is still on the road. The guard must be based on the
 *   actual delivery row, not only the rider_status flag, so a rider whose
 *   status drifted away from 'busy' can never go offline mid-trip.
 *
 * Previously the toggle blocked only while rider_details.rider_status ===
 * 'busy'. A rider marked 'available'/'online' with a live trip (e.g. after a
 * status/trip drift) could POST /rider/availability/toggle and drop offline
 * mid-delivery or mid-ride. This suite locks the authoritative row check.
 */
class RiderStayOnlineForTripTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-stay-online@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'email' => 'tourist-stay-online@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
    }

    public static function provideActiveTripStatuses(): array
    {
        return [
            'assigned' => [TripStatus::ASSIGNED->value],
            'en_route_pickup' => [TripStatus::EN_ROUTE_PICKUP->value],
            'arrived_pickup' => [TripStatus::ARRIVED_PICKUP->value],
            'picked_up' => [TripStatus::PICKED_UP->value],
            'in_transit' => [TripStatus::IN_TRANSIT->value],
            'tour_started' => [TripStatus::TOUR_STARTED->value],
            'en_route_destination' => [TripStatus::EN_ROUTE_DESTINATION->value],
            'arrived_destination' => [TripStatus::ARRIVED_DESTINATION->value],
            'delivered' => [TripStatus::DELIVERED->value],
        ];
    }

    /**
     * @dataProvider provideActiveTripStatuses
     */
    public function test_rider_cannot_go_offline_while_holding_an_active_trip(string $status): void
    {
        $rider = $this->makeRider('active-trip-'.Str::slug($status).'@example.com', 'available');
        $this->makeDeliveryFor($rider, $status);

        $response = $this->toggleAvailability($rider);

        $this->assertSame(409, $response->getStatusCode());
        $this->assertStringContainsString(
            'delivery or trip',
            (string) json_decode($response->getContent())->message
        );
        $this->assertSame('available', $rider->fresh()->riderDetail->rider_status);
    }

    public function test_rider_can_go_offline_when_no_active_trip_exists(): void
    {
        $rider = $this->makeRider('idle-rider@example.com', 'available');
        $this->makeDeliveryFor($rider, TripStatus::COMPLETED->value);

        $this->assertSame(200, $this->toggleAvailability($rider)->getStatusCode());
        $this->assertSame('offline', $rider->fresh()->riderDetail->rider_status);
    }

    public function test_rider_can_go_offline_after_a_cancelled_trip(): void
    {
        $rider = $this->makeRider('cancelled-rider@example.com', 'available');
        $this->makeDeliveryFor($rider, TripStatus::CANCELLED->value);

        $this->assertSame(200, $this->toggleAvailability($rider)->getStatusCode());
        $this->assertSame('offline', $rider->fresh()->riderDetail->rider_status);
    }

    public function test_active_ride_hailing_trip_blocks_going_offline(): void
    {
        $rider = $this->makeRider('transport-rider@example.com', 'online');
        $delivery = $this->makeDeliveryFor($rider, TripStatus::IN_TRANSIT->value);

        $order = $delivery->primaryOrder();
        $order->update(['order_type' => 'transport']);

        $response = $this->toggleAvailability($rider);

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame('online', $rider->fresh()->riderDetail->rider_status);
    }

    public function test_active_trip_blocks_switching_service_even_when_not_busy(): void
    {
        $rider = $this->makeRider('service-lock@example.com', 'available');
        $this->makeDeliveryFor($rider, TripStatus::ARRIVED_DESTINATION->value);

        $response = $this->switchService($rider, 'transport');

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame(
            'available',
            $rider->fresh()->riderDetail->rider_status,
            'An active trip must keep the rider on their current service.'
        );
    }

    public function test_rider_without_trip_can_switch_service(): void
    {
        $rider = $this->makeRider('free-service@example.com', 'available');

        $response = $this->switchService($rider, 'transport');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('transport', $rider->fresh()->riderDetail->current_service);
    }

    public static function provideLogoutActiveTripStatuses(): array
    {
        return [
            'assigned' => [TripStatus::ASSIGNED->value],
            'in_transit' => [TripStatus::IN_TRANSIT->value],
            'delivered' => [TripStatus::DELIVERED->value],
        ];
    }

    /**
     * Logging out must never drop a mid-trip rider to 'offline'. That clobber
     * left rider_status out of sync with a live Delivery row, so on the next
     * login the rider saw a grey "Go Online" button whose tap the trip guard
     * rejects with 409 — the exact "currently in trip" trap.
     *
     * @dataProvider provideLogoutActiveTripStatuses
     */
    public function test_logout_does_not_drop_a_mid_trip_rider_offline(string $status): void
    {
        $rider = $this->makeRider('trip-logout-'.Str::slug($status).'@example.com', 'busy');
        $this->makeDeliveryFor($rider, $status);

        $response = $this->logoutRider($rider);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(
            'busy',
            $rider->fresh()->riderDetail->rider_status,
            'Logging out mid-trip must keep the rider online-bound to the trip.'
        );
    }

    public function test_logout_marks_an_idle_rider_offline(): void
    {
        $rider = $this->makeRider('idle-logout-rider@example.com', 'available');

        $response = $this->logoutRider($rider);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('offline', $rider->fresh()->riderDetail->rider_status);
    }

    public function test_logout_clears_a_stuck_busy_rider_with_no_trip_to_offline(): void
    {
        $rider = $this->makeRider('stuck-busy-rider@example.com', 'busy');

        $response = $this->logoutRider($rider);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('offline', $rider->fresh()->riderDetail->rider_status);
    }

    // ---------- helpers ----------

    private function logoutRider(User $rider)
    {
        $token = $rider->createToken('api-token')->plainTextToken;

        return $this->withHeader('Authorization', 'Bearer '.$token)->postJson('/api/logout');
    }

    private function toggleAvailability(User $rider)
    {
        $request = Request::create('/api/rider/availability/toggle', 'POST');
        $request->setUserResolver(fn () => $rider);

        return app(RiderController::class)->toggleAvailability($request);
    }

    private function switchService(User $rider, string $service)
    {
        $request = Request::create('/api/rider/service', 'POST', ['service' => $service]);
        $request->setUserResolver(fn () => $rider);

        return app(RiderController::class)->switchService($request);
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

    private function makeOrder(Business $business, string $paymentMethod = 'gcash', string $orderType = 'delivery'): Order
    {
        return Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust-stay-online@example.com',
            'customer_phone' => '09171234567',
            'order_type' => $orderType,
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

    private function makeDeliveryFor(User $rider, string $status): Delivery
    {
        $order = $this->makeOrder($this->makeBusiness('Stay Online Eatery '.Str::random(4)));

        return Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => $status,
            'pickup_address' => 'Pickup',
            'delivery_address' => $order->delivery_address,
        ]);
    }
}