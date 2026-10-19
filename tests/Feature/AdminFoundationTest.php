<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\User;
use App\Services\RiderPayoutService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Admin Module Phase 1 - Foundation.
 *
 * Covers the §15 Phase 1 checkpoint items:
 * - KPI/stats dashboard endpoint (orders, deliveries, riders, revenue)
 * - RBAC on every admin surface touched by this phase
 * - audit-trail recording through the canonical ActivityLog::record()
 * - audit-log explorer queries (type/action/search filters)
 * - the previously broken security-log endpoint (non-existent `type` column)
 */
class AdminFoundationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::create([
            'name' => 'Bansud Admin',
            'email' => 'admin.foundation@bansud.gov.ph',
            'password' => 'Password123!',
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'name' => 'Tourist One',
            'email' => 'tourist.foundation@example.com',
            'password' => 'Password123!',
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
    }

    private function makeBusiness(): Business
    {
        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59']]
        );

        return Business::create([
            'owner_id' => User::factory()->create([
                'role' => User::ROLE_BUSINESS_OWNER,
                'account_status' => 'approved',
            ])->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Foundation Test Eatery',
            'status' => 'approved',
            'business_hours' => $allDays,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeTargetUser(string $role = 'tourist'): User
    {
        return User::create([
            'name' => 'Target User',
            'email' => Str::lower(Str::random(8)) . '@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => 'pending',
        ]);
    }

    // ------------------------------------------------------------------
    // KPI / stats endpoint
    // ------------------------------------------------------------------

    public function test_dashboard_exposes_operational_kpis_with_expected_values(): void
    {
        Order::create(['order_number' => 'ORD-KPI-1', 'customer_name' => 'A']);
        Order::create(['order_number' => 'ORD-KPI-2', 'customer_name' => 'B']);

        Delivery::create(['status' => 'waiting']);
        Delivery::create(['status' => 'completed']);

        $rider = User::create([
            'name' => 'Online Rider',
            'email' => 'rider.foundation@example.com',
            'password' => 'Password123!',
            'role' => 'rider',
            'account_status' => 'approved',
        ]);
        RiderDetail::create(['user_id' => $rider->id, 'rider_status' => 'online']);

        $order = Order::first();
        Payment::create([
            'payment_number' => 'PAY-KPI-1',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 100.00,
            'method' => 'gcash',
            'provider' => 'paymongo',
            'status' => 'paid',
        ]);
        Payment::create([
            'payment_number' => 'PAY-KPI-2',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 50.00,
            'method' => 'gcash',
            'provider' => 'paymongo',
            'status' => 'paid',
        ]);
        Payment::create([
            'payment_number' => 'PAY-KPI-3',
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $this->tourist->id,
            'amount' => 999.00,
            'method' => 'gcash',
            'provider' => 'paymongo',
            'status' => 'pending',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/dashboard');

        $response->assertOk()
            ->assertJsonPath('data.stats.total_orders', 2)
            ->assertJsonPath('data.stats.active_deliveries', 1)
            ->assertJsonPath('data.stats.total_riders', 1)
            ->assertJsonPath('data.stats.riders_online', 1);

        $this->assertEqualsWithDelta(
            150.0,
            $response->json('data.stats.total_revenue'),
            0.001
        );
    }

    public function test_dashboard_is_forbidden_for_non_admin_roles(): void
    {
        $roles = ['tourist', 'business_owner', 'rider', 'tourism_office'];

        foreach ($roles as $role) {
            $user = $this->makeTargetUser($role);
            $user->forceFill(['account_status' => 'approved'])->save();

            $this->actingAs($user, 'sanctum')
                ->getJson('/api/admin/dashboard')
                ->assertForbidden();
        }
    }

    // ------------------------------------------------------------------
    // Audit-trail recording (canonical ActivityLog::record)
    // ------------------------------------------------------------------

    public function test_user_approve_records_audit_log(): void
    {
        $target = $this->makeTargetUser();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/users/{$target->id}/approve")
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'user_id' => $this->admin->id,
            'action' => 'user.approved',
            'type' => 'admin',
            'model_type' => User::class,
            'model_id' => $target->id,
        ]);
    }

    public function test_user_reject_with_remarks_records_audit_log(): void
    {
        $target = $this->makeTargetUser();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/users/{$target->id}/reject", [
                'remarks' => 'Incomplete requirements',
            ])
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'user_id' => $this->admin->id,
            'action' => 'user.rejected',
            'type' => 'admin',
            'model_id' => $target->id,
        ]);
    }

    public function test_user_suspend_records_audit_log(): void
    {
        $target = $this->makeTargetUser();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/users/{$target->id}/suspend", [
                'remarks' => 'Policy violation',
            ])
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'action' => 'user.suspended',
            'type' => 'admin',
            'model_id' => $target->id,
        ]);
    }

    public function test_business_approval_records_audit_log(): void
    {
        $business = $this->makeBusiness();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/businesses/{$business->id}/approve")
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'user_id' => $this->admin->id,
            'action' => 'business.approved',
            'type' => 'admin',
            'model_type' => Business::class,
            'model_id' => $business->id,
        ]);
    }

    public function test_rider_approval_records_audit_log(): void
    {
        $rider = $this->makeTargetUser('rider');
        $rider->forceFill(['account_status' => 'approved'])->save();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/riders/{$rider->id}/approve")
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'user_id' => $this->admin->id,
            'action' => 'rider.approved',
            'type' => 'admin',
            'model_id' => $rider->id,
        ]);
    }

    public function test_payout_approval_records_financial_audit_log(): void
    {
        $business = $this->makeBusiness();
        $rider = User::create([
            'name' => 'Payout Rider',
            'email' => 'payout.rider.foundation@example.com',
            'password' => 'Password123!',
            'role' => User::ROLE_RIDER,
            'account_status' => 'approved',
        ]);

        $order = Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust@example.com',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'completed',
            'subtotal' => 300,
            'delivery_fee' => 80,
            'total' => 380,
        ]);

        RiderEarning::create([
            'rider_id' => $rider->id,
            'order_id' => $order->id,
            'delivery_fee' => 80.0,
            'rider_tip' => 0,
            'total_earning' => 80.0,
            'status' => 'earned',
            'earned_at' => now(),
        ]);

        $payout = app(RiderPayoutService::class)->requestPayout($rider);

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/payouts/{$payout->id}/approve")
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'user_id' => $this->admin->id,
            'action' => 'payout.approved',
            'type' => 'financial',
            'model_type' => \App\Models\RiderPayout::class,
            'model_id' => $payout->id,
        ]);
    }

    public function test_governance_mutations_do_not_leak_to_non_admins(): void
    {
        $target = $this->makeTargetUser();

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson("/api/admin/users/{$target->id}/approve")
            ->assertForbidden();

        $this->assertDatabaseMissing('activity_logs', [
            'action' => 'user.approved',
            'model_id' => $target->id,
        ]);
    }

    // ------------------------------------------------------------------
    // Audit-log explorer
    // ------------------------------------------------------------------

    public function test_audit_log_listing_returns_entries_with_user_name(): void
    {
        $target = $this->makeTargetUser();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/users/{$target->id}/approve")
            ->assertOk();

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/audit-logs')
            ->assertOk();

        $this->assertNotEmpty($response->json('data'));
        $this->assertSame('Bansud Admin', $response->json('data.0.user_name'));
        $this->assertSame('user.approved', $response->json('data.0.action'));
        $this->assertNotNull($response->json('meta.total'));
    }

    public function test_audit_log_search_filters_by_action_and_description(): void
    {
        $first = $this->makeTargetUser();
        $second = $this->makeTargetUser();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/users/{$first->id}/approve")
            ->assertOk();
        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/users/{$second->id}/reject", ['remarks' => 'No ID'])
            ->assertOk();

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/audit-logs?search=user.rejected')
            ->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame('user.rejected', $response->json('data.0.action'));

        $byDescription = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/audit-logs?search=' . urlencode('No ID'))
            ->assertOk();

        $this->assertCount(1, $byDescription->json('data'));
    }

    public function test_audit_log_type_and_action_filters_use_valid_columns(): void
    {
        $target = $this->makeTargetUser();
        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/users/{$target->id}/approve")
            ->assertOk();

        $adminRows = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/audit-logs?type=admin')
            ->assertOk();
        $this->assertNotEmpty($adminRows->json('data'));

        $securityRows = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/audit-logs?type=security')
            ->assertOk();
        $this->assertSame([], $securityRows->json('data'));

        $actionRows = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/audit-logs?action=user.approved')
            ->assertOk();
        $this->assertNotEmpty($actionRows->json('data'));
        foreach ($actionRows->json('data') as $row) {
            $this->assertSame('user.approved', $row['action']);
        }
    }

    public function test_audit_logs_forbidden_for_non_admin(): void
    {
        $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/admin/audit-logs')
            ->assertForbidden();
    }

    // ------------------------------------------------------------------
    // Security log endpoint (was a 500: queried a non-existent `type` column)
    // ------------------------------------------------------------------

    public function test_security_logs_endpoint_returns_ok(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/system/security/logs')
            ->assertOk()
            ->assertJsonPath('success', true);
    }

    public function test_security_logs_endpoint_forbidden_for_non_admin(): void
    {
        $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/admin/system/security/logs')
            ->assertForbidden();
    }
}
