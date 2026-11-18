<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Bansud dashboard oversight figures (read-only): today, the last seven
 * Philippine days, municipalities at a glance, Bansud rider onboarding and
 * recent activity.
 */
class AdminDashboardOverviewTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Municipality $bansud;
    private Municipality $gloria;

    protected function setUp(): void
    {
        parent::setUp();
        // 2026-11-18 10:00 in Manila.
        Carbon::setTestNow(Carbon::create(2026, 11, 18, 10, 0, 0, 'Asia/Manila'));

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->admin = $this->user('bansud_tourism_office', $this->bansud, 'approved');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_trend_groups_orders_and_paid_revenue_by_philippine_day(): void
    {
        // 2026-11-18 07:30 Manila is 2026-11-17 23:30 UTC — must count as the 18th.
        $this->order(Carbon::create(2026, 11, 18, 7, 30, 0, 'Asia/Manila'));
        $this->order(Carbon::create(2026, 11, 18, 9, 0, 0, 'Asia/Manila'));
        $this->order(Carbon::create(2026, 11, 15, 12, 0, 0, 'Asia/Manila'));
        $this->order(Carbon::create(2026, 11, 1, 12, 0, 0, 'Asia/Manila')); // outside the window

        $this->payment(250.50, 'paid', Carbon::create(2026, 11, 18, 8, 0, 0, 'Asia/Manila'));
        $this->payment(100, 'paid', Carbon::create(2026, 11, 16, 8, 0, 0, 'Asia/Manila'));
        $this->payment(999, 'pending', Carbon::create(2026, 11, 18, 8, 0, 0, 'Asia/Manila')); // not provider-confirmed

        $data = $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/dashboard')->assertOk()->json('data');

        $this->assertCount(7, $data['trend']);
        $this->assertSame('2026-11-12', $data['trend'][0]['date']);
        $this->assertSame('2026-11-18', $data['trend'][6]['date']);
        $byDate = collect($data['trend'])->keyBy('date');
        $this->assertSame(2, $byDate['2026-11-18']['orders']);
        $this->assertSame(1, $byDate['2026-11-15']['orders']);
        $this->assertEqualsWithDelta(250.50, $byDate['2026-11-18']['revenue'], 0.001);
        $this->assertEqualsWithDelta(100.0, $byDate['2026-11-16']['revenue'], 0.001);
        $this->assertSame(2, $data['today']['orders']);
        $this->assertEqualsWithDelta(250.50, $data['today']['revenue'], 0.001);
        $this->assertSame(4, $data['stats']['total_orders']);
    }

    public function test_municipalities_onboarding_and_activity(): void
    {
        $owner = $this->user('business_owner', $this->bansud, 'approved');
        Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->bansud->id, 'business_name' => 'Kainan', 'status' => 'approved']);
        Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->gloria->id, 'business_name' => 'Gloria Grill', 'status' => 'pending']);
        $this->user('tourism_office', $this->gloria, 'approved');

        $waiting = $this->user('rider', $this->bansud, 'pending_review');
        RiderDetail::create(['user_id' => $waiting->id, 'application_status' => 'for_final_approval']);
        $queued = $this->user('rider', $this->bansud, 'pending_review');
        RiderDetail::create(['user_id' => $queued->id, 'application_status' => 'pending_schedule']);
        $this->user('rider', $this->gloria, 'pending_review'); // another municipality's applicant
        $working = $this->user('rider', $this->bansud, 'approved');
        RiderDetail::create(['user_id' => $working->id, 'rider_status' => 'available']);

        ActivityLog::create(['user_id' => $this->admin->id, 'action' => 'business.approved', 'description' => 'Approved Kainan.']);

        $data = $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/dashboard')->assertOk()->json('data');

        $this->assertSame('Bansud', $data['municipalities'][0]['name']);
        $this->assertTrue($data['municipalities'][0]['is_home']);
        $gloria = collect($data['municipalities'])->firstWhere('name', 'Gloria');
        $this->assertSame(1, $gloria['businesses']);
        $this->assertSame(1, $gloria['riders']);
        $this->assertSame(2, $gloria['pending']); // pending business + pending rider
        $this->assertTrue($gloria['has_office']);

        // Bansud's own onboarding only.
        $this->assertSame(['applicants' => 2, 'for_final_approval' => 1, 'pending_schedule' => 1], $data['onboarding']);
        // "available" counts as on duty; the legacy riders_online stays "online" only.
        $this->assertSame(1, $data['stats']['riders_active']);
        $this->assertSame(0, $data['stats']['riders_online']);

        $this->assertSame('Approved Kainan.', $data['recentActivity'][0]['description']);
        $this->assertSame($this->admin->name, $data['recentActivity'][0]['by']);
    }

    public function test_only_the_bansud_admin_can_read_it(): void
    {
        foreach (['tourism_office', 'rider', 'tourist', 'business_owner'] as $role) {
            $this->actingAs($this->user($role, $this->gloria, 'approved'), 'sanctum')
                ->getJson('/api/admin/dashboard')
                ->assertForbidden();
        }
    }

    private function user(string $role, Municipality $municipality, string $status): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(8)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => $status,
            'municipality_id' => $municipality->id,
        ]);
    }

    private function order(Carbon $at): Order
    {
        $order = Order::create(['order_number' => 'ORD-'.Str::upper(Str::random(8)), 'customer_name' => 'A']);
        $order->forceFill(['created_at' => $at->copy()->utc()])->save();

        return $order;
    }

    private function payment(float $amount, string $status, Carbon $paidAt): void
    {
        Payment::create([
            'payment_number' => 'PAY-'.Str::upper(Str::random(8)),
            'payable_type' => Order::class,
            'payable_id' => 1,
            'user_id' => $this->admin->id,
            'amount' => $amount,
            'method' => 'gcash',
            'provider' => 'paymongo',
            'status' => $status,
            'paid_at' => $status === 'paid' ? $paidAt->copy()->utc() : null,
        ]);
    }
}
