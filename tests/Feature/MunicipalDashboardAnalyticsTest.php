<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessEngagementEvent;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Municipal Tourism Office business-intelligence dashboard
 * (GET /api/municipal/dashboard/analytics): the Bansud dashboard's figures,
 * always scoped to the officer's own municipality, without platform-only data.
 */
class MunicipalDashboardAnalyticsTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $gloria;
    private Municipality $roxas;
    private User $officer;
    private Business $gloriaGrill;
    private Business $roxasCafe;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::create(2026, 11, 18, 10, 0, 0, 'Asia/Manila'));

        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->roxas = Municipality::create(['name' => 'Roxas', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->officer = $this->user(User::ROLE_TOURISM_OFFICE, $this->gloria);
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->gloria);
        $this->gloriaGrill = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->gloria->id, 'business_name' => 'Gloria Grill', 'status' => 'approved']);
        $this->roxasCafe = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->roxas->id, 'business_name' => 'Roxas Cafe', 'status' => 'approved']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_figures_cover_only_the_officers_municipality(): void
    {
        $this->completedOrder($this->gloriaGrill, 300, Carbon::create(2026, 11, 5, 12, 0, 0, 'Asia/Manila'));
        $this->completedOrder($this->roxasCafe, 700, Carbon::create(2026, 11, 5, 12, 0, 0, 'Asia/Manila'));
        $this->completedOrder($this->gloriaGrill, 100, Carbon::create(2026, 10, 5, 12, 0, 0, 'Asia/Manila')); // previous period
        $this->recordView($this->gloriaGrill, 'v1', '2026-11-10');
        $this->recordView($this->roxasCafe, 'v2', '2026-11-10');

        $data = $this->analytics(['period' => 'this_month'])->assertOk()->json('data');

        $this->assertSame('Gloria', $data['municipality']['name']);
        $this->assertSame(1, $data['overview']['businesses']['total']);
        $this->assertEquals(300, $data['economy']['gross_transaction_value']['value']);
        $this->assertEquals(100, $data['economy']['gross_transaction_value']['previous']);
        $this->assertSame(['Gloria Grill'], collect($data['popularity']['top'])->pluck('name')->all());
        $this->assertEquals(300, collect($data['trend']['points'])->sum('gross_value'));
        $this->assertSame('2026-11-01', $data['period']['from']);
        $this->assertSame('2026-10-01', $data['period']['previous_from']);
    }

    public function test_the_municipality_comes_from_the_account_not_the_request(): void
    {
        $this->completedOrder($this->roxasCafe, 700, Carbon::create(2026, 11, 5, 12, 0, 0, 'Asia/Manila'));

        $data = $this->analytics(['period' => 'this_month', 'municipality_id' => $this->roxas->id])->assertOk()->json('data');

        $this->assertSame('Gloria', $data['municipality']['name']);
        $this->assertEquals(0, $data['economy']['gross_transaction_value']['value']);
        $this->assertSame(1, $data['overview']['businesses']['total']);
    }

    public function test_platform_only_figures_are_not_exposed(): void
    {
        $this->completedOrder($this->gloriaGrill, 300, Carbon::create(2026, 11, 5, 12, 0, 0, 'Asia/Manila'));

        $data = $this->analytics(['period' => 'this_month'])->assertOk()->json('data');

        foreach (['financial', 'municipalities', 'system', 'alerts', 'activity'] as $key) {
            $this->assertArrayNotHasKey($key, $data, "{$key} is platform-wide and must not reach a municipal office");
        }
        $this->assertArrayNotHasKey('cashouts', $data['overview']);
        foreach (['platform_revenue', 'operating_expenses', 'net_income', 'earnings_today', 'earnings_this_month', 'cashouts', 'cod_remitted', 'rider_cash_advances'] as $key) {
            $this->assertArrayNotHasKey($key, $data['economy']);
        }
        $this->assertEqualsCanonicalizing(['date', 'gross_value', 'transactions'], array_keys($data['trend']['points'][0]));
        $this->assertArrayNotHasKey('businesses', $data['popularity']);
    }

    public function test_recommendations_link_to_the_municipal_portal(): void
    {
        DB::table('businesses')->where('id', $this->gloriaGrill->id)->update(['updated_at' => now()->subDays(120)]);

        $data = $this->analytics(['period' => 'this_month'])->assertOk()->json('data');

        $links = collect($data['opportunities'])->pluck('link')->filter();
        $this->assertNotEmpty($links);
        $links->each(fn ($l) => $this->assertStringStartsWith('/municipal/businesses/', $l));
    }

    public function test_only_municipal_officers_can_read_it_and_periods_are_validated(): void
    {
        $this->getJson('/api/municipal/dashboard/analytics')->assertUnauthorized();
        foreach ([User::ROLE_TOURIST, User::ROLE_BUSINESS_OWNER, User::ROLE_RIDER] as $role) {
            $this->actingAs($this->user($role, $this->gloria), 'sanctum')->getJson('/api/municipal/dashboard/analytics')->assertForbidden();
        }

        $this->analytics(['period' => 'forever'])->assertStatus(422);
        $this->analytics(['period' => 'custom'])->assertStatus(422);
        $this->analytics(['period' => 'custom', 'from' => '2025-01-01', 'to' => '2026-11-18'])->assertStatus(422);
        $this->analytics(['period' => 'custom', 'from' => '2026-11-01', 'to' => '2026-11-10'])->assertOk()->assertJsonPath('data.period.key', 'custom');
    }

    // ------------------------------------------------------------------

    private function analytics(array $query)
    {
        return $this->actingAs($this->officer, 'sanctum')->getJson('/api/municipal/dashboard/analytics?'.http_build_query($query));
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

    private function recordView(Business $business, string $viewer, string $day): void
    {
        BusinessEngagementEvent::query()->insert(['business_id' => $business->id, 'type' => 'profile_view', 'viewer_key' => hash('sha256', $viewer), 'viewed_on' => $day, 'created_at' => now()]);
    }
}
