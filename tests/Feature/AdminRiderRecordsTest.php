<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Admin > Riders > rider: the read-only rider record (status, deliveries COD
 * vs online, earnings from rider_earnings, cash out online, and the day's
 * COD cash from the daily receipt). Reading it never changes money state.
 */
class AdminRiderRecordsTest extends TestCase
{
    use RefreshDatabase;
    // Reconciled 2026-11-11 (AGENTS.md §12, secure cashout): only earnings that
    // trace to a provider-confirmed online payment and a completed delivery
    // by the rider can be cashed out, so fixtures build that chain.
    use \Tests\Concerns\MakesVerifiedEarnings;

    private User $office;

    private User $rider;

    private Business $business;

    private Municipality $bansud;

    protected function setUp(): void
    {
        parent::setUp();

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]);
        $this->office = User::factory()->create([
            'role' => User::ROLE_BANSUD_TOURISM_OFFICE,
            'account_status' => 'approved',
            'municipality_id' => $this->bansud->id,
        ]);
        $this->rider = User::factory()->create([
            'name' => 'Aldrin Robledo',
            'role' => User::ROLE_RIDER,
            'account_status' => 'approved',
            'municipality_id' => $this->bansud->id,
        ]);
        $this->rider->riderDetail()->create(['rider_status' => 'available', 'current_service' => 'food']);

        $owner = User::factory()->create(['role' => User::ROLE_BUSINESS_OWNER, 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $this->bansud->id,
            'business_name' => 'Records Eatery',
            'status' => 'approved',
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    /** A completed (or other status) delivery for the rider, with its earning. */
    private function delivery(string $method, string $status = 'completed', float $earning = 40, float $tip = 0, ?string $deliveredAt = null): Delivery
    {
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)),
            'business_id' => $this->business->id,
            'customer_name' => 'Tourist',
            'customer_email' => 'tourist@example.com',
            'order_type' => 'delivery',
            'payment_method' => $method,
            'payment_status' => $method === 'cash' ? 'pending' : 'paid',
            'status' => $status === 'completed' ? 'completed' : 'cancelled',
            'subtotal' => 300,
            'delivery_fee' => 197.20,
            'rider_tip' => $tip,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 497.20 + $tip,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_address' => 'Poblacion',
        ]);

        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $this->rider->id,
            'status' => $status,
            'delivery_fee' => 197.20,
            'rider_commission' => $earning,
            'cash_due' => $method === 'cash' ? 497.20 + $tip : null,
            'delivered_at' => $status === 'completed' ? ($deliveredAt ?? now()) : null,
            'pickup_address' => 'Records Eatery',
            'delivery_address' => 'Poblacion',
        ]);

        if ($status === 'completed' && $method !== 'cash') {
            $this->verifyEarningSource($order, $this->rider->id);
        }

        if ($status === 'completed') {
            RiderEarning::create([
                'rider_id' => $this->rider->id,
                'order_id' => $order->id,
                'delivery_fee' => 197.20,
                'rider_tip' => $tip,
                'total_earning' => $earning + $tip,
                'status' => 'earned',
                'earned_at' => $deliveredAt ?? now(),
            ]);
        }

        return $delivery;
    }

    private function records(?string $date = null): array
    {
        return $this->actingAs($this->office, 'sanctum')
            ->getJson("/api/admin/riders/{$this->rider->id}/records".($date ? "?date={$date}" : ''))
            ->assertOk()
            ->json('data');
    }

    public function test_counts_cod_and_online_deliveries_today_and_all_time(): void
    {
        $this->delivery('cash');
        $this->delivery('cash');
        $this->delivery('gcash', tip: 20);
        $this->delivery('gcash', deliveredAt: now()->subDays(3)->toDateTimeString());
        $this->delivery('cash', status: 'cancelled');

        $data = $this->records();

        $this->assertSame(['total' => 4, 'cod' => 2, 'online' => 2, 'rides' => 0], $data['deliveries']['all_time']);
        $this->assertSame(['total' => 3, 'cod' => 2, 'online' => 1, 'rides' => 0], $data['deliveries']['on_date']);
        $this->assertSame(1, $data['deliveries']['cancelled']);
        $this->assertCount(5, $data['recent_deliveries']);
        $this->assertSame('cod', $data['recent_deliveries'][0]['payment']);
        $this->assertSame('cancelled', $data['recent_deliveries'][0]['status']);
    }

    public function test_earnings_come_from_rider_earnings_not_cod_cash_or_the_tourist_fee(): void
    {
        $this->delivery('cash');                // ₱40
        $this->delivery('gcash', tip: 20);      // ₱40 + ₱20 tip

        $earnings = $this->records()['earnings']['all_time'];

        $this->assertEquals(100, $earnings['total']);
        $this->assertEquals(80, $earnings['delivery_fee_share']);
        $this->assertEquals(20, $earnings['tips']);
        $this->assertEquals(40, $earnings['from_cod']);
        $this->assertEquals(60, $earnings['from_online']);
    }

    public function test_cash_out_shows_what_is_available_pending_and_paid(): void
    {
        $this->delivery('gcash');
        $this->delivery('gcash');
        $paidDelivery = $this->delivery('gcash');
        // Stage 6: "paid" comes from the earnings ledger, so the paid payout is
        // a real one (reserved and completed through the ledger). Before, an
        // unbacked ₱150 payout row was enough to show as paid.
        $earning = \App\Models\RiderEarning::where('order_id', $paidDelivery->order_id)->sole();
        $payout = RiderPayout::create([
            'rider_id' => $this->rider->id,
            'payout_number' => 'PO-TEST-1',
            'amount' => 40,
            'status' => RiderPayout::STATUS_PAID,
            'requested_at' => now()->subDay(),
            'paid_at' => now(),
        ]);
        $payout->earnings()->attach($earning->id);
        app(\App\Services\RiderEarningLedger::class)->reserve($payout, collect([$earning]));
        app(\App\Services\RiderEarningLedger::class)->complete($payout, collect([$earning]));

        $cashOut = $this->records()['cash_out'];

        $this->assertEquals(80, $cashOut['available']);
        $this->assertEquals(40, $cashOut['paid']);
        $this->assertEquals(0, $cashOut['pending']);
        $this->assertSame('PO-TEST-1', $cashOut['payouts'][0]['payout_number']);
    }

    public function test_shows_status_and_the_active_delivery(): void
    {
        $this->delivery('cash');
        $active = $this->delivery('cash', status: 'picked_up');

        $rider = $this->records()['rider'];

        $this->assertSame('available', $rider['rider_status']);
        $this->assertSame('Bansud', $rider['municipality']);
        $this->assertSame($active->id, $rider['active_delivery']['delivery_id']);
        $this->assertSame('picked_up', $rider['active_delivery']['status']);
        $this->assertSame('cod', $rider['active_delivery']['payment']);
    }

    public function test_cod_cash_for_the_day_comes_from_the_daily_receipt(): void
    {
        $this->actingAs($this->office, 'sanctum')
            ->postJson("/api/admin/riders/{$this->rider->id}/cash-fund/advances", ['amount' => 1000, 'idempotency_key' => (string) Str::uuid()])
            ->assertSuccessful();

        $cash = $this->records()['cod_cash'];

        $this->assertTrue($cash['available']);
        $this->assertEquals(1000, $cash['office_cash_issued']);
        $this->assertEquals(1000, $cash['office_cash_with_rider']);
        $this->assertArrayHasKey('rider_own_money_used', $cash);
        $this->assertArrayHasKey('payable_to_rider', $cash);
        $this->assertArrayHasKey('net_cod_remittance', $cash);
    }

    public function test_cod_cash_is_hidden_with_a_reason_for_a_rider_outside_the_office_municipality(): void
    {
        $this->rider->update(['municipality_id' => null]);

        $cash = $this->records()['cod_cash'];

        $this->assertFalse($cash['available']);
        $this->assertStringContainsString('municipality', $cash['reason']);
    }

    public function test_reading_the_record_changes_no_money_state(): void
    {
        $this->delivery('cash');
        $before = [RiderEarning::count(), RiderPayout::count(), Delivery::count()];

        $this->records();
        $this->records(now('Asia/Manila')->subDay()->toDateString());

        $this->assertSame($before, [RiderEarning::count(), RiderPayout::count(), Delivery::count()]);
    }

    public function test_validation_and_access(): void
    {
        $this->actingAs($this->office, 'sanctum')
            ->getJson("/api/admin/riders/{$this->rider->id}/records?date=2999-01-01")
            ->assertStatus(422);

        $this->actingAs($this->office, 'sanctum')
            ->getJson("/api/admin/riders/{$this->office->id}/records")
            ->assertStatus(404);

        $this->actingAs($this->rider, 'sanctum')
            ->getJson("/api/admin/riders/{$this->rider->id}/records")
            ->assertStatus(403);
    }

    // Stage 6: the totals come from the earnings ledger, so they agree with the cashout balance.
    public function test_earnings_totals_come_from_the_ledger_including_adjustments(): void
    {
        $delivery = $this->delivery('gcash');
        $earning = \App\Models\RiderEarning::where('order_id', $delivery->order_id)->sole();
        $before = $this->records()['earnings']['all_time'];

        app(\App\Services\RiderEarningLedger::class)->adjust($earning, 10, 'Waiting time at pickup', null);

        $after = $this->records()['earnings']['all_time'];
        $this->assertEquals($before['total'] + 10, $after['total']);
        $this->assertEquals(10, $after['adjustments']);
        $this->assertEquals($after['total'], $after['from_cod'] + $after['from_online']);
        $this->assertEquals(round($before['total'] + 10, 2), $this->records()['cash_out']['available']);
    }
}
