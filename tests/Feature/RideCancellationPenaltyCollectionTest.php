<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RideCancellationPenalty;
use App\Models\RiderDetail;
use App\Models\SystemIncident;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Ride hailing — Stage C (owner decisions 2026-11-18): an OWED ₱50
 * cancellation fee is collected on its own — in cash by the passenger's next
 * driver at the drop-off (confirmed separately from the fare), or online as
 * its own PayMongo payment. Never added to a ride's amounts; never collected
 * twice; under review / disputed are never collected. The tourist is notified
 * when the fee is created and when it is paid.
 */
class RideCancellationPenaltyCollectionTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $firstRider;

    private User $nextRider;

    /** Outgoing HTTP (PayMongo); a test replaces it. */
    private \Closure $http;

    protected function setUp(): void
    {
        parent::setUp();
        $this->http = fn () => Http::response([], 200);
        Http::fake(fn ($request) => ($this->http)($request));
        Cache::flush();
        config(['services.paymongo.secret_key' => 'sk_test_stage_c', 'services.paymongo.webhook_secret' => '']);
        $this->travelTo(CarbonImmutable::parse('2026-11-18 10:00:00'));
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@stagec.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->firstRider = $this->rider('first@stagec.test', 'Aldrin Robledo');
        $this->nextRider = $this->rider('next@stagec.test', 'Ben Santos');
    }

    private function rider(string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $u->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);

        return $u;
    }

    private function ride(User $rider, string $status = 'assigned', string $payment = 'cash'): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => $payment, 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update(['rider_id' => $rider->id, 'status' => $status, 'assigned_at' => now()]);

        return $order->fresh();
    }

    private function delivery(Order $order): Delivery
    {
        return Delivery::where('order_id', $order->id)->sole();
    }

    /** A cancelled earlier ride with a ₱50 penalty in the given status. */
    private function penalty(string $status = RideCancellationPenalty::STATUS_OWED): RideCancellationPenalty
    {
        $earlier = $this->ride($this->firstRider);
        $earlier->update(['status' => 'cancelled']);
        Delivery::where('order_id', $earlier->id)->update(['status' => 'cancelled']);

        return RideCancellationPenalty::create([
            'cancelled_order_id' => $earlier->id, 'delivery_id' => $this->delivery($earlier)->id, 'tourist_id' => $this->tourist->id,
            'compensated_rider_id' => $this->firstRider->id, 'penalty_amount' => 50, 'acceptance_at' => now()->subMinutes(10),
            'cancelled_at' => now(), 'seconds_after_acceptance' => 600, 'status' => $status, 'review_reasons' => [],
        ]);
    }

    private function collect(Order $ride, int $penaltyId, ?User $as = null)
    {
        return $this->actingAs($as ?? $this->nextRider, 'sanctum')
            ->postJson("/api/rider/deliveries/{$this->delivery($ride)->id}/cancellation-fee/collect", ['penalty_id' => $penaltyId]);
    }

    public function test_a_cancellation_that_creates_a_penalty_notifies_the_tourist_and_returns_it(): void
    {
        $ride = $this->ride($this->firstRider);
        $this->travelTo(now()->addMinutes(17));

        $response = $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$ride->id}/cancel", ['reason' => 'changed_plans'])->assertOk();

        // Stage C2: owed (no arrival / GPS evidence is required).
        $response->assertJsonPath('data.cancellation_fee', 50)
            ->assertJsonPath('data.cancellation_penalty.status', 'owed')
            ->assertJsonPath('data.cancellation_penalty.can_pay', true)
            ->assertJsonPath('data.cancellation_penalty.notice.title', '₱50.00 cancellation fee');

        $note = Notification::where('user_id', $this->tourist->id)->where('type', 'ride_cancellation_penalty')->sole();
        $this->assertSame('₱50.00 cancellation fee', $note->title);
        $this->assertStringContainsString("You cancelled ride {$ride->order_number} 17 min after your driver accepted", $note->message);
        $this->assertStringContainsString('A ₱50.00 cancellation fee applies', $note->message);
        // 2026-11-23: no dispute; it is added to the next ride or food order payment.
        $this->assertStringContainsString('added to your next ride or food order payment', $note->message);
        $this->assertStringNotContainsString('dispute', $note->message);
    }

    public function test_an_owed_fee_shows_on_the_next_ride_for_both_the_driver_and_the_tourist(): void
    {
        $penalty = $this->penalty();
        $next = $this->ride($this->nextRider, 'in_transit');

        $this->actingAs($this->nextRider, 'sanctum')->getJson('/api/rider/map/location')->assertOk()
            ->assertJsonPath('data.deliveries.0.cancellation_fee_due.penalty_id', $penalty->id)
            ->assertJsonPath('data.deliveries.0.cancellation_fee_due.amount', 50);
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$next->id}/status")->assertOk()
            ->assertJsonPath('data.cancellation_fee_due.penalty_id', $penalty->id);

        // Never added to the ride's own amounts.
        $this->assertEquals((float) $next->total, (float) $next->fresh()->total);
    }

    public function test_the_next_driver_collects_it_in_cash_at_the_drop_off_once(): void
    {
        $penalty = $this->penalty();
        $next = $this->ride($this->nextRider, 'in_transit');

        $this->collect($next, $penalty->id)->assertStatus(422);  // not at the drop-off yet
        Delivery::where('order_id', $next->id)->update(['status' => 'arrived_destination']);
        $this->collect($next, $penalty->id, $this->firstRider)->assertForbidden(); // not this driver's ride

        $this->collect($next, $penalty->id)->assertOk()->assertJsonPath('data.status', 'collected');
        $this->collect($next, $penalty->id)->assertOk(); // repeat-safe

        $penalty->refresh();
        $this->assertSame('collected', $penalty->status);
        $this->assertSame('cash', $penalty->collection_method);
        $this->assertSame($this->nextRider->id, (int) $penalty->collected_by);
        $this->assertSame($next->id, (int) $penalty->collection_order_id);
        $this->assertSame(1, TransactionEvent::where('event_type', 'ride_cancellation_penalty_collected')->count());
        $this->assertSame(1, ActivityLog::where('action', 'ride.cancellation_penalty_collected')->count());
        $this->assertTrue(Notification::where('user_id', $this->tourist->id)->where('title', '₱50.00 cancellation fee paid')->exists());

        // No longer due; the ride's amounts never changed.
        $this->actingAs($this->nextRider, 'sanctum')->getJson('/api/rider/map/location')
            ->assertJsonPath('data.deliveries.0.cancellation_fee_due', null);

        // Its own line in that driver's daily cash receipt (not earnings).
        $receipt = app(\App\Services\RiderCashFundService::class)->dailyReceipt($this->nextRider, '2026-11-18');
        $this->assertSame(1, $receipt['cancellation_fees']['count']);
        $this->assertEquals(50.0, $receipt['cancellation_fees']['total']);
        $this->assertSame($this->firstRider->id, $receipt['cancellation_fees']['items'][0]['owed_to_rider_id']);
    }

    public function test_under_review_or_disputed_fees_are_never_collected_or_shown(): void
    {
        $penalty = $this->penalty(RideCancellationPenalty::STATUS_UNDER_REVIEW);
        $next = $this->ride($this->nextRider, 'arrived_destination');

        $this->actingAs($this->nextRider, 'sanctum')->getJson('/api/rider/map/location')
            ->assertJsonPath('data.deliveries.0.cancellation_fee_due', null);
        $this->collect($next, $penalty->id)->assertStatus(409);
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'ride_penalty', 'payable_id' => $penalty->id, 'method' => 'gcash'])
            ->assertStatus(422);
        $this->assertSame('under_review', $penalty->fresh()->status);
    }

    public function test_the_tourist_pays_it_online_on_its_own(): void
    {
        $penalty = $this->penalty();
        $sent = null;
        $this->http = function ($request) use (&$sent) {
            if (! str_contains($request->url(), 'checkout_sessions')) {
                return Http::response([], 200);
            }
            $sent = $request->data()['data']['attributes'];

            return Http::response(['data' => ['id' => 'cs_penalty', 'attributes' => ['status' => 'active', 'checkout_url' => 'https://checkout.paymongo.com/cs_penalty']]], 200);
        };

        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'ride_penalty', 'payable_id' => $penalty->id, 'method' => 'gcash'])
            ->assertOk();
        $this->assertSame(5000, $sent['line_items'][0]['amount']);
        $this->assertStringStartsWith('Cancellation fee (ride ', $sent['line_items'][0]['name']);
        $this->assertSame('CXL-'.$penalty->id, $sent['reference_number']);
        $payment = Payment::sole();
        $this->assertSame(RideCancellationPenalty::class, $payment->payable_type);

        $this->postJson('/api/payments/webhook', ['data' => ['attributes' => ['type' => 'checkout_session.completed', 'data' => ['id' => 'cs_penalty', 'status' => 'completed']]]])->assertOk();

        $penalty->refresh();
        $this->assertSame('collected', $penalty->status);
        $this->assertSame('online', $penalty->collection_method);
        $this->assertSame($payment->id, (int) $penalty->collection_payment_id);
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/payments/status/{$payment->payment_number}")
            ->assertJsonPath('data.payable_type', 'ride_penalty');

        // Paid: nothing more to pay or collect.
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'ride_penalty', 'payable_id' => $penalty->id, 'method' => 'gcash'])
            ->assertStatus(422);
    }

    public function test_a_payment_landing_after_cash_collection_is_never_applied_twice(): void
    {
        $penalty = $this->penalty();
        $next = $this->ride($this->nextRider, 'arrived_destination');
        $payment = Payment::create([
            'payment_number' => 'PAY-CXL-LATE', 'payable_type' => RideCancellationPenalty::class, 'payable_id' => $penalty->id, 'user_id' => $this->tourist->id,
            'amount' => 50, 'method' => 'gcash', 'provider' => 'paymongo', 'status' => 'pending', 'provider_payment_id' => 'cs_late',
        ]);
        $this->collect($next, $penalty->id)->assertOk();

        $this->postJson('/api/payments/webhook', ['data' => ['attributes' => ['type' => 'checkout_session.completed', 'data' => ['id' => 'cs_late', 'status' => 'completed']]]])->assertOk();

        $penalty->refresh();
        $this->assertSame('cash', $penalty->collection_method);
        $this->assertNull($penalty->collection_payment_id);
        $this->assertTrue(SystemIncident::where('code', 'penalty_double_payment')->exists(), 'The extra payment is escalated for a refund.');
    }

    public function test_another_tourist_cannot_pay_someone_elses_fee(): void
    {
        $penalty = $this->penalty();
        $other = User::create(['name' => 'Other', 'email' => 'other@stagec.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->actingAs($other, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'ride_penalty', 'payable_id' => $penalty->id, 'method' => 'gcash'])
            ->assertNotFound();
    }
}
