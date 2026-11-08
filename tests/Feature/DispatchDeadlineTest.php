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
 * P3 (master spec §17/§19/§49/§54/§64): dispatch-cycle deadline and
 * no-silent-dead-end guarantees.
 *
 * Covered guarantees:
 *  - dispatch_started_at (the 60-minute cycle anchor) is recorded before any
 *    coordinate guard; a business without coordinates can never strand a
 *    delivery at 'waiting_for_rider' (a status the scheduler never selects).
 *  - Every dispatch attempt ends observably: retry timestamp, or terminal
 *    failure with dispatch_end_reason + dispatch_ended_at
 *    (invalid_pickup_coordinates | no_rider_accepted | rider_accepted |
 *    order_cancelled).
 *  - The scheduler never claims a retry for an expired cycle; the deadline
 *    terminates it WITHOUT burning an attempt.
 *  - dispatchToNearest enforces the same deadline for non-scheduler callers
 *    (decline re-offer, timeout re-offer).
 *
 * The scheduler-runs-retry-independently guarantee (§64) is covered by
 * DispatchNoRiderRetryTest::test_parked_delivery_recovers_once_a_rider_
 * becomes_eligible; this file covers the deadline/dead-end behavior.
 *
 * Http::fake keeps the socket bridge out: candidate selection is MySQL-only
 * and deterministic (COD filtering is Eloquent + PHP haversine → SQLite-safe).
 */
class DispatchDeadlineTest extends TestCase
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
            'delivery.scheduler.dispatch_deadline_minutes' => 60,
        ]);

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
            ['email' => 'owner-deadline@example.com'],
            [
                'password' => Hash::make('Password123!'),
                'role' => 'business_owner',
                'account_status' => 'approved',
            ]
        );
    }

    private function makeCashOrder(Business $business): Order
    {
        return Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust-deadline@example.com',
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

    /** Approved + available + food-service rider with fresh GPS AT the pickup. */
    private function makeEligibleRider(Business $business): User
    {
        $rider = User::create([
            'email' => 'rider-deadline@example.com',
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

    /** scheduleDispatch → dispatchNow → dispatchToNearest; returns order + delivery. */
    private function dispatchCheckout(Business $business): Delivery
    {
        $order = $this->makeCashOrder($business);

        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery, 'scheduleDispatch created the delivery.');

        return $delivery;
    }

    private function makeDueForRetry(Delivery $delivery): void
    {
        DB::table('deliveries')->where('id', $delivery->id)
            ->update(['dispatch_retry_at' => now()->subMinute()]);
    }

    private function expireCycle(Order $order, int $minutesAgo = 61): void
    {
        DB::table('orders')->where('id', $order->id)
            ->update(['dispatch_started_at' => now()->subMinutes($minutesAgo)]);
    }

    private function assertTerminal(Delivery $delivery, string $reason): void
    {
        $delivery->refresh();
        $this->assertSame('dispatch_failed', $delivery->dispatch_status);
        $this->assertSame($reason, $delivery->dispatch_end_reason);
        $this->assertNotNull($delivery->dispatch_ended_at);
        $this->assertNotNull($delivery->dispatch_failed_at);
        $this->assertNull($delivery->dispatch_retry_at, 'A terminal failure carries no pending retry.');
    }

    // ---------- no silent dead end: invalid pickup coordinates ----------

    public function test_missing_pickup_coordinates_parks_with_retry_and_records_cycle_anchor(): void
    {
        $business = $this->makeBusiness('No Coords');
        DB::table('businesses')->where('id', $business->id)
            ->update(['latitude' => null, 'longitude' => null]);

        $order = $this->makeCashOrder($business);
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $order->refresh();
        $this->assertNotNull(
            $order->dispatch_started_at,
            'The 60-minute cycle anchor is recorded before any coordinate guard.'
        );

        $delivery = $order->delivery;
        $this->assertNotNull($delivery, 'A coordinate-less business still creates the delivery.');
        $delivery->refresh();

        $this->assertSame(
            'no_rider_available',
            $delivery->dispatch_status,
            'The delivery parks with a retry instead of stranding at waiting_for_rider.'
        );
        $this->assertNotNull($delivery->dispatch_retry_at);
        $this->assertTrue($delivery->dispatch_retry_at->isFuture());
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    public function test_missing_coordinates_terminate_with_invalid_pickup_reason_at_attempt_cap(): void
    {
        $business = $this->makeBusiness('No Coords 2');
        DB::table('businesses')->where('id', $business->id)
            ->update(['latitude' => null, 'longitude' => null]);

        $order = $this->makeCashOrder($business);
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        DB::table('deliveries')->where('id', $delivery->id)
            ->update(['dispatch_retry_at' => now()->subMinute(), 'dispatch_attempts' => 3]);

        $this->assertSame(1, $this->processor->process());

        $this->assertTerminal($delivery, 'invalid_pickup_coordinates');
        $this->assertSame(4, $delivery->fresh()->dispatch_attempts);
        $this->assertSame(0, $this->processor->process(), 'Terminal state is never re-selected.');
    }

    // ---------- 60-minute cycle deadline ----------

    public function test_expired_cycle_on_the_manual_board_terminates_with_reason_and_no_new_attempt(): void
    {
        // Reconciled 2026-11-07 (AGENTS.md §12; docs/dispatch-escalation-plan.md):
        // a food delivery with no eligible rider now waits on the manual board
        // instead of the retry loop, so the retry scheduler no longer selects
        // it. The 60-minute deadline is enforced by the server worker
        // (dispatch:process-offer-timeouts → SequentialDispatchService::
        // expireOverdue) with the same observable terminal state.
        $business = $this->makeBusiness('Expired'); // No riders exist.
        $order = $this->makeCashOrder($business);
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertSame('manual', $delivery->dispatch_phase);

        // Not expired yet: the worker leaves it on the board.
        $this->expireCycle($order, 59);
        $this->artisan('dispatch:process-offer-timeouts')->assertSuccessful();
        $this->assertSame('waiting_for_rider', $delivery->fresh()->dispatch_status);

        $this->expireCycle($order, 61);
        $this->artisan('dispatch:process-offer-timeouts')->assertSuccessful();

        $this->assertTerminal($delivery, 'no_rider_accepted');
        $this->assertEquals(0, $delivery->fresh()->dispatch_attempts, 'No retry attempt is burned.');
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
        $this->assertSame(0, $this->processor->process(), 'An expired cycle is never retried again.');
        $this->assertFalse(app(NearestRiderService::class)->deliveryIsClaimable($delivery->fresh()), 'Expired deliveries leave the board.');
    }

    public function test_expiry_withdraws_a_live_targeted_offer_but_never_touches_an_accepted_delivery(): void
    {
        $business = $this->makeBusiness('Expired Live Offer');
        $rider = $this->makeEligibleRider($business);
        $delivery = $this->dispatchCheckout($business);
        $this->assertSame('notified', $delivery->fresh()->dispatch_status);

        $this->expireCycle($delivery->order, 61);
        $this->artisan('dispatch:process-offer-timeouts')->assertSuccessful();

        $this->assertTerminal($delivery, 'no_rider_accepted');
        $this->assertSame('timeout', BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $rider->id)->value('response'));
        $this->assertNull($delivery->fresh()->rider_id);

        // An accepted delivery is never expired.
        $other = $this->dispatchCheckout($this->makeBusiness('Accepted Before Deadline'));
        DB::table('deliveries')->where('id', $other->id)->update(['rider_id' => $rider->id, 'status' => 'assigned', 'dispatch_phase' => 'targeted']);
        $this->expireCycle($other->order, 61);
        $this->artisan('dispatch:process-offer-timeouts')->assertSuccessful();
        $this->assertNotSame('dispatch_failed', $other->fresh()->dispatch_status);
        $this->assertSame($rider->id, (int) $other->fresh()->rider_id);
    }

    public function test_direct_dispatch_entry_respects_the_cycle_deadline(): void
    {
        // Covers decline/timeout re-offers: they call dispatchToNearest()
        // directly (redispatchIfOffered), outside the scheduler.
        $business = $this->makeBusiness('Expired Direct');
        $order = $this->makeCashOrder($business);
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->expireCycle($order, 61);

        $result = app(NearestRiderService::class)->dispatchToNearest($delivery);

        $this->assertNull($result);
        $this->assertTerminal($delivery, 'no_rider_accepted');
    }

    // ---------- observable terminal reasons ----------

    public function test_successful_accept_records_rider_accepted_end_reason(): void
    {
        $business = $this->makeBusiness('Accept End');
        $rider = $this->makeEligibleRider($business);
        $delivery = $this->dispatchCheckout($business);
        $this->assertSame('notified', $delivery->fresh()->dispatch_status);

        $result = app(NearestRiderService::class)
            ->handleRiderResponse($delivery->id, $rider->id, 'accepted');

        $this->assertTrue($result['success']);

        $delivery->refresh();
        $this->assertEquals($rider->id, $delivery->rider_id);
        $this->assertNull($delivery->dispatch_status, 'The accepted delivery leaves the dispatch cycle.');
        $this->assertSame('rider_accepted', $delivery->dispatch_end_reason);
        $this->assertNotNull($delivery->dispatch_ended_at);
        $this->assertNull($delivery->dispatch_retry_at);
    }

    public function test_cancellation_records_order_cancelled_end_reason(): void
    {
        $business = $this->makeBusiness('Cancel End');
        $this->makeEligibleRider($business);
        $delivery = $this->dispatchCheckout($business);
        $this->assertSame('notified', $delivery->fresh()->dispatch_status);

        app(NearestRiderService::class)->cancelDelivery($delivery);

        $delivery->refresh();
        $this->assertSame('cancelled', $delivery->status->value);
        $this->assertNull($delivery->dispatch_status);
        $this->assertSame('order_cancelled', $delivery->dispatch_end_reason);
        $this->assertNotNull($delivery->dispatch_ended_at);
    }
}
