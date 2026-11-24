<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RideCancellationPenalty;
use App\Models\RiderCancellationCompensation as Comp;
use App\Models\RiderCompensationEntry;
use App\Models\RiderCompensationPayout as CompPayout;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\RiderPayoutValidation;
use App\Models\User;
use App\Services\RideCompensationService;
use App\Services\TransportationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Concerns\MakesVerifiedEarnings;
use Tests\TestCase;

/**
 * Stage D2 (docs/secure-transaction-audit.md §P.5/§P.6): the original rider's
 * cancellation compensation is paid inside the rider's payout. One office
 * action handles the existing earnings cashout (unchanged rules) and the
 * linked compensation payout (own validator) in ONE transaction; either part
 * refusing changes neither. One GCash transfer = earnings + compensation.
 */
class PayoutStatementTest extends TestCase
{
    use MakesVerifiedEarnings;
    use RefreshDatabase;

    private User $rider;

    private User $tourist;

    private User $staffA;

    private User $staffB;

    private Business $business;

    private int $minutesAgo = 300;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Http::fake();
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@stmt.test', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@stmt.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->staffA = User::create(['name' => 'Staff A', 'email' => 'a@stmt.test', 'password' => Hash::make('StaffA-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $this->staffB = User::create(['name' => 'Staff B', 'email' => 'b@stmt.test', 'password' => Hash::make('StaffB-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $owner = User::create(['email' => 'owner@stmt.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Ekslusibo Grill', 'status' => 'approved',
        ]);
    }

    /** A verified online delivery earning of $amount (normal earnings). */
    private function earning(float $amount = 60): RiderEarning
    {
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)), 'business_id' => $this->business->id,
            'customer_name' => 'Jayvie De Torres', 'customer_email' => 'tourist@stmt.test', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'pending', 'status' => 'completed',
            'subtotal' => 300, 'delivery_fee' => $amount, 'rider_tip' => 0, 'system_fee' => 0, 'rider_financed_amount' => 300, 'total' => 300 + $amount,
        ]);
        $this->verifyEarningSource($order, $this->rider->id);

        return RiderEarning::create([
            'rider_id' => $this->rider->id, 'order_id' => $order->id, 'delivery_fee' => $amount, 'rider_tip' => 0,
            'total_earning' => $amount, 'status' => 'earned', 'earned_at' => now()->subMinutes($this->minutesAgo--),
        ]);
    }

    /** A cancelled ride the rider accepted, whose ₱50 penalty the tourist paid (or the office advanced). */
    private function compensation(bool $advance = false): Comp
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ]);
        // Through the models (as the accept / cancel flows do), so the tamper-evident
        // history records the rider assignment and the cancellation.
        Delivery::where('order_id', $order->id)->sole()->update(['rider_id' => $this->rider->id, 'status' => 'assigned', 'assigned_at' => now()->subMinutes(10)]);
        $order->update(['status' => 'cancelled', 'cancelled_at' => now()]);
        Delivery::where('order_id', $order->id)->sole()->update(['status' => 'cancelled']);
        $penalty = RideCancellationPenalty::create([
            'cancelled_order_id' => $order->id, 'delivery_id' => Delivery::where('order_id', $order->id)->value('id'), 'tourist_id' => $this->tourist->id,
            'compensated_rider_id' => $this->rider->id, 'penalty_amount' => 50, 'seconds_after_acceptance' => 600, 'status' => 'owed',
        ]);
        if ($advance) {
            return app(RideCompensationService::class)->advance($penalty, $this->staffA, 'Rider waited 20 minutes.', 'ADV-'.$penalty->id);
        }
        $penalty->forceFill(['status' => 'collected', 'collection_method' => 'online', 'collected_at' => now(), 'received_amount' => 50, 'received_at' => now()])->save();

        return DB::transaction(fn () => app(RideCompensationService::class)->onReceived($penalty->fresh()));
    }

    private function request()
    {
        return $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/payouts/request', ['gcash_number' => '09171234567', 'account_name' => 'Aldrin Robledo']);
    }

    private function approve(int $id, ?User $as = null)
    {
        return $this->actingAs($as ?? $this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'StaffA-pass1']);
    }

    private function evidence(float $amount, string $password, string $ref = '5012345678901'): array
    {
        return ['password' => $password, 'reference' => $ref, 'amount' => $amount, 'recipient_number' => '09171234567', 'recipient_name' => 'Aldrin Robledo',
            'paid_at' => now()->subMinute()->toDateTimeString(), 'proof' => UploadedFile::fake()->image('gcash.jpg')];
    }

    private function pay(int $id, float $amount, ?User $as = null, string $ref = '5012345678901')
    {
        $as ??= $this->staffB;

        return $this->actingAs($as, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($amount, $as === $this->staffA ? 'StaffA-pass1' : 'StaffB-pass1', $ref), ['Accept' => 'application/json']);
    }

    private function compPaid(Comp $c): float
    {
        return round((float) RiderCompensationEntry::where('compensation_id', $c->id)->where('bucket', 'paid')->sum('amount'), 2);
    }

    /* ── Together with earnings ─────────────────────────────────────── */

    public function test_one_request_one_approval_and_one_transfer_pay_earnings_and_compensation(): void
    {
        $this->earning(60);
        $comp = $this->compensation();

        $id = $this->request()->assertCreated()->assertJsonPath('data.total', 110)->json('data.id');
        $earnings = RiderPayout::find($id);
        $this->assertEquals(60.0, (float) $earnings->amount, 'The earnings cashout keeps its own amount.');
        $cp = CompPayout::sole();
        $this->assertSame($earnings->id, (int) $cp->rider_payout_id);
        $this->assertEquals(50.0, $cp->amount);
        $this->assertSame('reserved', $comp->fresh()->status);

        $this->approve($id)->assertOk()->assertJsonPath('data.compensation_payout.status', 'approved')->assertJsonPath('data.transfer_total', 110);
        $this->assertSame('approved', $earnings->fresh()->status);

        // The transfer must be the total.
        $this->pay($id, 60)->assertStatus(409);
        $this->assertSame('approved', $earnings->fresh()->status);
        $this->assertSame('approved', $cp->fresh()->status);

        $this->pay($id, 110)->assertOk()->assertJsonPath('data.compensation_payout.status', 'paid');
        $this->assertSame('paid', $earnings->fresh()->status);
        $this->assertEquals(60.0, (float) $earnings->fresh()->paid_amount);
        $this->assertSame('paid', $cp->fresh()->status);
        $this->assertEquals(110.0, $cp->fresh()->transferred_total);
        $this->assertSame($earnings->fresh()->payment_reference, $cp->fresh()->payment_reference);
        $this->assertSame('paid', $comp->fresh()->status);
        $this->assertEquals(50.0, $this->compPaid($comp));

        // A repeated payment click never pays the compensation twice.
        $this->pay($id, 110)->assertStatus(409);
        $this->assertEquals(50.0, $this->compPaid($comp));
        $this->assertSame(['request:pass', 'approve:pass', 'pay:pass'], RiderPayoutValidation::where('rider_payout_id', $id)->orderBy('id')->get()->map(fn ($v) => "{$v->context}:{$v->result}")->all());
    }

    public function test_if_the_compensation_part_is_refused_nothing_is_approved(): void
    {
        $this->earning(60);
        $comp = $this->compensation();
        $id = $this->request()->assertCreated()->json('data.id');
        // The tourist's payment is refunded meanwhile: the compensation is voided.
        app(\App\Services\RideCancellationPenaltyService::class)->recordRefund(RideCancellationPenalty::find($comp->penalty_id), $this->staffA, 'REF-9', 'Charged by mistake.');
        $this->assertSame('voided', $comp->fresh()->status);

        $this->approve($id)->assertStatus(409);
        $this->assertSame('pending', RiderPayout::find($id)->status, 'The earnings part is not approved either.');
        $this->assertSame('pending', CompPayout::sole()->status);
        $this->assertSame(['request:pass'], RiderPayoutValidation::where('rider_payout_id', $id)->pluck('context')->map(fn ($c) => "{$c}:pass")->all());
    }

    public function test_if_the_earnings_part_is_refused_nothing_is_approved_and_the_refusal_is_recorded(): void
    {
        $earning = $this->earning(60);
        $this->compensation();
        $id = $this->request()->assertCreated()->json('data.id');
        DB::table('rider_earnings')->where('id', $earning->id)->update(['total_earning' => 600]); // tampered

        $this->approve($id)->assertStatus(409);
        $this->assertSame('pending', RiderPayout::find($id)->status);
        $this->assertSame('pending', CompPayout::sole()->status);
        $this->assertSame(['request:pass', 'approve:block'], RiderPayoutValidation::where('rider_payout_id', $id)->orderBy('id')->get()->map(fn ($v) => "{$v->context}:{$v->result}")->all(),
            'The refused attempt is stored, as without compensation.');
    }

    public function test_reject_fail_and_cancel_release_the_compensation_so_it_can_be_requested_again(): void
    {
        $this->earning(60);
        $comp = $this->compensation();

        $id = $this->request()->json('data.id');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/reject", ['reason' => 'Wrong GCash name.'])->assertOk();
        $this->assertSame('rejected', CompPayout::where('rider_payout_id', $id)->sole()->status);
        $this->assertSame('payable', $comp->fresh()->status);

        $id = $this->request()->assertCreated()->json('data.id');
        $this->approve($id)->assertOk();
        $this->actingAs($this->staffB, 'sanctum')->postJson("/api/admin/payouts/{$id}/mark-failed", ['password' => 'StaffB-pass1', 'reason' => 'GCash transfer bounced.'])->assertOk();
        $this->assertSame('failed', CompPayout::where('rider_payout_id', $id)->sole()->status);
        $this->assertSame('payable', $comp->fresh()->status);

        $id = $this->request()->assertCreated()->json('data.id');
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/payouts/{$id}/cancel")->assertOk();
        $this->assertSame('cancelled', CompPayout::where('rider_payout_id', $id)->sole()->status);
        $this->assertSame('payable', $comp->fresh()->status);
        $this->assertEquals(0.0, $this->compPaid($comp));
        // Reserved and released three times: net nothing reserved.
        $this->assertEquals(0.0, round((float) RiderCompensationEntry::where('compensation_id', $comp->id)->where('bucket', 'reserved')->sum('amount'), 2));
    }

    public function test_the_two_person_rule_applies_to_the_combined_total(): void
    {
        config(['payouts.two_person_threshold' => 100]); // earnings ₱60 alone are below; with ₱50 compensation the total is ₱110
        $this->earning(60);
        $this->compensation();
        $id = $this->request()->json('data.id');
        $this->approve($id)->assertOk();

        $this->pay($id, 110, $this->staffA)->assertStatus(409)->assertJsonFragment(['message' => 'This payout is ₱100 or more: another staff member must confirm the payment.']);
        $this->pay($id, 110, $this->staffB)->assertOk();
    }

    /* ── Compensation only ──────────────────────────────────────────── */

    public function test_a_rider_with_only_compensation_can_be_paid(): void
    {
        $comp = $this->compensation();
        $this->request()->assertCreated()->assertJsonPath('data.id', null)->assertJsonPath('data.total', 50);
        $cp = CompPayout::sole();
        $this->assertNull($cp->rider_payout_id);

        $as = $this->actingAs($this->staffA, 'sanctum');
        $as->getJson("/api/admin/compensation-payouts/{$cp->id}")->assertOk()->assertJsonPath('data.validation.result', 'pass');
        $as->postJson("/api/admin/compensation-payouts/{$cp->id}/approve")->assertStatus(422); // password required, as for cashouts
        $as->postJson("/api/admin/compensation-payouts/{$cp->id}/approve", ['password' => 'wrong'])->assertStatus(422);
        $as->postJson("/api/admin/compensation-payouts/{$cp->id}/approve", ['password' => 'StaffA-pass1'])->assertOk()->assertJsonPath('data.status', 'approved');
        $as->post("/api/admin/compensation-payouts/{$cp->id}/mark-paid", $this->evidence(40, 'StaffA-pass1', 'CPREF-1'), ['Accept' => 'application/json'])->assertStatus(409);
        $as->post("/api/admin/compensation-payouts/{$cp->id}/mark-paid", $this->evidence(50, 'StaffA-pass1', 'CPREF-1'), ['Accept' => 'application/json'])->assertOk()->assertJsonPath('data.status', 'paid');
        $as->post("/api/admin/compensation-payouts/{$cp->id}/mark-paid", $this->evidence(50, 'StaffA-pass1', 'CPREF-1'), ['Accept' => 'application/json'])->assertOk(); // repeat-safe
        $this->assertSame('paid', $comp->fresh()->status);
        $this->assertEquals(50.0, $this->compPaid($comp));
        $this->assertSame(0, RiderPayout::count(), 'No earnings cashout was needed.');
    }

    public function test_a_linked_compensation_is_only_handled_through_its_cashout(): void
    {
        $this->earning(60);
        $this->compensation();
        $this->request()->assertCreated();
        $cp = CompPayout::sole();
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/compensation-payouts/{$cp->id}/approve", ['password' => 'StaffA-pass1'])->assertStatus(409);
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/compensation-payouts/{$cp->id}/cancel")->assertStatus(409);
        $this->assertSame('pending', $cp->fresh()->status);
    }

    public function test_a_waiver_during_payout_voids_it_and_blocks_payment(): void
    {
        $this->earning(60);
        $comp = $this->compensation(advance: true);
        $id = $this->request()->json('data.id');
        $this->assertSame('reserved', $comp->fresh()->status);

        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/ride-penalties/{$comp->penalty_id}/waive", ['reason' => 'Driver was at the wrong pickup.'])->assertOk();
        $this->assertSame('voided', $comp->fresh()->status);
        $this->approve($id)->assertStatus(409);
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/reject", ['reason' => 'Compensation was voided.'])->assertOk();
        $this->assertSame('voided', $comp->fresh()->status, 'Stays voided; released only once.');
        $this->assertEquals(0.0, round((float) RiderCompensationEntry::where('compensation_id', $comp->id)->where('bucket', 'reserved')->sum('amount'), 2));
        $this->assertEquals(0.0, app(\App\Services\RideCompensationLedger::class)->earned($comp->id));
    }

    public function test_one_live_request_per_rider_and_a_compensation_is_never_in_two_payouts(): void
    {
        $this->compensation();
        $this->request()->assertCreated();
        $this->request()->assertStatus(409);
        $this->assertSame(1, CompPayout::count());
        $this->assertSame(1, \App\Models\RiderCompensationPayoutItem::count());
    }

    /* ── Statement ─────────────────────────────────────────────────── */

    public function test_the_statement_separates_earnings_and_compensation_and_tracks_payment(): void
    {
        $this->earning(60);
        $this->compensation();
        $stmt = $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/earnings-statement')->assertOk();
        $stmt->assertJsonPath('data.lines.delivery_earnings', 60)
            ->assertJsonPath('data.lines.ride_earnings', 0)
            ->assertJsonPath('data.lines.cancellation_compensation', 50)
            ->assertJsonPath('data.total_earned', 110)
            ->assertJsonPath('data.total_payable_now', 110)
            ->assertJsonPath('data.previously_paid', 0)
            ->assertJsonPath('data.remaining_balance', 110)
            ->assertJsonPath('data.compensations.0.status', 'payable');

        $id = $this->request()->json('data.id');
        $this->approve($id)->assertOk();
        $this->pay($id, 110)->assertOk();

        $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/riders/{$this->rider->id}/statement")->assertOk()
            ->assertJsonPath('data.previously_paid', 110)
            ->assertJsonPath('data.paid.cancellation_compensation', 50)
            ->assertJsonPath('data.remaining_balance', 0)
            ->assertJsonPath('data.total_payable_now', 0)
            ->assertJsonPath('data.compensations.0.status', 'paid');
        $this->actingAs($this->rider, 'sanctum')->getJson("/api/admin/riders/{$this->rider->id}/statement")->assertForbidden();
    }
}
