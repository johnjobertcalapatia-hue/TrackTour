<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Concerns\MakesVerifiedEarnings;
use Tests\TestCase;

/**
 * Secure rider cashout (decision 2026-11-11):
 *   No verified transaction, no rider earnings.
 *   No verified earnings, no cashout.
 *   No Tourism Office approval, no payout.
 */
class SecureCashoutTest extends TestCase
{
    use MakesVerifiedEarnings;
    use RefreshDatabase;

    private User $rider;

    private User $staffA;

    private User $staffB;

    private Business $business;

    /** Fixture earnings are created oldest first. */
    private int $minutesAgo = 100;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');

        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@example.com', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->staffA = User::create(['name' => 'Staff A', 'email' => 'a@bansud.gov.ph', 'password' => Hash::make('StaffA-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $this->staffB = User::create(['name' => 'Staff B', 'email' => 'b@bansud.gov.ph', 'password' => Hash::make('StaffB-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);

        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
        ]);
    }

    private function earning(float $amount, string $method = 'gcash', bool $verified = true, string $type = 'delivery'): RiderEarning
    {
        $order = Order::create([
            'order_number' => ($type === 'transport' ? 'TRP-' : 'TT-').Str::upper(Str::random(6)),
            'business_id' => $type === 'transport' ? null : $this->business->id,
            'customer_name' => 'Jayvie De Torres',
            'customer_email' => 'tourist@example.com',
            'order_type' => $type,
            'payment_method' => $method,
            'payment_status' => $method === 'cash' ? 'paid' : 'pending',
            'status' => 'completed',
            'subtotal' => 300, 'delivery_fee' => 60, 'rider_tip' => 0, 'system_fee' => 0, 'rider_financed_amount' => 300, 'total' => 360,
        ]);
        if ($verified && $method !== 'cash') {
            $this->verifyEarningSource($order, $this->rider->id);
        } else {
            Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'completed', 'delivered_at' => now(), 'pickup_address' => 'P', 'delivery_address' => 'D']);
        }

        return RiderEarning::create([
            'rider_id' => $this->rider->id, 'order_id' => $order->id, 'delivery_fee' => 197.2, 'rider_tip' => 0,
            'total_earning' => $amount, 'status' => 'earned', 'earned_at' => now()->subMinutes($this->minutesAgo--),
        ]);
    }

    private function request(array $overrides = [])
    {
        return $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/payouts/request', array_merge([
            'gcash_number' => '09171234567', 'account_name' => 'Aldrin Robledo',
        ], $overrides));
    }

    private function evidence(RiderPayout|int $payout, array $overrides = []): array
    {
        $amount = $payout instanceof RiderPayout ? (float) $payout->amount : 0;

        return array_merge([
            'password' => 'StaffB-pass1', 'reference' => '5012345678901', 'amount' => $amount,
            'recipient_number' => '09171234567', 'recipient_name' => 'Aldrin Robledo', 'paid_at' => now()->subMinute()->toDateTimeString(),
            'proof' => UploadedFile::fake()->image('gcash.jpg'),
        ], $overrides);
    }

    // ---------- eligibility: only verified online earnings ----------

    public function test_only_verified_online_earnings_can_be_cashed_out(): void
    {
        $this->earning(40);                                   // online, verified
        $this->earning(84.54, 'cash', type: 'transport');     // cash ride: kept from the cash
        $this->earning(55, 'gcash', verified: false);         // online but no provider payment yet

        $data = $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts/available')->assertOk()->json('data');

        $this->assertEquals(40, $data['total']);
        $this->assertCount(1, $data['earnings']);
        $this->assertEquals(84.54, $data['cash_total']);
        $this->assertEquals(55, $data['held_total']);
        $this->assertSame('paymongo', $data['earnings'][0]['payment_provider']);
    }

    public function test_a_refund_or_unfinished_delivery_makes_an_earning_ineligible(): void
    {
        $refunded = $this->earning(40);
        Payment::where('payable_id', $refunded->order_id)->update(['refunded_at' => now(), 'status' => 'refunded']);
        $unfinished = $this->earning(50);
        Delivery::where('order_id', $unfinished->order_id)->update(['status' => 'in_transit', 'delivered_at' => null]);

        $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts/available')->assertJsonPath('data.total', 0);
        $this->request()->assertStatus(409);
    }

    // ---------- rider request ----------

    public function test_request_needs_a_gcash_destination_and_takes_oldest_whole_earnings_up_to_the_amount(): void
    {
        $this->earning(40);
        $this->earning(45);
        $this->earning(50);

        $this->request(['gcash_number' => '12345'])->assertStatus(422)->assertJsonValidationErrors('gcash_number');
        $this->request(['account_name' => ''])->assertStatus(422)->assertJsonValidationErrors('account_name');

        $row = $this->request(['amount' => 100])->assertCreated()->json('data');
        $this->assertEquals(85, $row['amount'], 'Whole earnings only: 40 + 45 (adding 50 would exceed 100).');
        $this->assertSame('pending', $row['status']);

        $payout = RiderPayout::findOrFail($row['id']);
        $this->assertCount(2, $payout->items_snapshot);
        $this->assertSame('09171234567', $payout->destination_gcash_number);
        $this->assertDatabaseHas('activity_logs', ['action' => 'payout.requested', 'model_id' => $payout->id]);

        $this->request()->assertStatus(409); // one live request at a time
    }

    // ---------- Tourism Office review → approval → GCash payment ----------

    public function test_full_review_approval_and_evidenced_payment(): void
    {
        $this->earning(40);
        $this->earning(60);
        $id = $this->request()->json('data.id');

        // Breakdown traces each earning to its source.
        $detail = $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$id}")->assertOk()->json('data');
        $this->assertCount(2, $detail['items']);
        $this->assertTrue($detail['all_verified']);
        $this->assertSame('09171234567', $detail['destination']['gcash_number']);
        $this->assertSame(['earning', 'order', 'online', 'payment', 'assigned', 'completed', 'unpaid'], array_column($detail['items'][0]['checks'], 'key'));

        // Under review: the rider can no longer cancel.
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/start-review")->assertOk()->assertJsonPath('data.status', 'under_review');
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/payouts/{$id}/cancel")->assertStatus(409);

        // No payment before approval.
        $payout = RiderPayout::findOrFail($id);
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($payout), ['Accept' => 'application/json'])->assertStatus(409);

        // Approval needs the staff password.
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'wrong'])->assertStatus(422)->assertJsonValidationErrors('password');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'StaffA-pass1'])->assertOk()->assertJsonPath('data.status', 'approved');

        // Paid only with evidence: proof required, exact amount, password.
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($payout, ['proof' => null]), ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors('proof');
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($payout, ['amount' => 99]), ['Accept' => 'application/json'])->assertStatus(409);
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($payout, ['password' => 'nope']), ['Accept' => 'application/json'])->assertStatus(422);
        $paid = $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($payout), ['Accept' => 'application/json'])->assertOk()->json('data');

        $this->assertSame('paid', $paid['status']);
        $this->assertSame('5012345678901', $paid['payment']['reference']);
        $this->assertEquals(100, $paid['payment']['amount']);
        $this->assertSame('Staff B', $paid['payment']['paid_by']['name']);
        $this->assertSame('Staff A', $paid['review']['approved_by']['name']);
        Storage::disk('local')->assertExists(RiderPayout::find($id)->payment_proof_path);
        $this->actingAs($this->staffA, 'sanctum')->get("/api/admin/payouts/{$id}/proof")->assertOk();

        // The rider sees the GCash reference; the earnings can never be drawn again.
        $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts')->assertJsonPath('data.0.payment_reference', '5012345678901');
        $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts/available')->assertJsonPath('data.total', 0);

        foreach (['payout.requested', 'payout.review_started', 'payout.approved', 'payout.paid'] as $action) {
            $this->assertDatabaseHas('activity_logs', ['action' => $action, 'model_id' => $id, 'type' => 'financial']);
        }
        $this->assertCount(4, $paid['history']);
    }

    public function test_approval_is_blocked_when_an_earning_no_longer_verifies(): void
    {
        $earning = $this->earning(40);
        $id = $this->request()->json('data.id');
        Payment::where('payable_id', $earning->order_id)->update(['refunded_at' => now()]);

        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'StaffA-pass1'])
            ->assertStatus(409)
            ->assertJsonFragment(['message' => "These earnings failed verification: {$earning->order->order_number}. Reject the request or investigate."]);
        $this->assertSame('pending', RiderPayout::find($id)->status);
    }

    public function test_a_gcash_reference_can_be_used_once(): void
    {
        $this->earning(40);
        $first = $this->request()->json('data.id');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$first}/approve", ['password' => 'StaffA-pass1']);
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$first}/mark-paid", $this->evidence(RiderPayout::find($first)), ['Accept' => 'application/json'])->assertOk();

        $this->earning(70);
        $second = $this->request()->json('data.id');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$second}/approve", ['password' => 'StaffA-pass1']);
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$second}/mark-paid", $this->evidence(RiderPayout::find($second)), ['Accept' => 'application/json'])
            ->assertStatus(409)
            ->assertJsonFragment(['message' => 'That GCash reference is already recorded on another cashout.']);
    }

    public function test_large_cashouts_need_a_second_staff_member_to_confirm_payment(): void
    {
        config(['payouts.two_person_threshold' => 90]);
        $this->earning(40);
        $this->earning(60);
        $id = $this->request()->json('data.id');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'StaffA-pass1'])->assertOk();

        $payout = RiderPayout::find($id);
        $this->actingAs($this->staffA, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($payout, ['password' => 'StaffA-pass1']), ['Accept' => 'application/json'])
            ->assertStatus(409);
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($payout), ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('data.status', 'paid');
    }

    public function test_rejection_needs_a_reason_and_returns_the_earnings(): void
    {
        $this->earning(40);
        $id = $this->request()->json('data.id');

        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/reject", [])->assertStatus(422);
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/reject", ['reason' => 'GCash name does not match the rider'])
            ->assertOk()->assertJsonPath('data.review.rejection_reason', 'GCash name does not match the rider');

        $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts/available')->assertJsonPath('data.total', 40);
        // The rejected request keeps its snapshot of references.
        $this->assertCount(1, $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$id}")->json('data.items'));
    }

    public function test_a_failed_transfer_returns_the_earnings(): void
    {
        $this->earning(40);
        $id = $this->request()->json('data.id');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'StaffA-pass1']);

        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/mark-failed", ['password' => 'StaffA-pass1'])->assertStatus(422);
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/mark-failed", ['password' => 'StaffA-pass1', 'reason' => 'GCash number not registered'])
            ->assertOk()->assertJsonPath('data.status', 'failed');

        $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts/available')->assertJsonPath('data.total', 40);
        $this->request()->assertCreated(); // the slot is free again
    }

    public function test_riders_and_owners_cannot_review_cashouts(): void
    {
        $this->earning(40);
        $id = $this->request()->json('data.id');

        $this->actingAs($this->rider, 'sanctum')->getJson('/api/admin/payouts')->assertForbidden();
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'Password123!'])->assertForbidden();
        $this->assertSame('pending', RiderPayout::find($id)->status);
    }

    // ---------- investigation page ----------

    private function payAndClose(int $id, string $reference): void
    {
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$id}/approve", ['password' => 'StaffA-pass1'])->assertOk();
        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence(RiderPayout::find($id), ['reference' => $reference]), ['Accept' => 'application/json'])->assertOk();
    }

    public function test_dashboard_summary_counts_each_stage(): void
    {
        $this->earning(40);
        $paid = $this->request()->json('data.id');
        $this->payAndClose($paid, '5000000000001');

        $this->earning(45);
        $approved = $this->request()->json('data.id');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$approved}/approve", ['password' => 'StaffA-pass1'])->assertOk();

        // A second rider waits in the queue.
        $other = User::create(['name' => 'Rider Two', 'email' => 'r2@example.com', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        RiderPayout::create(['payout_number' => 'PO-TEST-2', 'rider_id' => $other->id, 'amount' => 70, 'status' => 'pending', 'requested_at' => now()]);

        $data = $this->actingAs($this->staffA, 'sanctum')->getJson('/api/admin/payouts/summary')->assertOk()->json('data');

        $this->assertSame(1, $data['pending_count']);
        $this->assertEquals(70, $data['awaiting_review_amount']);
        $this->assertSame(1, $data['approved_unpaid_count']);
        $this->assertEquals(45, $data['approved_unpaid_amount']);
        $this->assertEquals(40, $data['paid_today_amount']);
        $this->actingAs($this->rider, 'sanctum')->getJson('/api/admin/payouts/summary')->assertForbidden();
    }

    public function test_detail_carries_gcash_history_and_financial_verification(): void
    {
        $this->earning(40);
        $first = $this->request()->json('data.id');
        $this->payAndClose($first, '5000000000002');

        $this->earning(45);
        $sameNumber = $this->request()->json('data.id');
        $detail = $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$sameNumber}")->assertOk()->json('data');

        $this->assertFalse($detail['new_destination']);
        $this->assertSame('09171234567', $detail['gcash_history'][0]['gcash_number']);
        $this->assertSame(1, $detail['gcash_history'][0]['paid']);
        $this->assertNotNull($detail['rider']['member_since']);

        $f = $detail['financial'];
        $this->assertEquals(360, $f['customer_paid']);
        $this->assertEquals(360, $f['gateway_confirmed']);
        $this->assertEquals(45, $f['earnings_in_request']);
        $this->assertEquals(40, $f['paid_out_before']);
        $this->assertEquals(85, $f['lifetime_online_earnings']);
        $this->assertEquals(0, $f['remaining_unpaid']);
        $this->assertTrue(collect($f['checks'])->every(fn ($c) => $c['ok']));

        // A destination never paid before is flagged.
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$sameNumber}/reject", ['reason' => 'Retry']);
        $newNumber = $this->request(['gcash_number' => '09998887777'])->json('data.id');
        $this->assertTrue($this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$newNumber}")->json('data.new_destination'));
    }

    public function test_investigation_shows_the_original_food_order_records(): void
    {
        $earning = $this->earning(40);
        $id = $this->request()->json('data.id');

        $data = $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$id}/earnings/{$earning->id}")->assertOk()->json('data');

        $this->assertSame('food', $data['type']);
        $this->assertSame('Jayvie De Torres', $data['tourist']['name']);
        $this->assertEquals(360, $data['order']['total']);
        $this->assertSame('Ekslusibo Grill', $data['restaurants'][0]['name']);
        $this->assertSame('paymongo', $data['payments'][0]['provider']);
        $this->assertSame('paid', $data['payments'][0]['status']);
        $this->assertSame('Aldrin Robledo', $data['assignment']['rider']['name']);
        $this->assertNotNull($data['completion']['delivered_at']);
        $this->assertEquals(40, $data['earning']['total']);
        $this->assertTrue(collect($data['verification'])->every(fn ($c) => $c['ok']));
    }

    public function test_investigation_shows_ride_booking_records(): void
    {
        $earning = $this->earning(84.5, type: 'transport');
        Delivery::where('order_id', $earning->order_id)->update(['notes' => json_encode(['vehicle_type' => 'tricycle', 'passenger_count' => 2, 'estimated_distance_km' => 4.2])]);
        $id = $this->request()->json('data.id');

        $data = $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$id}/earnings/{$earning->id}")->assertOk()->json('data');

        $this->assertSame('ride', $data['type']);
        $this->assertSame('tricycle', $data['ride']['vehicle_type']);
        $this->assertSame(2, $data['ride']['passenger_count']);
        $this->assertSame([], $data['items']);
    }

    public function test_investigation_is_limited_to_earnings_in_the_request(): void
    {
        $inRequest = $this->earning(40);
        $id = $this->request(['amount' => 40])->json('data.id');
        $outside = $this->earning(45);

        $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$id}/earnings/{$outside->id}")->assertNotFound();
        $this->actingAs($this->staffA, 'sanctum')->getJson("/api/admin/payouts/{$id}/earnings/{$inRequest->id}")->assertOk();
        $this->actingAs($this->rider, 'sanctum')->getJson("/api/admin/payouts/{$id}/earnings/{$inRequest->id}")->assertForbidden();
    }
}
