<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\ScheduledDispatchProcessor;
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Checkout-time dispatch failures used to be terminal: NearestRiderService
 * parked the delivery at 'no_rider_available' and NOTHING ever retried it — the
 * processor only selected 'scheduled'/'dispatching' and dispatch-on-ready is
 * gated on 'scheduled'. An order placed while no eligible rider existed (the
 * classic dev case: rider GPS stale or farther than the COD pickup radius)
 * could therefore never receive a rider later.
 *
 * Regression coverage for the retry fix, exercised end-to-end with the REAL
 * SmartDispatchService + ScheduledDispatchProcessor + NearestRiderService. The
 * COD candidate query is pure Eloquent + PHP haversine, so it runs on SQLite.
 * The order is cash so the strict COD eligibility gates apply (the exact path
 * that produced no eligible riders in the field report).
 *
 * Http::fake keeps the socket bridge out of the tests: the radar probe returns
 * no online riders, so candidate selection is MySQL-only and deterministic.
 */
class DispatchNoRiderRetryTest extends TestCase
{
    use RefreshDatabase;

    private ScheduledDispatchProcessor $processor;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'delivery.scheduler.max_retries' => 3,
            'delivery.scheduler.retry_after_minutes' => 5,
            'delivery.scheduler.claim_timeout_minutes' => 5,
        ]);

        // Never hit the live socket server from tests: an empty radar list
        // exercises the pure-MySQL candidate path deterministically.
        Http::fake([
            '*' => Http::response(['success' => true, 'onlineRiders' => []], 200),
        ]);

        $this->processor = app(ScheduledDispatchProcessor::class);
    }

    // ---------- helpers ----------

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
            'owner_id' => $this->makeOwner()->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeOwner(): User
    {
        return User::firstOrCreate(
            ['email' => 'owner-retry@example.com'],
            [
                'password' => Hash::make('Password123!'),
                'role' => 'business_owner',
                'account_status' => 'approved',
            ]
        );
    }

    /**
     * A cash (COD) order with no predicted_ready_at: calculateDispatchTime()
     * returns null -> scheduleDispatch() dispatches NOW, which is exactly the
     * checkout path where the original failure parked the delivery.
     */
    private function makeImmediateCashOrder(Business $business): Order
    {
        return Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.52,
            'delivery_longitude' => 121.32,
            'delivery_address' => '123 Test St',
        ]);
    }

    /**
     * Run the canonical checkout dispatch (scheduleDispatch -> dispatchNow ->
     * dispatchToNearest). With no eligible rider this parks the delivery at
     * 'no_rider_available' + dispatch_retry_at.
     */
    private function makeParkedDelivery(Order $order): Delivery
    {
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery, 'scheduleDispatch created the delivery.');

        return $delivery;
    }

    /**
     * A rider that passes every COD gate: approved + 'available' + food service,
     * fresh GPS fix (< 5 min) recorded AT the pickup point (0 km <= 5 km) and
     * no active bindings (limit 2).
     */
    private function makeEligibleRider(Business $business, string $service = 'food'): User
    {
        $rider = User::create([
            'email' => 'rider-retry-' . strtolower($service) . '-' . Str::random(6) . '@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => $service,
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => $service,
        ]);

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => $business->latitude,
            'longitude' => $business->longitude,
            'recorded_at' => now(),
        ]);

        return $rider;
    }

    private function makeDueForRetry(Delivery $delivery): void
    {
        DB::table('deliveries')->where('id', $delivery->id)
            ->update(['dispatch_retry_at' => now()->subMinute()]);
    }

    // ---------- tests ----------
    //
    // Reconciled 2026-11-07 (AGENTS.md §12; docs/dispatch-escalation-plan.md,
    // approved D1/D2): FOOD deliveries no longer park in the 5-minute retry
    // loop. When no eligible targeted rider exists the delivery moves to the
    // manual Available Deliveries board, where any rider who becomes eligible
    // later can claim it (first accept wins) until the 60-minute deadline.
    // The original guarantee — no silent dead end — is preserved: the order
    // stays claimable instead of waiting for a retry wave. Transport rides
    // keep the retry loop (see the transport test below).

    private function makeLegacyParkedRow(Delivery $delivery): void
    {
        // A food delivery parked by the pre-sequential engine (no phase).
        DB::table('deliveries')->where('id', $delivery->id)->update([
            'dispatch_status' => 'no_rider_available',
            'dispatch_phase' => null,
            'targeted_attempts' => 0,
            'dispatch_retry_at' => now()->subMinute(),
        ]);
    }

    public function test_checkout_with_no_eligible_rider_moves_to_the_manual_board_not_a_dead_end(): void
    {
        $business = $this->makeBusiness('Retry A'); // No riders exist.

        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));

        $delivery->refresh();
        $this->assertSame('manual', $delivery->dispatch_phase);
        $this->assertSame('waiting_for_rider', $delivery->dispatch_status);
        $this->assertNull($delivery->dispatch_retry_at, 'No retry wave: the board replaces it.');
        $this->assertEquals(0, $delivery->dispatch_attempts);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
        $this->assertTrue(app(NearestRiderService::class)->deliveryIsClaimable($delivery), 'Never a dead end: the order is claimable.');
    }

    public function test_manual_board_delivery_is_not_reselected_by_the_retry_scheduler(): void
    {
        $business = $this->makeBusiness('Retry B');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));
        $this->makeEligibleRider($business); // even with a rider now available

        $this->assertSame(0, $this->processor->process(), 'Board deliveries get no new targeted waves.');

        $delivery->refresh();
        $this->assertSame('manual', $delivery->dispatch_phase);
        $this->assertEquals(0, $delivery->dispatch_attempts);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    public function test_a_rider_who_becomes_eligible_later_claims_it_from_the_board(): void
    {
        $business = $this->makeBusiness('Retry D');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));

        // The rider comes online with a fresh GPS fix AFTER the order was placed.
        $rider = $this->makeEligibleRider($business);

        $result = app(NearestRiderService::class)->handleRiderResponse($delivery->id, $rider->id, 'accepted');

        $this->assertTrue($result['success'] ?? false, 'A later-eligible rider claims the order the checkout never assigned.');
        $this->assertSame($rider->id, (int) $delivery->fresh()->rider_id);
    }

    public function test_legacy_parked_food_delivery_is_migrated_into_sequential_dispatch(): void
    {
        // Rows parked by the old engine before deploy are still picked up once
        // and handed to the sequential flow (one targeted offer).
        $business = $this->makeBusiness('Retry F');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));
        $this->makeLegacyParkedRow($delivery);
        $rider = $this->makeEligibleRider($business);

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertSame('targeted', $delivery->dispatch_phase);
        $this->assertSame(1, $delivery->targeted_attempts);
        $this->assertNull($delivery->dispatch_retry_at);
        $this->assertSame($rider->id, (int) BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->value('rider_id'));
    }

    public function test_legacy_parked_food_delivery_without_a_rider_moves_to_the_board_not_back_to_retry(): void
    {
        $business = $this->makeBusiness('Retry E');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));
        $this->makeLegacyParkedRow($delivery);

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame('manual', $delivery->dispatch_phase);
        $this->assertSame('waiting_for_rider', $delivery->dispatch_status);
        $this->assertNull($delivery->dispatch_retry_at);
        $this->assertSame(0, $this->processor->process(), 'Never re-parked in the retry loop.');
    }

    public function test_parked_transport_delivery_is_retried_with_transport_rider_cohort(): void
    {
        // Transport (ride-hailing) orders stay at 'pending' while awaiting a
        // rider and never pass through the restaurant statuses, so a ride that
        // missed the instantaneous checkout dispatch must still be re-offered
        // by the scheduler — to a rider on the TRANSPORT service only.
        $business = $this->makeBusiness('Retry G');

        $order = Order::create([
            'order_number' => 'TRP-' . strtoupper(uniqid()),
            // Canonical ride isolation: transport orders have no restaurant.
            'business_id' => null,
            'customer_name' => 'Rider',
            'customer_email' => 'rider@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'transport',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => 'pending',
            'subtotal' => 150,
            'delivery_fee' => 0,
            'system_fee' => 0,
            'total' => 150,
            'delivery_latitude' => 12.52,
            'delivery_longitude' => 121.32,
        ]);

        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => 'waiting',
            'dispatch_status' => 'no_rider_available',
            'dispatch_retry_at' => now()->subMinute(),
            'pickup_latitude' => $business->latitude,
            'pickup_longitude' => $business->longitude,
            'delivery_latitude' => 12.52,
            'delivery_longitude' => 121.32,
        ]);

        // A food rider must NOT be offered a ride-hailing delivery.
        $this->makeEligibleRider($business, 'food');
        // The transport rider comes online after the ride was parked.
        $transportRider = $this->makeEligibleRider($business, 'transport');

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame(
            'notified',
            $delivery->dispatch_status,
            'An eligible transport rider receives the ride offer it never got at booking.'
        );
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertNull($delivery->dispatch_retry_at, 'The retry timestamp is cleared once an offer exists.');

        $logs = BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('response', 'pending')
            ->get();
        $this->assertCount(1, $logs, 'Only the transport rider is offered the ride.');
        $this->assertSame($transportRider->id, $logs->first()->rider_id);
        $this->assertNotSame('food', $transportRider->riderDetail->current_service);
    }

    public function test_pending_transport_order_does_not_break_food_selection(): void
    {
        // The transport 'pending' rule must not leak into food selection: a
        // legacy-parked waiting_restaurant food order is still processed (and
        // handed to sequential dispatch).
        $business = $this->makeBusiness('Retry H');

        $foodDelivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));
        $this->makeLegacyParkedRow($foodDelivery);
        $this->makeEligibleRider($business, 'food');

        $this->assertSame(1, $this->processor->process());

        $foodDelivery->refresh();
        $this->assertSame('notified', $foodDelivery->dispatch_status);
    }
}
