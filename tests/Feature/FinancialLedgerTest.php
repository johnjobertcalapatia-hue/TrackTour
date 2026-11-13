<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderEarningEntry;
use App\Models\RiderPayout;
use App\Models\User;
use App\Services\RiderEarningLedger;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use LogicException;
use Tests\Concerns\MakesVerifiedEarnings;
use Tests\TestCase;

/**
 * Stage 5 — shared rider financial ledger: earnings are permanent entries;
 * corrections are compensating adjustments; cashout reservations, releases
 * and payouts are entries too; COD stays out of the online balance.
 */
class FinancialLedgerTest extends TestCase
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

        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@ledger.test', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->staffA = User::create(['name' => 'Staff A', 'email' => 'a@bansud.gov.ph', 'password' => Hash::make('StaffA-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $this->staffB = User::create(['name' => 'Staff B', 'email' => 'b@bansud.gov.ph', 'password' => Hash::make('StaffB-pass1'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $owner = User::create(['email' => 'owner@ledger.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
        ]);
    }

    private function earning(float $commission, float $tip = 0, string $method = 'gcash'): RiderEarning
    {
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)),
            'business_id' => $this->business->id,
            'customer_name' => 'Jayvie De Torres',
            'customer_email' => 'tourist@ledger.test',
            'order_type' => 'delivery',
            'payment_method' => $method,
            'payment_status' => $method === 'cash' ? 'paid' : 'pending',
            'status' => 'completed',
            'subtotal' => 300, 'delivery_fee' => $commission, 'rider_tip' => $tip, 'system_fee' => 0, 'rider_financed_amount' => 300, 'total' => 300 + $commission + $tip,
        ]);
        if ($method !== 'cash') {
            $this->verifyEarningSource($order, $this->rider->id);
        } else {
            Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'completed', 'delivered_at' => now(), 'pickup_address' => 'P', 'delivery_address' => 'D']);
        }

        return RiderEarning::create([
            'rider_id' => $this->rider->id, 'order_id' => $order->id, 'delivery_fee' => $commission, 'rider_tip' => $tip,
            'total_earning' => $commission + $tip, 'status' => 'earned', 'earned_at' => now()->subMinutes($this->minutesAgo--),
        ]);
    }

    private function ledger(): RiderEarningLedger
    {
        return app(RiderEarningLedger::class);
    }

    private function request(array $overrides = [])
    {
        return $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/payouts/request', array_merge([
            'gcash_number' => '09171234567', 'account_name' => 'Aldrin Robledo',
        ], $overrides));
    }

    private function types(int $earningId): array
    {
        return RiderEarningEntry::where('rider_earning_id', $earningId)->orderBy('id')->pluck('entry_type')->all();
    }

    // ---------------- postings ----------------

    public function test_an_earning_is_posted_once_as_commission_and_tip_entries(): void
    {
        $earning = $this->earning(60, 20);

        $this->assertSame(['earning_posted', 'tip_posted'], $this->types($earning->id));
        $commission = RiderEarningEntry::where('rider_earning_id', $earning->id)->where('entry_type', 'earning_posted')->sole();
        $this->assertEquals(60, $commission->amount);
        $this->assertSame('online', $commission->channel);
        $this->assertSame('food', $commission->service);
        $this->assertSame('full delivery fee (before any delivery-fee promotion)', $commission->details['commission_rule']);
        $this->assertEquals(80, $this->ledger()->earned($earning->id));

        // Posting again (e.g. a retried job) changes nothing.
        $this->ledger()->postEarning($earning);
        $this->assertCount(2, $this->types($earning->id));
    }

    public function test_earnings_are_write_once_and_entries_are_append_only(): void
    {
        $earning = $this->earning(60);

        try {
            $earning->update(['total_earning' => 999]);
            $this->fail('Amounts must be write-once.');
        } catch (LogicException) {
        }
        $earning->refresh();
        $earning->update(['status' => 'earned']); // non-amount fields stay editable
        try {
            $earning->delete();
            $this->fail('Earnings are never deleted.');
        } catch (LogicException) {
        }

        $entry = RiderEarningEntry::where('rider_earning_id', $earning->id)->first();
        try {
            $entry->update(['amount' => 1]);
            $this->fail('Entries are append-only.');
        } catch (LogicException) {
        }
        $this->expectException(QueryException::class);
        DB::table('rider_earning_entries')->where('id', $entry->id)->update(['amount' => 1]);
    }

    public function test_the_same_entry_can_never_be_written_twice(): void
    {
        $earning = $this->earning(60);
        $this->expectException(QueryException::class);
        DB::table('rider_earning_entries')->insert([
            'rider_id' => $this->rider->id, 'rider_earning_id' => $earning->id, 'entry_type' => 'earning_posted', 'bucket' => 'earned',
            'amount' => 60, 'actor_role' => 'system', 'idempotency_key' => "earning:{$earning->id}:commission",
        ]);
    }

    public function test_a_recalculated_completion_becomes_a_system_adjustment(): void
    {
        $earning = $this->earning(60);
        $order = Order::find($earning->order_id);
        $delivery = Delivery::where('order_id', $order->id)->sole();
        $delivery->update(['rider_commission' => 75]);

        $record = \Closure::bind(fn ($d, $o, $r) => $this->recordEarning($d, $o, $r), app(\App\Services\NearestRiderService::class), \App\Services\NearestRiderService::class);
        $record($delivery->fresh(), $order, $this->rider->id);
        $record($delivery->fresh(), $order, $this->rider->id); // again: idempotent

        $this->assertEquals(60, $earning->fresh()->total_earning, 'The row is never edited.');
        $adjustments = RiderEarningEntry::where('rider_earning_id', $earning->id)->where('entry_type', 'adjustment')->get();
        $this->assertCount(1, $adjustments);
        $this->assertEquals(15, $adjustments[0]->amount);
        $this->assertEquals(75, $this->ledger()->earned($earning->id));
    }

    // ---------------- cashout lifecycle ----------------

    public function test_reservations_releases_and_payouts_are_permanent_entries(): void
    {
        $earning = $this->earning(60);
        $first = $this->request()->assertCreated()->json('data.id');
        $this->assertEquals(0, $this->ledger()->available($earning->id));
        $this->assertEquals(60, $this->ledger()->open($earning->id));

        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$first}/reject", ['reason' => 'Name mismatch'])->assertOk();
        $this->assertEquals(60, $this->ledger()->available($earning->id), 'Released back to the rider.');

        $second = $this->request()->assertCreated()->json('data.id');
        $this->actingAs($this->staffA, 'sanctum')->postJson("/api/admin/payouts/{$second}/approve", ['password' => 'StaffA-pass1'])->assertOk();
        // Approved is not paid.
        $this->assertEquals(0, $this->ledger()->paid($earning->id));
        $this->assertEquals(0, $this->ledger()->riderTotals($this->rider->id)['paid']);

        $this->actingAs($this->staffB, 'sanctum')->post("/api/admin/payouts/{$second}/mark-paid", [
            'password' => 'StaffB-pass1', 'reference' => '5012345678901', 'amount' => 60, 'recipient_number' => '09171234567',
            'recipient_name' => 'Aldrin Robledo', 'paid_at' => now()->subMinute()->toDateTimeString(), 'proof' => UploadedFile::fake()->image('gcash.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();

        $this->assertSame(['earning_posted', 'cashout_reserved', 'reservation_released', 'cashout_reserved', 'payout_completed'], $this->types($earning->id));
        $this->assertEquals(60, $this->ledger()->paid($earning->id));
        $this->assertEquals(0, $this->ledger()->open($earning->id));
        $this->assertEquals(0, $this->ledger()->available($earning->id));
        $this->assertSame(['earned' => 60.0, 'open' => 0.0, 'paid' => 60.0, 'available' => 0.0], $this->ledger()->riderTotals($this->rider->id));
    }

    public function test_an_earning_cannot_be_reserved_twice(): void
    {
        $earning = $this->earning(60);
        $this->request()->assertCreated();
        $this->request()->assertStatus(409);

        $this->assertSame(1, RiderEarningEntry::where('rider_earning_id', $earning->id)->where('entry_type', 'cashout_reserved')->count());
        $this->ledger()->reserve(RiderPayout::first(), collect([$earning])); // a repeat is a no-op
        $this->assertSame(1, RiderEarningEntry::where('rider_earning_id', $earning->id)->where('entry_type', 'cashout_reserved')->count());
    }

    public function test_cod_earnings_are_recorded_but_never_online_cashout_balance(): void
    {
        $cod = $this->earning(40, 0, 'cash');   // cash first: an eligible earning then sits at a later position
        $online = $this->earning(60);

        $this->assertSame('cod', RiderEarningEntry::where('rider_earning_id', $cod->id)->value('channel'));
        $this->assertEquals(60, $this->ledger()->riderTotals($this->rider->id)['earned']);
        $available = $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/payouts/available')->json('data');
        $this->assertEquals(60, $available['total']);
        $this->assertEquals(40, $available['cash_total']);
        $this->assertEquals(0, $available['held_total'], 'An eligible earning is never also "held".');
        $this->assertNotNull($online);
    }

    // ---------------- adjustments ----------------

    public function test_staff_adjustment_needs_password_and_reason_and_changes_the_balance(): void
    {
        $earning = $this->earning(60);
        $url = "/api/admin/rider-earnings/{$earning->id}/adjust";

        $this->actingAs($this->staffA, 'sanctum')->postJson($url, ['amount' => 10, 'reason' => 'Long wait at pickup', 'password' => 'wrong'])->assertStatus(422)->assertJsonValidationErrors('password');
        $this->actingAs($this->staffA, 'sanctum')->postJson($url, ['amount' => 10, 'password' => 'StaffA-pass1'])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->actingAs($this->staffA, 'sanctum')->postJson($url, ['amount' => 10, 'reason' => 'Long wait at pickup', 'password' => 'StaffA-pass1'])
            ->assertOk()->assertJsonPath('data.available', 70);

        $this->assertEquals(60, $earning->fresh()->total_earning);
        $this->assertEquals(70, $this->request()->json('data.amount'));
        $this->actingAs($this->rider, 'sanctum')->postJson($url, ['amount' => 10, 'reason' => 'Self service', 'password' => 'Password123!'])->assertForbidden();
    }

    public function test_large_adjustments_need_a_second_staff_member(): void
    {
        config(['payouts.two_person_threshold' => 50]);
        $earning = $this->earning(60);
        $url = "/api/admin/rider-earnings/{$earning->id}/adjust";
        $body = ['amount' => -55, 'reason' => 'Duplicate delivery fee', 'password' => 'StaffA-pass1'];

        $this->actingAs($this->staffA, 'sanctum')->postJson($url, $body)->assertStatus(422)->assertJsonValidationErrors('second_staff_email');
        $this->actingAs($this->staffA, 'sanctum')->postJson($url, $body + ['second_staff_email' => 'a@bansud.gov.ph', 'second_staff_password' => 'StaffA-pass1'])->assertStatus(422);
        $this->actingAs($this->staffA, 'sanctum')->postJson($url, $body + ['second_staff_email' => 'b@bansud.gov.ph', 'second_staff_password' => 'StaffB-pass1'])->assertOk();

        $entry = RiderEarningEntry::where('entry_type', 'adjustment')->sole();
        $this->assertSame($this->staffA->id, (int) $entry->actor_id);
        $this->assertSame($this->staffB->id, (int) $entry->approved_by);
        $this->assertEquals(5, $this->ledger()->earned($earning->id));
    }

    public function test_adjustments_cannot_touch_a_live_cashout_or_go_negative(): void
    {
        $earning = $this->earning(60);
        $url = "/api/admin/rider-earnings/{$earning->id}/adjust";
        $this->actingAs($this->staffA, 'sanctum')->postJson($url, ['amount' => -61, 'reason' => 'Too much', 'password' => 'StaffA-pass1'])->assertStatus(409);

        $this->request()->assertCreated();
        $this->actingAs($this->staffA, 'sanctum')->postJson($url, ['amount' => 5, 'reason' => 'Late bonus', 'password' => 'StaffA-pass1'])->assertStatus(409);
    }

    // ---------------- backfill ----------------

    public function test_backfill_posts_legacy_earnings_and_cashouts_once(): void
    {
        $order = Order::create([
            'order_number' => 'TT-LEGACY', 'business_id' => $this->business->id, 'customer_name' => 'X', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'completed', 'subtotal' => 300, 'delivery_fee' => 40, 'total' => 340,
        ]);
        // An earning recorded before the ledger existed (no model events).
        $id = DB::table('rider_earnings')->insertGetId([
            'rider_id' => $this->rider->id, 'order_id' => $order->id, 'delivery_fee' => 40, 'rider_tip' => 0, 'total_earning' => 40,
            'status' => 'earned', 'earned_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->artisan('earnings:ledger-backfill')->expectsOutputToContain('Posted 1 earnings')->assertSuccessful();
        $this->artisan('earnings:ledger-backfill')->expectsOutputToContain('Posted 0 earnings')->assertSuccessful();

        $entry = RiderEarningEntry::where('rider_earning_id', $id)->sole();
        $this->assertTrue($entry->details['backfilled']);
        $this->assertStringContainsString('flat ₱40', 'fixed on the delivery: ₱40.00 (rule before 2026-11-11: flat ₱40)');
        $this->assertEquals(40, $this->ledger()->earned($id));
    }
}
