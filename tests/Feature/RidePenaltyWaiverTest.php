<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Notification;
use App\Models\Order;
use App\Models\RideCancellationPenalty;
use App\Models\RiderDetail;
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
 * Stage C2 (owner decisions 2026-11-18): every qualifying tourist cancellation
 * is owed; the Tourism Office can waive a penalty with a reason (ledger +
 * activity log, tourist notified); historical under-review penalties are kept
 * as they are; nothing is collected or paid automatically.
 */
class RidePenaltyWaiverTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private User $admin;

    private CarbonImmutable $t0;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Cache::flush();
        $this->t0 = CarbonImmutable::parse('2026-11-18 10:00:00');
        $this->travelTo($this->t0);
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@waive.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@waive.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);
        $this->admin = User::create(['name' => 'Bansud Tourism Office', 'email' => 'office@waive.test', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
    }

    /** An accepted ride the tourist cancels $seconds after acceptance. */
    private function cancelledRide(int $seconds = 600): Order
    {
        $this->travelTo($this->t0);
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update(['rider_id' => $this->rider->id, 'status' => 'assigned', 'assigned_at' => $this->t0]);
        $order->update(['status' => 'confirmed']);
        $this->travelTo($this->t0->addSeconds($seconds));
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/cancel", ['reason' => 'changed_plans'])->assertOk();

        return $order->fresh();
    }

    private function waive(RideCancellationPenalty $p, array $body = ['reason' => 'Driver reported a flat tyre; the tourist waited.'], ?User $as = null)
    {
        return $this->actingAs($as ?? $this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$p->id}/waive", $body);
    }

    public function test_the_tourism_office_waives_an_owed_penalty_with_a_reason(): void
    {
        $order = $this->cancelledRide();
        $penalty = RideCancellationPenalty::sole();
        $this->assertSame('owed', $penalty->status);

        $this->waive($penalty, [])->assertStatus(422);                       // a reason is required
        $this->waive($penalty, ['reason' => 'ok'])->assertStatus(422);       // and meaningful
        $this->waive($penalty)->assertOk()
            ->assertJsonPath('data.status', 'waived')
            ->assertJsonPath('data.waiver_reason', 'Driver reported a flat tyre; the tourist waited.')
            ->assertJsonPath('data.waived_by', 'Bansud Tourism Office')
            ->assertJsonPath('data.can_waive', false);
        $this->waive($penalty)->assertOk();                                  // repeat-safe

        $penalty->refresh();
        $this->assertSame($this->admin->id, (int) $penalty->resolved_by);
        $this->assertNotNull($penalty->resolved_at);
        // The original accepting rider and the tourist are kept.
        $this->assertSame($this->rider->id, (int) $penalty->compensated_rider_id);
        $this->assertSame($this->tourist->id, (int) $penalty->tourist_id);

        // Immutable audit: one ledger event and one activity-log entry.
        $events = TransactionEvent::query()->whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))->where('event_type', 'ride_cancellation_penalty_waived')->get();
        $this->assertCount(1, $events);
        $this->assertSame(1, ActivityLog::where('action', 'ride.cancellation_penalty_waived')->count());

        // The tourist is told, and owes nothing for it.
        $this->assertTrue(Notification::where('user_id', $this->tourist->id)->where('title', '₱50.00 cancellation fee waived')->exists());
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")
            ->assertJsonPath('data.cancellation_penalty.status', 'waived')
            ->assertJsonPath('data.cancellation_penalty.waiver_reason', 'Driver reported a flat tyre; the tourist waited.')
            ->assertJsonPath('data.cancellation_penalty.can_pay', false);
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/transport/penalties')->assertJsonPath('data.outstanding_total', 0);
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'ride_penalty', 'payable_id' => $penalty->id, 'method' => 'gcash'])
            ->assertStatus(422);
    }

    public function test_an_owed_penalty_can_be_waived_but_a_paid_one_cannot(): void
    {
        $this->cancelledRide();
        $this->waive(RideCancellationPenalty::sole())->assertOk()->assertJsonPath('data.status', 'waived');

        RideCancellationPenalty::query()->update(['status' => 'collected', 'collected_at' => now(), 'collection_method' => 'cash', 'resolved_at' => null, 'resolution_note' => null]);
        $this->waive(RideCancellationPenalty::sole())->assertStatus(422);
        $this->assertSame('collected', RideCancellationPenalty::sole()->status);
    }
    public function test_only_the_tourism_office_can_list_or_waive(): void
    {
        $this->cancelledRide();
        $penalty = RideCancellationPenalty::sole();
        $this->waive($penalty, as: $this->tourist)->assertForbidden();
        $this->waive($penalty, as: $this->rider)->assertForbidden();
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/admin/ride-penalties')->assertForbidden();
        $this->assertSame('owed', $penalty->fresh()->status);
    }

    public function test_the_office_list_shows_penalties_with_counts_and_evidence(): void
    {
        $this->cancelledRide();
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/ride-penalties')->assertOk()
            ->assertJsonPath('data.counts.owed', 1)
            ->assertJsonPath('data.penalties.0.status', 'owed')
            ->assertJsonPath('data.penalties.0.rider_name', 'Aldrin Robledo')
            ->assertJsonPath('data.penalties.0.seconds_after_acceptance', 600)
            ->assertJsonPath('data.penalties.0.evidence.fixes_since_acceptance', 0)
            ->assertJsonPath('data.penalties.0.can_waive', true);
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/ride-penalties?status=waived')->assertOk()
            ->assertJsonCount(0, 'data.penalties');
    }

    public function test_a_historical_under_review_penalty_is_kept_as_it_is(): void
    {
        // A penalty created under the earlier rule stays under review: never
        // charged or changed automatically by the new rule.
        $first = $this->cancelledRide();
        RideCancellationPenalty::query()->update(['status' => 'under_review', 'review_reasons' => ['No saved rider location since the booking was accepted.']]);
        $historical = RideCancellationPenalty::sole();

        $this->cancelledRide(900); // a new qualifying cancellation

        $this->assertSame('under_review', $historical->fresh()->status);
        $this->assertSame(['No saved rider location since the booking was accepted.'], $historical->fresh()->review_reasons);
        $this->assertSame('owed', RideCancellationPenalty::where('cancelled_order_id', '!=', $first->id)->sole()->status);
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/transport/penalties')->assertJsonPath('data.outstanding_total', 50);

        // Nothing is collected or paid automatically in this stage.
        $this->assertNull($historical->fresh()->collected_at);
        $this->assertSame(0, RideCancellationPenalty::whereNotNull('collected_at')->count());
    }
}
