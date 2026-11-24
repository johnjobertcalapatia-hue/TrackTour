<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RideCancellationPenalty;
use App\Models\RiderCancellationCompensation as Comp;
use App\Models\RiderCompensationEntry;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\Integrity\TransactionIntegrityService;
use App\Services\RideCompensationLedger;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Stage D1 (docs/secure-transaction-audit.md §P): the ₱50 compensation of the
 * rider who ACCEPTED a cancelled booking — created exactly once when the full
 * penalty is received (PayMongo-verified, or staff-confirmed cash receipt), or
 * by an approved advance; never owned by the rider who collects the cash;
 * voided / written off on waiver or refund; held on dispute; append-only.
 */
class RideCompensationTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $riderA; // accepted the cancelled ride: owns the compensation

    private User $riderB; // drives the tourist later and collects cash

    private User $admin;

    private User $admin2;

    private CarbonImmutable $t0;

    private \Closure $http;

    protected function setUp(): void
    {
        parent::setUp();
        $this->http = fn () => Http::response([], 200);
        Http::fake(fn ($request) => ($this->http)($request));
        Cache::flush();
        config(['services.paymongo.secret_key' => 'sk_test_d1', 'services.paymongo.webhook_secret' => '']);
        $this->t0 = CarbonImmutable::parse('2026-11-18 10:00:00');
        $this->travelTo($this->t0);
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@d1.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->riderA = $this->rider('a@d1.test', 'Aldrin Robledo');
        $this->riderB = $this->rider('b@d1.test', 'Ben Santos');
        $this->admin = User::create(['name' => 'Office One', 'email' => 'one@d1.test', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $this->admin2 = User::create(['name' => 'Office Two', 'email' => 'two@d1.test', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
    }

    private function rider(string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $u->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle']);

        return $u;
    }

    private function ride(User $rider, string $status = 'assigned'): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update(['rider_id' => $rider->id, 'status' => $status, 'assigned_at' => now()]);
        $order->update(['status' => 'confirmed']);

        return $order->fresh();
    }

    /** Rider A accepts, the tourist cancels 10 min later: an owed ₱50 penalty. */
    private function owedPenalty(): RideCancellationPenalty
    {
        $order = $this->ride($this->riderA);
        $this->travelTo(now()->addMinutes(10));
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/cancel", ['reason' => 'changed_plans'])->assertOk();

        return RideCancellationPenalty::where('cancelled_order_id', $order->id)->sole();
    }

    /** Rider B collects the tourist's owed fee in cash at a later drop-off. */
    private function collectCashBy(User $rider, RideCancellationPenalty $penalty): void
    {
        $next = $this->ride($rider, 'arrived_destination');
        $delivery = Delivery::where('order_id', $next->id)->sole();
        $this->actingAs($rider, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/cancellation-fee/collect", ['penalty_id' => $penalty->id])->assertOk();
        // That ride ends (the tourist may book again).
        $next->update(['status' => 'completed']);
        Delivery::where('order_id', $next->id)->update(['status' => 'completed']);
    }

    private function payOnline(RideCancellationPenalty $penalty, string $event = 'evt_d1'): void
    {
        $this->http = fn ($request) => str_contains($request->url(), 'checkout_sessions')
            ? Http::response(['data' => ['id' => 'cs_d1_'.$penalty->id, 'attributes' => ['status' => 'active', 'checkout_url' => 'https://checkout.paymongo.com/x']]], 200)
            : Http::response([], 200);
        if (! Payment::where('payable_id', $penalty->id)->where('payable_type', RideCancellationPenalty::class)->exists()) {
            $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'ride_penalty', 'payable_id' => $penalty->id, 'method' => 'gcash'])->assertOk();
        }
        $this->postJson('/api/payments/webhook', ['data' => ['id' => $event, 'attributes' => ['type' => 'checkout_session.completed', 'data' => ['id' => 'cs_d1_'.$penalty->id, 'status' => 'completed']]]])->assertOk();
    }

    private function receipt(array $body, ?User $as = null)
    {
        return $this->actingAs($as ?? $this->admin, 'sanctum')->postJson('/api/admin/ride-penalties/cash-receipts', $body);
    }

    private function earned(int $riderId): float
    {
        return app(RideCompensationLedger::class)->riderTotals($riderId)['earned'];
    }

    private function events(int $orderId, string $type): int
    {
        return TransactionEvent::query()->whereHas('blueprint', fn ($q) => $q->where('order_id', $orderId))->where('event_type', $type)->count();
    }

    /* ── Online ─────────────────────────────────────────────────────── */

    public function test_a_verified_online_payment_credits_the_original_rider_exactly_once(): void
    {
        $penalty = $this->owedPenalty();
        $this->assertSame(0, Comp::count(), 'Nothing is owed to the rider before the tourist pays.');

        $this->payOnline($penalty, 'evt_1');
        $this->payOnline($penalty, 'evt_2'); // duplicate notice

        $penalty->refresh();
        $this->assertEquals(50.0, $penalty->received_amount);
        $this->assertNotNull($penalty->received_at);
        $comp = Comp::sole();
        $this->assertSame($this->riderA->id, (int) $comp->rider_id, 'Owned by the rider who accepted the cancelled ride.');
        $this->assertSame('collection', $comp->funding);
        $this->assertSame('payable', $comp->status);
        $this->assertSame(1, RiderCompensationEntry::count());
        $this->assertEquals(50.0, $this->earned($this->riderA->id));
        $this->assertSame(1, $this->events($penalty->cancelled_order_id, 'ride_compensation_earned'));
        // Normal earnings are untouched: nothing is written to rider_earnings.
        $this->assertSame(0, RiderEarning::count());
    }

    /* ── Cash: receipt confirmed by staff ───────────────────────────── */

    public function test_cash_counts_only_after_the_office_confirms_receipt_and_never_belongs_to_the_collector(): void
    {
        $penalty = $this->owedPenalty();
        $this->collectCashBy($this->riderB, $penalty);

        $this->assertSame('collected', $penalty->fresh()->status);
        $this->assertNull($penalty->fresh()->received_at);
        $this->assertSame(0, Comp::count(), 'Cash in the collecting rider\'s hands is not yet received.');
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/ride-penalties/cash-to-receive')->assertOk()
            ->assertJsonPath('data.riders.0.rider_id', $this->riderB->id)
            ->assertJsonPath('data.riders.0.outstanding', 50);

        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => '', 'received_amount' => 50, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 50]]])->assertStatus(422);
        $this->receipt(['collecting_rider_id' => $this->riderA->id, 'receipt_number' => 'R-1', 'received_amount' => 50, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 50]]])
            ->assertStatus(422); // not collected by rider A
        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-1', 'received_amount' => 60, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 50]]])
            ->assertStatus(422); // lines must add up
        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-1', 'received_amount' => 60, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 60]]])
            ->assertStatus(422); // more than outstanding

        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-1001', 'received_amount' => 50, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 50]]])->assertCreated();
        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-1001', 'received_amount' => 50, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 50]]])
            ->assertStatus(409); // receipt numbers are unique (and the fee is received)

        $comp = Comp::sole();
        $this->assertSame($this->riderA->id, (int) $comp->rider_id);
        $this->assertSame(0.0, $this->earned($this->riderB->id), 'The collecting rider earns nothing from it.');
        $this->assertSame($this->admin->id, (int) $penalty->fresh()->received_by);
    }

    public function test_a_partial_remittance_is_allocated_per_fee_and_never_triggers_full_compensation(): void
    {
        $fees = [];
        foreach (range(1, 3) as $i) {
            $fees[] = $p = $this->owedPenalty();
            $this->collectCashBy($this->riderB, $p);
        }

        // B remits ₱100 of ₱150: two fees fully received, the third stays outstanding.
        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-2001', 'received_amount' => 100,
            'allocations' => [['penalty_id' => $fees[0]->id, 'amount' => 50], ['penalty_id' => $fees[1]->id, 'amount' => 50]]])->assertCreated();
        $this->assertSame(2, Comp::count());

        // ₱20 more on the third: still not fully received → no compensation.
        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-2002', 'received_amount' => 20,
            'allocations' => [['penalty_id' => $fees[2]->id, 'amount' => 20]]])->assertCreated();
        $this->assertEquals(20.0, $fees[2]->fresh()->received_amount);
        $this->assertNull($fees[2]->fresh()->received_at);
        $this->assertSame(2, Comp::count());
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/ride-penalties/cash-to-receive')
            ->assertJsonPath('data.riders.0.outstanding', 30);

        // The last ₱30: received in full → the third compensation.
        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-2003', 'received_amount' => 30,
            'allocations' => [['penalty_id' => $fees[2]->id, 'amount' => 30]]])->assertCreated();
        $this->assertSame(3, Comp::where('rider_id', $this->riderA->id)->count());
        $this->assertEquals(150.0, $this->earned($this->riderA->id));
    }

    /* ── Advance ────────────────────────────────────────────────────── */

    public function test_an_advance_is_recovered_when_the_tourist_pays_and_never_credited_twice(): void
    {
        $penalty = $this->owedPenalty();
        $as = $this->actingAs($this->admin, 'sanctum');
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'ok', 'reference' => 'ADV-1'])->assertStatus(422);
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Rider waited 20 minutes in the rain.'])->assertStatus(422); // reference required
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Rider waited 20 minutes in the rain.', 'reference' => 'ADV-1'])
            ->assertCreated()->assertJsonPath('data.funding', 'advance')->assertJsonPath('data.status', 'payable');
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Twice by mistake.', 'reference' => 'ADV-2'])->assertStatus(409);
        $this->assertEquals(50.0, $this->earned($this->riderA->id));

        $this->payOnline($penalty);

        $comp = Comp::sole();
        $this->assertNotNull($comp->recovered_at);
        $this->assertSame('advance', $comp->funding);
        $this->assertEquals(50.0, $this->earned($this->riderA->id), 'No second credit.');
        $this->assertSame(1, RiderCompensationEntry::where('entry_type', 'advance_recovered')->where('bucket', 'office')->count());
        $this->assertSame(1, $this->events($penalty->cancelled_order_id, 'ride_compensation_advance_recovered'));
    }

    public function test_an_advance_recovered_through_a_cash_receipt(): void
    {
        $penalty = $this->owedPenalty();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Rider waited 20 minutes.', 'reference' => 'ADV-3'])->assertCreated();
        $this->collectCashBy($this->riderB, $penalty);
        $this->assertNull(Comp::sole()->recovered_at, 'Not recovered until the office has the cash.');

        $this->receipt(['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'R-3001', 'received_amount' => 50, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 50]]])->assertCreated();
        $this->assertNotNull(Comp::sole()->recovered_at);
        $this->assertEquals(50.0, $this->earned($this->riderA->id));
        $this->assertSame(1, Comp::count());
    }

    public function test_a_large_advance_needs_a_second_staff_member(): void
    {
        config(['payouts.two_person_threshold' => 50]); // ₱50 now reaches it
        $penalty = $this->owedPenalty();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Rider waited 20 minutes.', 'reference' => 'ADV-4'])
            ->assertCreated()->assertJsonPath('data.status', 'pending_approval');
        $comp = Comp::sole();
        $this->assertEquals(0.0, $this->earned($this->riderA->id), 'Not credited before the second approval.');

        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-compensations/{$comp->id}/approve-advance")->assertStatus(422); // same person
        $this->actingAs($this->admin2, 'sanctum')->postJson("/api/admin/ride-compensations/{$comp->id}/approve-advance")->assertOk()->assertJsonPath('data.status', 'payable');
        $this->actingAs($this->admin2, 'sanctum')->postJson("/api/admin/ride-compensations/{$comp->id}/approve-advance")->assertOk(); // repeat-safe
        $this->assertEquals(50.0, $this->earned($this->riderA->id));
        $this->assertSame($this->admin2->id, (int) $comp->fresh()->advance_approved_by);
    }

    public function test_the_tourist_paying_before_a_pending_advance_is_approved_credits_once(): void
    {
        config(['payouts.two_person_threshold' => 50]);
        $penalty = $this->owedPenalty();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Rider waited 20 minutes.', 'reference' => 'ADV-5'])->assertCreated();
        $this->payOnline($penalty);

        $comp = Comp::sole();
        $this->assertSame('collection', $comp->funding);
        $this->assertSame('payable', $comp->status);
        $this->actingAs($this->admin2, 'sanctum')->postJson("/api/admin/ride-compensations/{$comp->id}/approve-advance")->assertOk();
        $this->assertEquals(50.0, $this->earned($this->riderA->id));
        $this->assertSame(1, RiderCompensationEntry::where('bucket', 'earned')->count());
    }

    /* ── Waiver, refund, dispute ────────────────────────────────────── */

    public function test_waiving_voids_an_unpaid_advance_and_writes_off_a_paid_one(): void
    {
        $unpaid = $this->owedPenalty();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$unpaid->id}/advance", ['reason' => 'Rider waited 20 minutes.', 'reference' => 'ADV-6'])->assertCreated();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$unpaid->id}/waive", ['reason' => 'Driver was at the wrong pickup.'])->assertOk();
        $this->assertSame('voided', Comp::where('penalty_id', $unpaid->id)->sole()->status);
        $this->assertEquals(0.0, $this->earned($this->riderA->id), 'Voided: +50 then −50.');

        $paid = $this->owedPenalty();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$paid->id}/advance", ['reason' => 'Rider waited 20 minutes.', 'reference' => 'ADV-7'])->assertCreated();
        Comp::where('penalty_id', $paid->id)->update(['status' => 'paid']); // paid out (D2 payouts)
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$paid->id}/waive", ['reason' => 'Goodwill for a long wait.'])->assertOk();
        $comp = Comp::where('penalty_id', $paid->id)->sole();
        $this->assertSame('written_off', $comp->status);
        $this->assertEquals(50.0, app(RideCompensationLedger::class)->earned($comp->id), 'The rider keeps a paid advance.');
        $this->assertSame(1, RiderCompensationEntry::where('compensation_id', $comp->id)->where('entry_type', 'written_off')->count());

        $none = $this->owedPenalty();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$none->id}/waive", ['reason' => 'No compensation exists yet.'])->assertOk();
        $this->assertFalse(Comp::where('penalty_id', $none->id)->exists());
    }

    public function test_a_refund_of_a_received_payment_voids_or_writes_off_the_compensation(): void
    {
        $penalty = $this->owedPenalty();
        $as = $this->actingAs($this->admin, 'sanctum');
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/refund", ['reference' => 'REF-1', 'reason' => 'Charged by mistake.'])->assertStatus(422); // not received
        $this->payOnline($penalty);
        $as = $this->actingAs($this->admin, 'sanctum'); // payOnline signed in as the tourist
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/refund", ['reason' => 'Charged by mistake.'])->assertStatus(422); // reference required
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/refund", ['reference' => 'REF-1', 'reason' => 'Charged by mistake.'])->assertOk()
            ->assertJsonPath('data.status', 'refunded')->assertJsonPath('data.refund_reference', 'REF-1');
        $this->assertSame('voided', Comp::sole()->status);
        $this->assertEquals(0.0, $this->earned($this->riderA->id));
        $as->postJson("/api/admin/ride-penalties/{$penalty->id}/waive", ['reason' => 'Cannot waive a refund.'])->assertStatus(422);

        $second = $this->owedPenalty();
        $this->payOnline($second, 'evt_second');
        Comp::where('penalty_id', $second->id)->update(['status' => 'paid']);
        $as = $this->actingAs($this->admin, 'sanctum');
        $as->postJson("/api/admin/ride-penalties/{$second->id}/refund", ['reference' => 'REF-2', 'reason' => 'Driver misconduct.'])->assertOk();
        $this->assertSame('written_off', Comp::where('penalty_id', $second->id)->sole()->status);
    }

    public function test_a_held_compensation_is_released_when_its_fee_becomes_owed_again(): void
    {
        $penalty = $this->owedPenalty();
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Rider waited 20 minutes.', 'reference' => 'ADV-8'])->assertCreated();
        // An older dispute held it (disputes no longer exist, 2026-11-23).
        $penalty->forceFill(['status' => RideCancellationPenalty::STATUS_DISPUTED])->save();
        Comp::query()->update(['status' => 'held']);

        app(\App\Services\RideCancellationPenaltyService::class)->oweReviewed();

        $this->assertSame(RideCancellationPenalty::STATUS_OWED, $penalty->fresh()->status);
        $this->assertSame('payable', Comp::sole()->status);
    }

    /* ── Integrity, authorization, history ──────────────────────────── */

    public function test_the_compensation_ledger_is_append_only(): void
    {
        $penalty = $this->owedPenalty();
        $this->payOnline($penalty);
        $entry = RiderCompensationEntry::sole();

        try {
            $entry->update(['amount' => 500]);
            $this->fail('An entry could be edited.');
        } catch (QueryException) {
        }
        try {
            $entry->delete();
            $this->fail('An entry could be deleted.');
        } catch (QueryException) {
        }
        $this->assertEquals(50.0, RiderCompensationEntry::sole()->amount);
    }

    public function test_compensation_events_do_not_change_the_cancelled_ride_integrity_verdict(): void
    {
        $penalty = $this->owedPenalty();
        $order = Order::find($penalty->cancelled_order_id);
        $before = app(TransactionIntegrityService::class)->verifyOrder($order)['result'];

        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Rider waited 20 minutes.', 'reference' => 'ADV-9'])->assertCreated();
        $this->payOnline($penalty);

        $this->assertSame($before, app(TransactionIntegrityService::class)->verifyOrder($order->fresh())['result']);
    }

    public function test_only_the_bansud_tourism_office_can_receive_advance_or_refund(): void
    {
        $penalty = $this->owedPenalty();
        $municipality = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $municipal = User::create(['name' => 'Gloria Office', 'email' => 'gloria@d1.test', 'password' => Hash::make('x'), 'role' => 'tourism_office', 'account_status' => 'approved', 'municipality_id' => $municipality->id]);

        foreach ([$municipal, $this->riderA, $this->tourist] as $user) {
            $as = $this->actingAs($user, 'sanctum');
            $as->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Trying an advance.', 'reference' => 'X'])->assertForbidden();
            $as->postJson('/api/admin/ride-penalties/cash-receipts', ['collecting_rider_id' => $this->riderB->id, 'receipt_number' => 'X', 'received_amount' => 50, 'allocations' => [['penalty_id' => $penalty->id, 'amount' => 50]]])->assertForbidden();
            $as->postJson("/api/admin/ride-penalties/{$penalty->id}/refund", ['reference' => 'X', 'reason' => 'Trying a refund.'])->assertForbidden();
            $as->getJson('/api/admin/ride-penalties/cash-to-receive')->assertForbidden();
        }
        $this->assertSame(0, Comp::count());
    }

    public function test_a_historical_under_review_penalty_gets_no_compensation(): void
    {
        $penalty = $this->owedPenalty();
        RideCancellationPenalty::whereKey($penalty->id)->update(['status' => 'under_review']);
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/ride-penalties/{$penalty->id}/advance", ['reason' => 'Trying an advance.', 'reference' => 'ADV-10'])->assertStatus(422);
        $this->assertSame(0, Comp::count());
        $this->assertSame('under_review', $penalty->fresh()->status);
    }
}
