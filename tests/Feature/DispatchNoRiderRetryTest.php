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
    private function makeEligibleRider(Business $business): User
    {
        $rider = User::create([
            'email' => 'rider-retry@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
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

    public function test_checkout_dispatch_failure_parks_delivery_with_retry_timestamp(): void
    {
        $business = $this->makeBusiness('Retry A'); // No riders exist.

        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));

        $delivery->refresh();
        $this->assertSame('no_rider_available', $delivery->dispatch_status);
        $this->assertNotNull(
            $delivery->dispatch_retry_at,
            'An immediate dispatch failure must schedule a retry instead of dying as a terminal state.'
        );
        $this->assertTrue($delivery->dispatch_retry_at->between(now()->addMinutes(4), now()->addMinutes(6)));
        $this->assertEquals(0, $delivery->dispatch_attempts);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    public function test_parked_delivery_is_not_claimed_before_its_retry_time(): void
    {
        $business = $this->makeBusiness('Retry B');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business)); // retry_at = +5 min.

        $this->assertSame(0, $this->processor->process(), 'The backoff window is respected.');

        $delivery->refresh();
        $this->assertSame('no_rider_available', $delivery->dispatch_status);
        $this->assertEquals(0, $delivery->dispatch_attempts);
    }

    public function test_parked_delivery_is_retried_when_due_and_remains_parked_on_failure(): void
    {
        $business = $this->makeBusiness('Retry C');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business)); // Still no riders.
        $this->makeDueForRetry($delivery);

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame(
            'no_rider_available',
            $delivery->dispatch_status,
            'The merchant-visible state stays no-rider while the retry loop continues.'
        );
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertNotNull($delivery->dispatch_retry_at);
        $this->assertTrue($delivery->dispatch_retry_at->isFuture());
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());

        // Backoff: an immediate second run claims nothing.
        $this->assertSame(0, $this->processor->process());
        $this->assertEquals(1, $delivery->fresh()->dispatch_attempts);
    }

    public function test_parked_delivery_recovers_once_a_rider_becomes_eligible(): void
    {
        $business = $this->makeBusiness('Retry D');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));

        // The rider comes online with a fresh GPS fix AFTER the order was placed.
        $rider = $this->makeEligibleRider($business);
        $this->makeDueForRetry($delivery);

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame(
            'notified',
            $delivery->dispatch_status,
            'A later-eligible rider receives the offer the order never got at checkout.'
        );
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertNull($delivery->dispatch_retry_at, 'The retry timestamp is cleared once an offer exists.');
        $this->assertNotNull($delivery->dispatch_expires_at);

        $log = BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('response', 'pending')
            ->first();
        $this->assertNotNull($log, 'The recovery attempt created a real rider offer (the ping the rider was missing).');
        $this->assertSame($rider->id, $log->rider_id);
    }

    public function test_parked_delivery_marks_dispatch_failed_after_retries_are_exhausted(): void
    {
        $business = $this->makeBusiness('Retry E');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business)); // Still no riders.

        // max_retries 3 => max 4 attempts: start the final attempt just in time.
        DB::table('deliveries')->where('id', $delivery->id)->update([
            'dispatch_attempts' => 3,
            'dispatch_retry_at' => now()->subMinute(),
        ]);

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame('dispatch_failed', $delivery->dispatch_status, 'The retry loop stays bounded.');
        $this->assertNotNull($delivery->dispatch_failed_at);
        $this->assertNull($delivery->dispatch_retry_at, 'A terminal failure carries no pending retry timestamp.');
        $this->assertEquals(4, $delivery->dispatch_attempts);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());

        // Terminal: further runs must not touch it.
        $this->assertSame(0, $this->processor->process());
        $this->assertEquals(4, $delivery->fresh()->dispatch_attempts);
    }

    public function test_legacy_parked_delivery_without_retry_timestamp_is_still_claimed(): void
    {
        // Rows parked before this fix carry dispatch_retry_at = NULL; they must
        // be picked up too (the attempt cap bounds them to dispatch_failed, so
        // they cannot loop forever).
        $business = $this->makeBusiness('Retry F');
        $delivery = $this->makeParkedDelivery($this->makeImmediateCashOrder($business));

        DB::table('deliveries')->where('id', $delivery->id)
            ->update(['dispatch_retry_at' => null]);

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertSame('no_rider_available', $delivery->dispatch_status);
        $this->assertTrue($delivery->dispatch_retry_at->isFuture());
    }
}
