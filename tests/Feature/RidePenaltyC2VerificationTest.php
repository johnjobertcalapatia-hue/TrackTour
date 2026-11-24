<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RideCancellationPenalty;
use App\Models\RiderDetail;
use App\Models\SystemIncident;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\RideCancellationPenaltyService;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Stage C2 review checks (2026-11-18):
 * 1. the 299 / 300 / 301 s boundary, on server timestamps only;
 * 2. a repeated or concurrent cancellation yields one penalty and one result;
 * 3. a waiver racing an online payment: the payment notice never marks a
 *    waived penalty paid (status re-checked under a row lock), it is escalated
 *    for a refund; duplicate notices change nothing;
 * 4. only the Bansud Tourism Office can waive (not a municipal admin).
 */
class RidePenaltyC2VerificationTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private User $admin;

    private CarbonImmutable $t0;

    private \Closure $http;

    protected function setUp(): void
    {
        parent::setUp();
        $this->http = fn () => Http::response([], 200);
        Http::fake(fn ($request) => ($this->http)($request));
        Cache::flush();
        config(['services.paymongo.secret_key' => 'sk_test_c2', 'services.paymongo.webhook_secret' => '']);
        $this->t0 = CarbonImmutable::parse('2026-11-18 10:00:00');
        $this->travelTo($this->t0);
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@c2.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@c2.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);
        $this->admin = User::create(['name' => 'Bansud Tourism Office', 'email' => 'office@c2.test', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
    }

    /** A ride the rider accepted at $acceptedAt (the server's deliveries.assigned_at). */
    private function acceptedRide(CarbonImmutable $acceptedAt): Order
    {
        $this->travelTo($acceptedAt);
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update(['rider_id' => $this->rider->id, 'status' => 'assigned', 'assigned_at' => $acceptedAt]);
        $order->update(['status' => 'confirmed']);

        return $order->fresh();
    }

    private function cancel(Order $order, array $body = ['reason' => 'changed_plans'])
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/cancel", $body);
    }

    private function events(Order $order, string $type): int
    {
        return TransactionEvent::query()->whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))->where('event_type', $type)->count();
    }

    /* ── 1. Boundary, server clock only ─────────────────────────────── */

    public function test_299_and_300_seconds_are_free_and_301_owes_using_server_timestamps_only(): void
    {
        foreach ([299 => false, 300 => false, 301 => true] as $seconds => $owes) {
            $accepted = $this->t0->addHours($seconds); // each ride on its own clock
            $order = $this->acceptedRide($accepted);
            $this->travelTo($accepted->addSeconds($seconds));

            // A device-supplied time is ignored: it claims the opposite of the truth.
            $forged = $owes ? $accepted->addSeconds(10)->toIso8601String() : $accepted->addMinutes(30)->toIso8601String();
            $this->cancel($order, ['reason' => 'changed_plans', 'cancelled_at' => $forged, 'client_time' => $forged, 'seconds' => $owes ? 10 : 1800])->assertOk();

            $penalty = RideCancellationPenalty::where('cancelled_order_id', $order->id)->first();
            if ($owes) {
                $this->assertNotNull($penalty, "{$seconds} s after acceptance owes ₱50.");
                $this->assertSame('owed', $penalty->status);
                $this->assertSame(301, $penalty->seconds_after_acceptance);
                $this->assertTrue($penalty->acceptance_at->equalTo($accepted));
            } else {
                $this->assertNull($penalty, "{$seconds} s after acceptance is free.");
            }
        }
        $this->assertSame(1, RideCancellationPenalty::count());
    }

    /* ── 2. Repeated / concurrent cancellation ──────────────────────── */

    public function test_a_second_cancellation_of_the_same_ride_changes_nothing(): void
    {
        $order = $this->acceptedRide($this->t0);
        $this->travelTo($this->t0->addSeconds(600));

        $this->cancel($order)->assertOk()->assertJsonPath('data.cancellation_penalty.status', 'owed');
        // The second request re-reads the order under a row lock: already cancelled.
        $this->cancel($order)->assertStatus(422);

        $this->assertSame(1, RideCancellationPenalty::count());
        $this->assertSame(1, $this->events($order, 'ride_cancelled'));
        $this->assertSame(1, $this->events($order, 'ride_cancellation_penalty_assessed'));
        $this->assertSame(1, Notification::where('user_id', $this->tourist->id)->where('type', 'ride_cancellation_penalty')->count());
        $this->assertSame('cancelled', $order->fresh()->status);
    }

    public function test_assessing_the_same_cancelled_ride_again_returns_the_one_penalty(): void
    {
        // What a second, concurrent transaction would reach: the unique row
        // already exists, so it is returned and nothing is recorded twice.
        $order = $this->acceptedRide($this->t0);
        $this->travelTo($this->t0->addSeconds(600));
        $this->cancel($order)->assertOk();
        $first = RideCancellationPenalty::sole();

        $again = app(RideCancellationPenaltyService::class)->assess($order->fresh(), Delivery::where('order_id', $order->id)->sole(), $this->tourist->id);

        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, RideCancellationPenalty::count());
        $this->assertSame(1, $this->events($order, 'ride_cancellation_penalty_assessed'));
        $this->assertSame(1, Notification::where('user_id', $this->tourist->id)->where('type', 'ride_cancellation_penalty')->count());
    }

    /* ── 3. Waiver versus payment ───────────────────────────────────── */

    private function startOnlinePayment(RideCancellationPenalty $penalty): Payment
    {
        $this->http = fn ($request) => str_contains($request->url(), 'checkout_sessions')
            ? Http::response(['data' => ['id' => 'cs_c2_fee', 'attributes' => ['status' => 'active', 'checkout_url' => 'https://checkout.paymongo.com/cs_c2_fee']]], 200)
            : Http::response([], 200);
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'ride_penalty', 'payable_id' => $penalty->id, 'method' => 'gcash'])->assertOk();

        return Payment::where('payable_type', RideCancellationPenalty::class)->sole();
    }

    private function paidNotice(string $id = 'evt_c2_paid')
    {
        return $this->postJson('/api/payments/webhook', ['data' => ['id' => $id, 'attributes' => ['type' => 'checkout_session.completed', 'data' => ['id' => 'cs_c2_fee', 'status' => 'completed']]]]);
    }

    public function test_a_waiver_before_the_payment_notice_is_never_turned_into_paid(): void
    {
        $order = $this->acceptedRide($this->t0);
        $this->travelTo($this->t0->addSeconds(600));
        $this->cancel($order)->assertOk();
        $penalty = RideCancellationPenalty::sole();

        $payment = $this->startOnlinePayment($penalty);            // the tourist opens GCash / QR Ph
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/waive", ['reason' => 'Driver reported a breakdown.'])->assertOk();
        $this->paidNotice()->assertOk();                             // PayMongo confirms afterwards
        $this->paidNotice()->assertOk();                             // and repeats the notice

        $penalty->refresh();
        $this->assertSame('waived', $penalty->status, 'The waiver stands.');
        $this->assertNull($penalty->collected_at);
        $this->assertNull($penalty->collection_payment_id);
        $this->assertSame(0, $this->events($order, 'ride_cancellation_penalty_collected'));
        $this->assertFalse(Notification::where('user_id', $this->tourist->id)->where('title', '₱50.00 cancellation fee paid')->exists());
        // The money PayMongo took is recorded and escalated for a refund — once.
        $this->assertSame('paid', $payment->fresh()->status);
        $this->assertSame(1, SystemIncident::where('code', 'penalty_double_payment')->count());
        $this->assertStringContainsString('after it was waived', SystemIncident::where('code', 'penalty_double_payment')->sole()->title);
    }

    public function test_duplicate_payment_notices_for_an_owed_fee_collect_it_once(): void
    {
        $order = $this->acceptedRide($this->t0);
        $this->travelTo($this->t0->addSeconds(600));
        $this->cancel($order)->assertOk();
        $penalty = RideCancellationPenalty::sole();
        $payment = $this->startOnlinePayment($penalty);

        $this->paidNotice('evt_c2_a')->assertOk();
        $this->paidNotice('evt_c2_b')->assertOk(); // a second, distinct delivery of "paid"

        $penalty->refresh();
        $this->assertSame('collected', $penalty->status);
        $this->assertSame($payment->id, (int) $penalty->collection_payment_id);
        $this->assertSame(1, $this->events($order, 'ride_cancellation_penalty_collected'));
        $this->assertSame(0, SystemIncident::where('code', 'penalty_double_payment')->count());
        // Paid: it can no longer be waived.
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/waive", ['reason' => 'Too late to waive.'])->assertStatus(422);
    }

    /* ── 4. Authorization ───────────────────────────────────────────── */

    public function test_a_municipal_admin_cannot_list_or_waive_even_through_the_api(): void
    {
        $order = $this->acceptedRide($this->t0);
        $this->travelTo($this->t0->addSeconds(600));
        $this->cancel($order)->assertOk();
        $penalty = RideCancellationPenalty::sole();

        $municipality = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $municipalAdmin = User::create(['name' => 'Gloria Tourism Office', 'email' => 'gloria@c2.test', 'password' => Hash::make('x'), 'role' => 'tourism_office', 'account_status' => 'approved', 'municipality_id' => $municipality->id]);
        $owner = User::create(['name' => 'Owner', 'email' => 'owner@c2.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);

        foreach ([$municipalAdmin, $owner, $this->rider, $this->tourist] as $user) {
            $this->actingAs($user, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/waive", ['reason' => 'Trying to waive it.'])->assertForbidden();
            $this->actingAs($user, 'sanctum')->getJson('/api/admin/ride-penalties')->assertForbidden();
        }
        $this->assertSame('owed', $penalty->fresh()->status);
        $this->assertSame(0, $this->events($order, 'ride_cancellation_penalty_waived'));
    }
}
