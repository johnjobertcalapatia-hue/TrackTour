<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RideAdditionalCharge;
use App\Models\RideCancellationPenalty;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
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
 * Ride hailing — Stage B (owner decisions 2026-11-18): a tourist cancelling
 * more than 300 s after the rider accepted owes that rider ₱50 — OWED only
 * with a server-confirmed pickup arrival and recent GPS, otherwise UNDER
 * REVIEW (never collected). One penalty per cancelled ride; rider cancels
 * and cancellations before acceptance / within 300 s are free; the tourist
 * can dispute; the pickup-waiting fee stays separate (none on a cancel).
 */
class RideCancellationPenaltyTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private CarbonImmutable $t0;

    private const PICKUP = [12.51, 121.31];

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Cache::flush();
        $this->t0 = CarbonImmutable::parse('2026-11-18 10:00:00');
        $this->travelTo($this->t0);
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@pen.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@pen.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);
    }

    /** A ride accepted at t0 (or not accepted at all). */
    private function ride(bool $accepted = true): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => self::PICKUP[0], 'pickup_lng' => self::PICKUP[1], 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ]);
        if ($accepted) {
            Delivery::where('order_id', $order->id)->update(['rider_id' => $this->rider->id, 'status' => 'assigned', 'assigned_at' => $this->t0]);
            $order->update(['status' => 'confirmed']);
        }

        return $order->fresh();
    }

    private function delivery(Order $order): Delivery
    {
        return Delivery::where('order_id', $order->id)->sole();
    }

    private function fix(float $lat, float $lng, CarbonImmutable $at, ?float $accuracy = 8): void
    {
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => $lat, 'longitude' => $lng, 'accuracy_m' => $accuracy, 'recorded_at' => $at]);
    }

    private function cancelAt(Order $order, int $secondsAfterAcceptance)
    {
        $this->travelTo($this->t0->addSeconds($secondsAfterAcceptance));

        return $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/cancel", ['reason' => 'changed_plans']);
    }

    /** The rider drives to the pickup and confirms arrival there. */
    private function arriveAtPickup(Order $order, int $atSecond): void
    {
        $this->travelTo($this->t0->addSeconds($atSecond));
        $this->fix(self::PICKUP[0] + 0.0002, self::PICKUP[1], $this->t0->addSeconds($atSecond - 1));
        $this->actingAs($this->rider, 'sanctum')->patchJson("/api/rider/deliveries/{$this->delivery($order)->id}/status", ['status' => 'arrived_pickup'])->assertOk();
    }

    private function events(Order $order, string $type)
    {
        return TransactionEvent::query()->whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))->where('event_type', $type)->get();
    }

    public function test_cancelling_before_acceptance_is_free(): void
    {
        $order = $this->ride(accepted: false);
        $this->cancelAt($order, 900)->assertOk();
        $this->assertSame(0, RideCancellationPenalty::count());
    }

    public function test_cancelling_within_300_seconds_of_acceptance_is_free_even_at_exactly_300(): void
    {
        $order = $this->ride();
        $this->cancelAt($order, 300)->assertOk();
        $this->assertSame(0, RideCancellationPenalty::count());
    }

    public function test_after_300_seconds_with_a_confirmed_arrival_and_recent_gps_the_rider_is_owed_50(): void
    {
        $order = $this->ride();
        $this->arriveAtPickup($order, 240);
        $this->fix(self::PICKUP[0] + 0.0001, self::PICKUP[1], $this->t0->addSeconds(400)); // still there, recent
        $this->cancelAt($order, 420)->assertOk();

        $penalty = RideCancellationPenalty::sole();
        $this->assertSame(RideCancellationPenalty::STATUS_OWED, $penalty->status);
        $this->assertSame(50.0, $penalty->penalty_amount);
        $this->assertSame($this->rider->id, (int) $penalty->compensated_rider_id, 'Owed to the rider who accepted.');
        $this->assertSame($this->tourist->id, (int) $penalty->tourist_id);
        $this->assertSame(420, $penalty->seconds_after_acceptance);
        $this->assertSame([], $penalty->review_reasons);
        $this->assertSame(20, $penalty->evidence['latest_fix_age_s']);
        $this->assertNotNull($penalty->evidence['pickup_arrival_confirmed_at']);
        $this->assertCount(1, $this->events($order, 'ride_cancellation_penalty_assessed'));
        $this->assertTrue(ActivityLog::where('action', 'ride.cancellation_penalty_assessed')->exists());

        // The waiting fee stays separate: none on a cancellation.
        $this->assertSame(0, RideAdditionalCharge::count());
        // The penalty never touches the cancelled ride's amounts.
        $this->assertSame((float) $order->total, (float) $order->fresh()->total);

        // The tourist sees it.
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")->assertOk()
            ->assertJsonPath('data.cancellation_penalty.amount', 50)
            ->assertJsonPath('data.cancellation_penalty.status', 'owed')
            ->assertJsonPath('data.cancellation_penalty.rider_name', 'Aldrin Robledo');
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/transport/penalties')->assertOk()
            ->assertJsonPath('data.outstanding_total', 50);
    }

    public function test_without_a_confirmed_arrival_the_penalty_is_still_owed_with_the_gps_kept_as_evidence(): void
    {
        // Stage C2 (2026-11-18): no arrival confirmation or GPS progress is required.
        $order = $this->ride();
        $this->fix(12.52, 121.31, $this->t0->addSeconds(60));
        $this->fix(12.515, 121.31, $this->t0->addSeconds(380));
        $this->cancelAt($order, 400)->assertOk();

        $penalty = RideCancellationPenalty::sole();
        $this->assertSame(RideCancellationPenalty::STATUS_OWED, $penalty->status);
        $this->assertSame([], $penalty->review_reasons);
        // Recorded for reference only.
        $this->assertSame(2, $penalty->evidence['fixes_since_acceptance']);
        $this->assertNull($penalty->evidence['pickup_arrival_confirmed_at']);
        $this->assertGreaterThan($penalty->evidence['latest_fix_distance_to_pickup_m'], $penalty->evidence['first_fix_distance_to_pickup_m']);
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/transport/penalties')->assertOk()
            ->assertJsonPath('data.outstanding_total', 50);
    }

    public function test_missing_or_stale_gps_still_owes_and_is_recorded_as_evidence(): void
    {
        // Confirmed arrival, then nothing for 10 minutes.
        $order = $this->ride();
        $this->arriveAtPickup($order, 200);
        $this->cancelAt($order, 800)->assertOk();
        $penalty = RideCancellationPenalty::sole();
        $this->assertSame(RideCancellationPenalty::STATUS_OWED, $penalty->status);
        $this->assertSame(601, $penalty->evidence['latest_fix_age_s']);

        // No GPS at all since acceptance.
        RideCancellationPenalty::query()->delete();
        RiderLocation::query()->delete();
        $other = $this->ride();
        $this->cancelAt($other, 1200)->assertOk();
        $this->assertSame(RideCancellationPenalty::STATUS_OWED, RideCancellationPenalty::sole()->status);
        $this->assertSame(0, RideCancellationPenalty::sole()->evidence['fixes_since_acceptance']);
    }

    public function test_the_database_allows_only_one_penalty_per_cancelled_ride(): void
    {
        $order = $this->ride();
        $this->cancelAt($order, 600)->assertOk();
        $existing = RideCancellationPenalty::sole();

        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);
        RideCancellationPenalty::create([
            'cancelled_order_id' => $existing->cancelled_order_id, 'delivery_id' => $existing->delivery_id, 'tourist_id' => $existing->tourist_id,
            'compensated_rider_id' => $existing->compensated_rider_id, 'penalty_amount' => 50, 'seconds_after_acceptance' => 600, 'status' => 'owed',
        ]);
    }

    public function test_a_rider_cancellation_is_never_penalised(): void
    {
        $order = $this->ride();
        $this->travelTo($this->t0->addMinutes(20));
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$this->delivery($order)->id}/cancel-ride", ['reason' => 'vehicle_breakdown'])->assertOk();
        $this->assertSame('cancelled', $order->fresh()->status);
        $this->assertSame(0, RideCancellationPenalty::count());
    }

    public function test_one_penalty_per_cancelled_ride(): void
    {
        $order = $this->ride();
        $this->cancelAt($order, 600)->assertOk();
        $this->cancelAt($order, 700)->assertStatus(422); // already cancelled
        $this->assertSame(1, RideCancellationPenalty::count());
    }

    public function test_the_tourist_sees_until_when_cancelling_is_free(): void
    {
        $order = $this->ride();
        $this->travelTo($this->t0->addSeconds(120));
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")->assertOk()
            ->assertJsonPath('data.cancellation_penalty_preview.applies_now', false)
            ->assertJsonPath('data.cancellation_penalty_preview.free_until', $this->t0->addSeconds(300)->toIso8601String());
        $this->travelTo($this->t0->addSeconds(301));
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")->assertOk()
            ->assertJsonPath('data.cancellation_penalty_preview.applies_now', true)
            ->assertJsonPath('data.cancellation_penalty_preview.amount', 50);
    }

    public function test_there_is_no_dispute_and_reviewed_penalties_become_owed(): void
    {
        $order = $this->ride();
        $this->arriveAtPickup($order, 240);
        $this->fix(self::PICKUP[0], self::PICKUP[1], $this->t0->addSeconds(410));
        $this->cancelAt($order, 420)->assertOk();

        // Owner decision 2026-11-23: no dispute endpoint, no Tourism Office review.
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/penalty/dispute", ['reason' => 'The driver was going the wrong way.'])
            ->assertNotFound();

        // Older penalties left under review / disputed are made owed, once, in the ledger.
        RideCancellationPenalty::query()->update(['status' => RideCancellationPenalty::STATUS_DISPUTED]);
        $this->assertSame(1, app(\App\Services\RideCancellationPenaltyService::class)->oweReviewed());
        $this->assertSame(0, app(\App\Services\RideCancellationPenaltyService::class)->oweReviewed());
        $this->assertSame(RideCancellationPenalty::STATUS_OWED, RideCancellationPenalty::sole()->status);
        $this->assertCount(1, $this->events($order, 'ride_cancellation_penalty_now_owed'));
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/transport/penalties')->assertOk()->assertJsonPath('data.outstanding_total', 50);
    }
    public function test_an_outstanding_penalty_never_blocks_food_ordering_or_a_new_ride(): void
    {
        $order = $this->ride();
        $this->arriveAtPickup($order, 240);
        $this->fix(self::PICKUP[0], self::PICKUP[1], $this->t0->addSeconds(410));
        $this->cancelAt($order, 420)->assertOk();
        $this->assertSame(RideCancellationPenalty::STATUS_OWED, RideCancellationPenalty::sole()->status);

        // Booking another ride still works in Stage B (collection with it comes in Stage C).
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/transport/book', [
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ])->assertCreated();
    }
}
