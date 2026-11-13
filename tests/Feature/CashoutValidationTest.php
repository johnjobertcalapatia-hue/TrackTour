<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderEarningEntry;
use App\Models\RiderPayout;
use App\Models\RiderPayoutValidation;
use App\Models\User;
use App\Services\AcceptedOrderPolicy;
use App\Services\PaymongoService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use LogicException;
use Tests\Concerns\MakesVerifiedEarnings;
use Tests\TestCase;

/**
 * Stage 6 — every cashout is validated against the permanent earnings
 * ledger: PASS proceeds; FLAG needs a documented investigation decision;
 * BLOCK (incl. an earning missing from the ledger) stops the cashout.
 */
class CashoutValidationTest extends TestCase
{
    use MakesVerifiedEarnings;
    use RefreshDatabase;

    private User $rider;

    private User $staffA;

    private User $staffB;

    private Business $business;

    private int $minutesAgo = 100;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@validate.test', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->staffA = User::create(['name' => 'Staff A', 'email' => 'a@bansud.gov.ph', 'password' => Hash::make('StaffA-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $this->staffB = User::create(['name' => 'Staff B', 'email' => 'b@bansud.gov.ph', 'password' => Hash::make('StaffB-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $owner = User::create(['email' => 'owner@validate.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
        ]);
    }

    private function earning(float $amount = 60): RiderEarning
    {
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)), 'business_id' => $this->business->id,
            'customer_name' => 'Jayvie De Torres', 'customer_email' => 'tourist@validate.test', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'pending', 'status' => 'completed',
            'subtotal' => 300, 'delivery_fee' => $amount, 'rider_tip' => 0, 'system_fee' => 0, 'rider_financed_amount' => 300, 'total' => 300 + $amount,
        ]);
        $this->verifyEarningSource($order, $this->rider->id);

        return RiderEarning::create([
            'rider_id' => $this->rider->id, 'order_id' => $order->id, 'delivery_fee' => $amount, 'rider_tip' => 0,
            'total_earning' => $amount, 'status' => 'earned', 'earned_at' => now()->subMinutes($this->minutesAgo--),
        ]);
    }

    private function request(): int
    {
        return $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/payouts/request', [
            'gcash_number' => '09171234567', 'account_name' => 'Aldrin Robledo',
        ])->assertCreated()->json('data.id');
    }

    private function approve(int $id, ?string $note = null)
    {
        return $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", array_filter(['password' => 'StaffA-pass1', 'note' => $note]));
    }

    private function pay(int $id)
    {
        return $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", [
            'password' => 'StaffB-pass1', 'reference' => '5012345678901', 'amount' => (float) RiderPayout::find($id)->amount,
            'recipient_number' => '09171234567', 'recipient_name' => 'Aldrin Robledo', 'paid_at' => now()->subMinute()->toDateTimeString(),
            'proof' => UploadedFile::fake()->image('gcash.jpg'),
        ], ['Accept' => 'application/json']);
    }

    private function validations(int $id): array
    {
        return RiderPayoutValidation::where('rider_payout_id', $id)->orderBy('id')->get()->map(fn ($v) => "{$v->context}:{$v->result}")->all();
    }

    // ---------------- PASS ----------------

    public function test_a_clean_cashout_passes_at_request_approval_and_payment(): void
    {
        $this->earning();
        $id = $this->request();
        $this->approve($id)->assertOk();
        $this->pay($id)->assertOk();

        $this->assertSame(['request:pass', 'approve:pass', 'pay:pass'], $this->validations($id));
    }

    // ---------------- FLAG ----------------

    public function test_a_flagged_cashout_needs_a_documented_investigation_decision(): void
    {
        $earning = $this->earning();
        $id = $this->request();
        // An escalation on the order (e.g. a refused refund) flags its history.
        app(AcceptedOrderPolicy::class)->escalate(Order::find($earning->order_id), 'refund_blocked_after_acceptance', 'A refund was refused because a rider had already accepted the order.');

        $this->approve($id)->assertStatus(409)->assertJsonFragment(['message' => 'This cashout is flagged for investigation: A refund was refused because a rider had already accepted the order. Record your investigation decision in the note to approve.']);
        $this->approve($id, 'too short')->assertStatus(409);
        $this->assertSame('pending', RiderPayout::find($id)->status);

        $this->approve($id, 'Called the restaurant: food was delivered; refund correctly refused.')->assertOk();
        $decision = RiderPayoutValidation::where('rider_payout_id', $id)->where('context', 'approve')->latest('id')->first();
        $this->assertSame('flag', $decision->result);
        $this->assertSame('Called the restaurant: food was delivered; refund correctly refused.', $decision->decision_note);
    }

    // ---------------- BLOCK ----------------

    public function test_a_tampered_earning_blocks_the_cashout_and_the_attempt_is_recorded(): void
    {
        $earning = $this->earning();
        $id = $this->request();
        DB::table('rider_earnings')->where('id', $earning->id)->update(['total_earning' => 600]);

        $this->approve($id, 'Looks fine to me, approving.')->assertStatus(409);

        $this->assertSame('pending', RiderPayout::find($id)->status);
        $this->assertSame(['request:pass', 'approve:block'], $this->validations($id), 'The refused attempt is stored.');
        $failed = collect(RiderPayoutValidation::where('context', 'approve')->sole()->checks)->where('ok', false)->pluck('key')->all();
        $this->assertContains("ledger_row:{$earning->id}", $failed);
    }

    public function test_an_earning_missing_from_the_ledger_cannot_be_cashed_out(): void
    {
        $order = Order::create([
            'order_number' => 'TT-LEGACY', 'business_id' => $this->business->id, 'customer_name' => 'X', 'customer_email' => 'x@validate.test',
            'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'pending', 'status' => 'completed',
            'subtotal' => 300, 'delivery_fee' => 40, 'total' => 340,
        ]);
        $this->verifyEarningSource($order, $this->rider->id);
        // Recorded before the ledger existed (no model events → no postings).
        $legacyId = DB::table('rider_earnings')->insertGetId([
            'rider_id' => $this->rider->id, 'order_id' => $order->id, 'delivery_fee' => 40, 'rider_tip' => 0, 'total_earning' => 40,
            'status' => 'earned', 'earned_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts/available')->assertJsonPath('data.total', 0);
        $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/payouts/request', ['gcash_number' => '09171234567', 'account_name' => 'Aldrin Robledo'])->assertStatus(409);

        // A request made before the ledger (pivot only) is blocked at approval.
        $payout = RiderPayout::create(['payout_number' => 'PO-OLD', 'rider_id' => $this->rider->id, 'amount' => 40, 'status' => 'pending', 'requested_at' => now(), 'destination_gcash_number' => '09171234567', 'destination_account_name' => 'Aldrin Robledo']);
        $payout->earnings()->attach($legacyId);
        $this->approve($payout->id)->assertStatus(409);
        $failed = collect(RiderPayoutValidation::where('rider_payout_id', $payout->id)->sole()->checks)->where('ok', false)->pluck('key')->all();
        $this->assertContains("posted:{$legacyId}", $failed);

        // Once posted by the backfill, the ledger supports it.
        $this->artisan('earnings:ledger-backfill')->assertSuccessful();
        $this->assertEquals(40, app(\App\Services\RiderEarningLedger::class)->earned($legacyId));
    }

    public function test_an_earning_changed_or_paid_elsewhere_after_reservation_is_blocked(): void
    {
        $earning = $this->earning();
        $id = $this->request();
        // Entries written behind the application's back (no valid path does this).
        DB::table('rider_earning_entries')->insert([
            'rider_id' => $this->rider->id, 'rider_earning_id' => $earning->id, 'entry_type' => 'payout_completed', 'bucket' => 'paid',
            'amount' => 60, 'rider_payout_id' => 999, 'actor_role' => 'system', 'idempotency_key' => 'forged:paid', 'created_at' => now(),
        ]);

        $this->approve($id)->assertStatus(409);
        $failed = collect(RiderPayoutValidation::where('context', 'approve')->sole()->checks)->where('ok', false)->pluck('key')->all();
        $this->assertContains("not_elsewhere:{$earning->id}", $failed);
        $this->assertContains("reserved:{$earning->id}", $failed);
    }

    // ---------------- approved snapshot ----------------

    public function test_an_approved_cashouts_amount_and_destination_are_locked(): void
    {
        $this->earning();
        $id = $this->request();
        $this->approve($id)->assertOk();

        try {
            RiderPayout::find($id)->update(['destination_gcash_number' => '09998887777']);
            $this->fail('Approved destination must be locked.');
        } catch (LogicException) {
        }

        // Changed in the database anyway: payment is refused.
        DB::table('rider_payouts')->where('id', $id)->update(['destination_gcash_number' => '09998887777']);
        $this->pay($id)->assertStatus(409);
        $this->assertSame('approved', RiderPayout::find($id)->status);
        $failed = collect(RiderPayoutValidation::where('rider_payout_id', $id)->where('context', 'pay')->sole()->checks)->where('ok', false)->pluck('key')->all();
        $this->assertSame(['destination'], $failed);
    }

    // ---------------- storage + access ----------------

    public function test_validations_are_append_only_and_staff_can_recheck(): void
    {
        $this->earning();
        $id = $this->request();

        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/validate")->assertOk()->assertJsonPath('data.result', 'pass')->assertJsonPath('data.context', 'manual');
        $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$id}")->assertOk()->assertJsonPath('data.validation.result', 'pass');
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/admin/payouts/{$id}/validate")->assertForbidden();

        $this->expectException(QueryException::class);
        DB::table('rider_payout_validations')->where('rider_payout_id', $id)->update(['result' => 'pass']);
    }

    // ---------------- refund API (item 0) ----------------

    public function test_refunds_use_the_documented_paymongo_endpoint_and_reason_list(): void
    {
        config(['services.paymongo.secret_key' => 'sk_test_validate']);
        Http::fake(['api.paymongo.com/*' => Http::response(['data' => ['id' => 'ref_1', 'attributes' => ['status' => 'pending']]], 200)]);

        app(PaymongoService::class)->createRefund('pay_abc', 36000, 'Order cancelled by the tourist before a rider accepted', 'key-123');

        Http::assertSent(function ($request) {
            $a = $request->data()['data']['attributes'] ?? [];

            return $request->method() === 'POST' && str_ends_with($request->url(), '/v1/refunds')
                && $a['payment_id'] === 'pay_abc' && $a['amount'] === 36000 && $a['reason'] === 'requested_by_customer'
                && $a['notes'] === 'Order cancelled by the tourist before a rider accepted' && $a['metadata'] === ['local_refund_key' => 'key-123']
                && $request->header('Idempotency-Key') === ['key-123'];
        });
        $this->assertSame('others', PaymongoService::refundReason('Restaurant closed early'));
        $this->assertSame('duplicate', PaymongoService::refundReason('Duplicate charge'));
    }
}
