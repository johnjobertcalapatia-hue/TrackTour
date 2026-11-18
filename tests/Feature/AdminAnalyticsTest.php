<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessEngagementEvent;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\PlatformExpense;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Bansud business-intelligence dashboard: real records only, separate money
 * buckets, previous-period comparison, popularity from engagement records,
 * municipality filter and operating expenses.
 */
class AdminAnalyticsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Municipality $bansud;
    private Municipality $gloria;
    private Business $kainan;
    private Business $gloriaGrill;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::create(2026, 11, 18, 10, 0, 0, 'Asia/Manila'));

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->admin = $this->user('bansud_tourism_office', $this->bansud);
        $owner = $this->user('business_owner', $this->bansud);
        $this->kainan = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->bansud->id, 'business_name' => 'Kainan', 'status' => 'approved']);
        $this->gloriaGrill = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->gloria->id, 'business_name' => 'Gloria Grill', 'status' => 'approved']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_periods_compare_with_the_previous_equivalent_period(): void
    {
        $month = $this->analytics(['period' => 'this_month'])->json('data.period');
        $this->assertSame(['2026-11-01', '2026-11-18', '2026-10-01', '2026-10-18'], [$month['from'], $month['to'], $month['previous_from'], $month['previous_to']]);

        $custom = $this->analytics(['period' => 'custom', 'from' => '2026-11-10', 'to' => '2026-11-16'])->json('data.period');
        $this->assertSame(['2026-11-03', '2026-11-09'], [$custom['previous_from'], $custom['previous_to']]);

        $this->analytics(['period' => 'custom'])->assertStatus(422);
        $this->analytics(['period' => 'custom', 'from' => '2024-01-01', 'to' => '2026-11-16'])->assertStatus(422);
        $this->analytics(['period' => 'forever'])->assertStatus(422);
    }

    public function test_money_is_kept_in_separate_buckets_and_order_totals_are_not_revenue(): void
    {
        $order = $this->completedOrder($this->kainan, 1000, Carbon::create(2026, 11, 5, 12, 0, 0, 'Asia/Manila'));
        $this->settle($order, $this->kainan, 900, 100, Carbon::create(2026, 11, 5, 13, 0, 0, 'Asia/Manila'));
        $this->completedOrder($this->kainan, 400, Carbon::create(2026, 11, 6, 12, 0, 0, 'Asia/Manila')); // not yet settled
        $this->completedOrder($this->kainan, 999, Carbon::create(2026, 10, 3, 12, 0, 0, 'Asia/Manila')); // previous period

        PlatformExpense::create(['category' => 'marketing', 'description' => 'Fiesta posters', 'amount' => 30, 'expense_date' => '2026-11-07']);
        DB::table('refunds')->insert([
            ['amount' => 50, 'status' => 'succeeded', 'order_id' => $order->id, 'refunded_at' => Carbon::create(2026, 11, 8, 9, 0, 0, 'Asia/Manila')->utc(), 'created_at' => now(), 'updated_at' => now()],
            ['amount' => 70, 'status' => 'pending', 'order_id' => $order->id, 'refunded_at' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        $rider = $this->user('rider', $this->bansud);
        DB::table('rider_payouts')->insert([
            ['rider_id' => $rider->id, 'payout_number' => 'PO-1', 'amount' => 200, 'status' => 'pending', 'requested_at' => Carbon::create(2026, 11, 9, 9, 0, 0, 'Asia/Manila')->utc(), 'approved_at' => null, 'paid_at' => null, 'paid_amount' => null],
            ['rider_id' => $rider->id, 'payout_number' => 'PO-2', 'amount' => 150, 'status' => 'paid', 'requested_at' => Carbon::create(2026, 11, 2, 9, 0, 0, 'Asia/Manila')->utc(), 'approved_at' => Carbon::create(2026, 11, 3, 9, 0, 0, 'Asia/Manila')->utc(), 'paid_at' => Carbon::create(2026, 11, 4, 9, 0, 0, 'Asia/Manila')->utc(), 'paid_amount' => 150],
        ]);

        $f = $this->analytics(['period' => 'this_month'])->assertOk()->json('data.financial');

        $this->assertEquals(1400, $f['gross_transaction_value']['value']);
        $this->assertEquals(999, $f['gross_transaction_value']['previous']);
        $this->assertEquals(100, $f['platform_revenue']['value']);
        $this->assertEquals(900, $f['business_owner_earnings']['value']);
        $this->assertEquals(30, $f['operating_expenses']['value']);
        $this->assertEquals(70, $f['net_income']['value']); // platform revenue − expenses, never order totals
        $this->assertEquals(50, $f['refunds']['value']); // provider-confirmed only
        // Backlog snapshot (not period-bound): the unsettled 400 and 999 orders.
        $this->assertSame(2, $f['pending_settlements']['count']);
        $this->assertEquals(1399, $f['pending_settlements']['amount']);
        $this->assertEquals(350, $f['cashouts']['requested']['value']);
        $this->assertEquals(150, $f['cashouts']['approved']['value']);
        $this->assertEquals(150, $f['cashouts']['completed']['value']);
        $this->assertEquals(200, $f['cashouts']['liability']);
        $this->assertEquals(100, $f['earnings_this_month']);

        $trend = collect($this->analytics(['period' => 'this_month'])->json('data.trend.points'))->keyBy('date');
        $this->assertEquals(100, $trend['2026-11-05']['platform_revenue']);
        $this->assertEquals(1000, $trend['2026-11-05']['gross_value']);
        $this->assertEquals(30, $trend['2026-11-07']['expenses']);
    }

    public function test_views_are_real_deduplicated_and_exclude_owners_and_staff(): void
    {
        $tourist = $this->user('tourist', $this->bansud);
        $this->actingAs($tourist, 'sanctum')->getJson("/api/tourist/explore/{$this->kainan->id}");
        $this->actingAs($tourist, 'sanctum')->getJson("/api/tourist/explore/{$this->kainan->id}"); // reload: same day, same viewer
        $this->actingAs($this->admin, 'sanctum')->getJson("/api/tourist/explore/{$this->kainan->id}"); // staff: not audience

        $this->assertSame(1, BusinessEngagementEvent::where('business_id', $this->kainan->id)->where('type', 'profile_view')->count());
    }

    public function test_popularity_uses_engagement_and_flags_declines_with_recommendations(): void
    {
        // Gloria Grill: busy last month, quiet now -> declining.
        foreach (range(1, 12) as $i) {
            $this->recordView($this->gloriaGrill, "prev-{$i}", '2026-10-05');
        }
        $this->recordView($this->gloriaGrill, 'now-1', '2026-11-05');
        // Kainan: strong now, with favorites and an inquiry.
        foreach (range(1, 25) as $i) {
            $this->recordView($this->kainan, "k-{$i}", '2026-11-06');
        }
        DB::table('favorites')->insert(['user_id' => $this->admin->id, 'favoritable_type' => Business::class, 'favoritable_id' => $this->kainan->id, 'created_at' => Carbon::create(2026, 11, 6, 9, 0, 0, 'Asia/Manila')->utc(), 'updated_at' => now()]);
        DB::table('chat_rooms')->insert(['type' => 'food', 'business_id' => $this->kainan->id, 'created_at' => Carbon::create(2026, 11, 6, 9, 0, 0, 'Asia/Manila')->utc(), 'updated_at' => now()]);

        $data = $this->analytics(['period' => 'this_month'])->assertOk()->json('data');
        $rows = collect($data['popularity']['businesses'])->keyBy('name');

        $this->assertSame('declining', $rows['Gloria Grill']['class']);
        $this->assertSame('high', $rows['Kainan']['class']);
        $this->assertSame(25, $rows['Kainan']['metrics']['views']);
        $this->assertSame(1, $rows['Kainan']['metrics']['favorites']);
        $this->assertSame(1, $rows['Kainan']['metrics']['inquiries']);
        $this->assertSame(1, $data['popularity']['summary']['declining']);

        $kinds = collect($data['opportunities'])->pluck('kind');
        $this->assertContains('declining', $kinds);
        $this->assertContains('low_conversion', $kinds); // 25 views, no bookings or transactions
    }

    public function test_municipality_filter_scopes_the_figures(): void
    {
        $this->completedOrder($this->kainan, 300, Carbon::create(2026, 11, 5, 12, 0, 0, 'Asia/Manila'));
        $this->completedOrder($this->gloriaGrill, 700, Carbon::create(2026, 11, 5, 12, 0, 0, 'Asia/Manila'));

        $all = $this->analytics(['period' => 'this_month'])->json('data');
        $this->assertEquals(1000, $all['financial']['gross_transaction_value']['value']);
        $this->assertSame(2, $all['overview']['businesses']['total']);

        $bansud = $this->analytics(['period' => 'this_month', 'municipality_id' => $this->bansud->id])->json('data');
        $this->assertEquals(300, $bansud['financial']['gross_transaction_value']['value']);
        $this->assertSame(1, $bansud['overview']['businesses']['total']);
        $this->assertSame(['Kainan'], collect($bansud['popularity']['businesses'])->pluck('name')->all());

        $share = collect($all['municipalities'])->keyBy('name');
        $this->assertEquals(30.0, $share['Bansud']['share']);
        $this->assertEquals(70.0, $share['Gloria']['share']);
    }

    public function test_operating_expenses_crud_is_admin_only_and_audited(): void
    {
        $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/platform-expenses', ['category' => 'marketing', 'description' => 'x', 'amount' => 0, 'expense_date' => '2026-11-18'])->assertStatus(422);
        $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/platform-expenses', ['category' => 'marketing', 'description' => 'x', 'amount' => 5, 'expense_date' => '2026-12-01'])->assertStatus(422);

        $id = $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/platform-expenses', ['category' => 'events', 'description' => 'Fiesta stage', 'amount' => 1500, 'expense_date' => '2026-11-18'])
            ->assertCreated()->json('data.id');
        $this->assertDatabaseHas('activity_logs', ['action' => 'platform_expense.recorded']);
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/platform-expenses')->assertOk()->assertJsonPath('data.0.description', 'Fiesta stage');

        foreach (['tourism_office', 'tourist', 'rider'] as $role) {
            $other = $this->user($role, $this->gloria);
            $this->actingAs($other, 'sanctum')->postJson('/api/admin/platform-expenses', ['category' => 'events', 'description' => 'y', 'amount' => 1, 'expense_date' => '2026-11-18'])->assertForbidden();
            $this->actingAs($other, 'sanctum')->getJson('/api/admin/dashboard/analytics')->assertForbidden();
        }

        $this->actingAs($this->admin, 'sanctum')->deleteJson("/api/admin/platform-expenses/{$id}")->assertOk();
        $this->assertDatabaseMissing('platform_expenses', ['id' => $id]);
    }

    // ------------------------------------------------------------------

    private function analytics(array $query)
    {
        return $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/dashboard/analytics?'.http_build_query($query));
    }

    private function user(string $role, Municipality $municipality): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(8)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => 'approved',
            'municipality_id' => $municipality->id,
        ]);
    }

    private function completedOrder(Business $business, float $total, Carbon $at): Order
    {
        $order = Order::create(['order_number' => 'ORD-'.Str::upper(Str::random(8)), 'customer_name' => 'A', 'business_id' => $business->id, 'order_type' => 'delivery', 'total' => $total, 'subtotal' => $total]);
        $order->forceFill(['status' => 'completed', 'completed_at' => $at->copy()->utc(), 'created_at' => $at->copy()->utc()])->save();
        DB::table('order_items')->insert(['order_id' => $order->id, 'business_id' => $business->id, 'product_name' => 'Meal', 'quantity' => 1, 'unit_price' => $total, 'subtotal' => $total, 'status' => 'completed', 'created_at' => now(), 'updated_at' => now()]);

        return $order;
    }

    private function settle(Order $order, Business $business, float $restaurant, float $platform, Carbon $at): void
    {
        DB::table('order_settlements')->insert([
            'settlement_number' => 'STL-'.$order->id, 'order_id' => $order->id, 'business_id' => $business->id, 'source' => 'gcash', 'payment_method' => 'gcash',
            'settlement_base' => $restaurant + $platform, 'restaurant_amount' => $restaurant, 'platform_amount' => $platform, 'status' => 'settled',
            'settled_at' => $at->copy()->utc(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function recordView(Business $business, string $viewer, string $day): void
    {
        BusinessEngagementEvent::query()->insert(['business_id' => $business->id, 'type' => 'profile_view', 'viewer_key' => hash('sha256', $viewer), 'viewed_on' => $day, 'created_at' => now()]);
    }
}
