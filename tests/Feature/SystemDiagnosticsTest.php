<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\User;
use App\Services\SystemDiagnosticsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Bansud System Diagnostics: real-signal checks, allow-listed fixes that run
 * the canonical commands/services, audit trail, and admin-only access.
 */
class SystemDiagnosticsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Municipality $bansud;
    private bool $socketUp = true;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Http::fake(['*/healthz' => fn () => $this->socketUp ? Http::response('ok', 200) : Http::response('', 503)]);
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->admin = $this->user('bansud_tourism_office', 'Office');
    }

    public function test_runs_every_check_and_summarises_them(): void
    {
        $data = $this->diagnostics()->assertOk()->json('data');

        $keys = collect($data['checks'])->pluck('key')->all();
        foreach (['database', 'scheduler', 'queue', 'realtime', 'storage', 'configuration', 'migrations', 'offer_timeouts', 'scheduled_dispatch',
            'preparation_starts', 'preparation_timers', 'stale_riders', 'double_deliveries', 'trips', 'ready_items', 'refunds', 'integrity', 'error_log'] as $key) {
            $this->assertContains($key, $keys);
        }
        $this->assertSame(count($data['checks']), array_sum($data['summary']));
        $this->assertSame('ok', $this->find($data, 'database')['status']);
        $this->assertSame('ok', $this->find($data, 'realtime')['status']);
    }

    public function test_scheduler_heartbeat_decides_whether_backlogs_are_stuck(): void
    {
        $rider = $this->user('rider', 'Rina');
        $delivery = $this->delivery($this->order('TT-1'), 'waiting');
        BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $rider->id, 'distance_km' => 1, 'response' => 'pending', 'dispatched_at' => now()->subMinutes(5), 'expires_at' => now()->subMinutes(3)]);

        // No heartbeat: the scheduler is down and the overdue offer is stuck.
        $data = $this->diagnostics()->json('data');
        $this->assertSame('error', $this->find($data, 'scheduler')['status']);
        $this->assertSame(['run_automation'], collect($this->find($data, 'scheduler')['fixes'])->pluck('action')->all());
        $offers = $this->find($data, 'offer_timeouts');
        $this->assertSame('error', $offers['status']);
        $this->assertSame(1, $offers['count']);
        $this->assertSame(['process_offer_timeouts'], collect($offers['fixes'])->pluck('action')->all());

        // Fresh heartbeat: the same backlog is being handled.
        Cache::forever(SystemDiagnosticsService::HEARTBEAT_KEY, now()->subSeconds(20)->toIso8601String());
        $data = $this->diagnostics()->json('data');
        $this->assertSame('ok', $this->find($data, 'scheduler')['status']);
        $this->assertSame('ok', $this->find($data, 'offer_timeouts')['status']);

        // A stale heartbeat (scheduler stopped) is an error again.
        Cache::forever(SystemDiagnosticsService::HEARTBEAT_KEY, now()->subMinutes(10)->toIso8601String());
        $this->assertSame('error', $this->find($this->diagnostics()->json('data'), 'scheduler')['status']);
    }

    public function test_stale_busy_rider_is_detected_and_released_through_rider_diagnostics(): void
    {
        $stuck = $this->user('rider', 'Stuck Rider');
        RiderDetail::create(['user_id' => $stuck->id, 'rider_status' => 'busy']);
        $working = $this->user('rider', 'Working Rider');
        RiderDetail::create(['user_id' => $working->id, 'rider_status' => 'busy']);
        $this->delivery($this->order('TT-2'), 'picked_up', $working);

        $check = $this->find($this->diagnostics()->json('data'), 'stale_riders');
        $this->assertSame('warning', $check['status']);
        $this->assertSame(['Stuck Rider'], $check['details']);

        $result = $this->fix('release_stale_riders')->assertOk()->json('data');

        $this->assertSame('available', $stuck->riderDetail()->value('rider_status'));
        $this->assertSame('busy', $working->riderDetail()->value('rider_status'));
        $this->assertSame('ok', $this->find($result['diagnostics'], 'stale_riders')['status']);
        $this->assertDatabaseHas('activity_logs', ['action' => 'system_diagnostics.fix', 'user_id' => $this->admin->id]);
        $this->assertSame('Release riders: 1 rider(s) checked and repaired.', $result['diagnostics']['recent_fixes'][0]['description']);
    }

    public function test_two_open_deliveries_for_one_rider_is_an_error_with_no_automatic_fix(): void
    {
        $rider = $this->user('rider', 'Double Rider');
        $this->delivery($this->order('TT-3'), 'assigned', $rider);
        $this->delivery($this->order('TT-4'), 'picked_up', $rider);

        $check = $this->find($this->diagnostics()->json('data'), 'double_deliveries');
        $this->assertSame('error', $check['status']);
        $this->assertSame([], $check['fixes']);
        $this->assertStringContainsString('Double Rider — 2 open deliveries', $check['details'][0]);
    }

    public function test_ready_order_with_items_not_ready_is_repaired_by_the_canonical_command(): void
    {
        $order = $this->order('TT-5');
        $order->forceFill(['status' => 'ready'])->save();
        $itemId = DB::table('order_items')->insertGetId(['order_id' => $order->id, 'product_name' => 'Adobo', 'quantity' => 1, 'unit_price' => 100, 'subtotal' => 100, 'status' => 'preparing', 'created_at' => now(), 'updated_at' => now()]);

        $check = $this->find($this->diagnostics()->json('data'), 'ready_items');
        $this->assertSame('warning', $check['status']);
        $this->assertSame(['TT-5'], $check['details']);

        $this->fix('repair_ready_items')->assertOk();

        $this->assertSame('ready', DB::table('order_items')->where('id', $itemId)->value('status'));
    }

    public function test_refunds_waiting_on_paymongo_offer_reconciliation(): void
    {
        $payment = Payment::create(['payment_number' => 'PAY-'.Str::random(6), 'payable_type' => Order::class, 'payable_id' => $this->order('TT-6')->id, 'user_id' => $this->admin->id, 'amount' => 100, 'method' => 'gcash', 'provider' => 'paymongo', 'status' => 'pending_refund']);
        DB::table('payments')->where('id', $payment->id)->update(['updated_at' => now()->subHours(2)]);

        $check = $this->find($this->diagnostics()->json('data'), 'refunds');
        $this->assertSame('warning', $check['status']);
        $this->assertSame(['reconcile_refunds'], collect($check['fixes'])->pluck('action')->all());
    }

    public function test_failed_integrity_is_never_offered_a_re_sign_fix(): void
    {
        // Creating an order opens its transaction history; flag its latest verification.
        $order = $this->order('TT-7');
        $blueprint = DB::table('transaction_blueprints')->where('order_id', $order->id)->value('id')
            ?? DB::table('transaction_blueprints')->insertGetId(['blueprint_uid' => (string) Str::uuid(), 'transaction_type' => 'food_delivery', 'order_id' => $order->id, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('transaction_integrity_checks')->insert(['blueprint_id' => $blueprint, 'result' => 'flag', 'checks' => '[]', 'context' => 'scheduled', 'created_at' => now()]);

        $check = $this->find($this->diagnostics()->json('data'), 'integrity');
        $this->assertSame('error', $check['status']);
        $this->assertSame(['verify_integrity'], collect($check['fixes'])->pluck('action')->all());
    }

    public function test_realtime_server_down_is_reported(): void
    {
        $this->socketUp = false;

        $this->assertSame('error', $this->find($this->diagnostics()->json('data'), 'realtime')['status']);
    }

    public function test_reviewing_errors_and_guarded_actions(): void
    {
        $this->fix('acknowledge_errors')->assertOk();
        $this->assertNotNull(Cache::get(SystemDiagnosticsService::ERRORS_REVIEWED_KEY));

        $this->fix('format_disk')->assertStatus(422);
        $this->fix('clear_failed_jobs')->assertStatus(422); // destructive: needs confirm
        $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/system/diagnostics/fix', ['action' => 'clear_failed_jobs', 'confirm' => true])->assertOk();
    }

    public function test_health_measures_compare_real_figures_with_targets(): void
    {
        Cache::forever(SystemDiagnosticsService::HEARTBEAT_KEY, now()->subSeconds(30)->toIso8601String());
        $rider = $this->user('rider', 'Rina');

        // Dispatch: 3 found a rider, 1 did not (75 % → warning); a cancelled order is excluded.
        foreach (['rider_accepted', 'rider_accepted', 'rider_accepted', 'no_rider_accepted', 'order_cancelled'] as $i => $reason) {
            $d = $this->delivery($this->order("TT-D{$i}"), 'completed', $reason === 'rider_accepted' ? $rider : null);
            $d->forceFill(['dispatch_ended_at' => now()->subDay(), 'dispatch_end_reason' => $reason])->save();
        }
        // Time to a rider: 2, 4, 30 min → median 4 (ok). On time: 2 of 3 within 60 min.
        foreach ([[2, 30], [4, 50], [30, 95]] as $i => [$assignAfter, $deliverAfter]) {
            $d = $this->delivery($this->order("TT-T{$i}"), 'completed', $rider);
            $created = now()->subHours(5);
            DB::table('deliveries')->where('id', $d->id)->update([
                'created_at' => $created, 'assigned_at' => $created->copy()->addMinutes($assignAfter), 'delivered_at' => $created->copy()->addMinutes($assignAfter + $deliverAfter),
            ]);
        }
        // A scheduled delivery: the clock starts at the scheduled time, not when it was booked.
        $later = $this->delivery($this->order('TT-S'), 'completed', $rider);
        DB::table('deliveries')->where('id', $later->id)->update(['created_at' => now()->subDays(2), 'scheduled_at' => now()->subHours(3), 'assigned_at' => now()->subHours(3)->addMinutes(3)]);

        $health = $this->diagnostics()->assertOk()->json('data.health');
        $m = collect($health['measures'])->keyBy('key');

        $this->assertSame(75.0, (float) $m['dispatch_success']['value']);
        $this->assertSame('warning', $m['dispatch_success']['status']);
        $this->assertSame('≥ 90%', $m['dispatch_success']['target']);
        $this->assertSame(3.5, (float) $m['time_to_rider']['value']); // 2, 3, 4, 30 → (3 + 4) / 2
        $this->assertSame('ok', $m['time_to_rider']['status']);
        $this->assertSame('ok', $m['scheduler_lag']['status']);
        $this->assertSame('ok', $m['realtime_latency']['status']);
        $this->assertSame('idle', $m['payment_success']['status']); // no payments yet
        $this->assertSame('idle', $m['gps_freshness']['status']);   // no riders online

        // Score = average of measured items (ok 100, warning 60, error 0); idle ones are not counted.
        $scored = $m->reject(fn ($x) => $x['status'] === 'idle');
        $expected = (int) round($scored->map(fn ($x) => ['ok' => 100, 'warning' => 60, 'error' => 0][$x['status']])->avg());
        $this->assertSame($expected, $health['score']);
        $this->assertContains($health['grade'], ['Excellent', 'Good', 'Fair', 'Poor']);
        $this->assertSame('Last 7 days', $health['window']);
    }

    public function test_gps_freshness_and_payment_success_rates(): void
    {
        $fresh = $this->user('rider', 'Fresh');
        RiderDetail::create(['user_id' => $fresh->id, 'rider_status' => 'available']);
        DB::table('rider_locations')->insert(['rider_id' => $fresh->id, 'latitude' => 12.86, 'longitude' => 121.45, 'recorded_at' => now()->subSeconds(30), 'created_at' => now(), 'updated_at' => now()]);
        $stale = $this->user('rider', 'Stale');
        RiderDetail::create(['user_id' => $stale->id, 'rider_status' => 'online']);

        foreach (['paid', 'paid', 'paid', 'failed', 'pending'] as $i => $status) {
            Payment::create(['payment_number' => "PAY-H{$i}", 'payable_type' => Order::class, 'payable_id' => $this->order("TT-P{$i}")->id, 'user_id' => $this->admin->id, 'amount' => 100, 'method' => 'gcash', 'provider' => 'paymongo', 'status' => $status]);
        }

        $m = collect($this->diagnostics()->json('data.health.measures'))->keyBy('key');

        $this->assertSame(50.0, (float) $m['gps_freshness']['value']);
        $this->assertSame('error', $m['gps_freshness']['status']); // below 60 %
        $this->assertSame(75.0, (float) $m['payment_success']['value']); // pending excluded
        $this->assertSame('error', $m['payment_success']['status']);   // below 85 %
    }

    public function test_only_the_bansud_tourism_office_can_use_diagnostics(): void
    {
        $this->getJson('/api/admin/system/diagnostics')->assertUnauthorized();
        foreach (['tourism_office', 'business_owner', 'rider', 'tourist'] as $role) {
            $user = $this->user($role, ucfirst($role));
            $this->actingAs($user, 'sanctum')->getJson('/api/admin/system/diagnostics')->assertForbidden();
            $this->actingAs($user, 'sanctum')->postJson('/api/admin/system/diagnostics/fix', ['action' => 'clear_caches'])->assertForbidden();
        }
    }

    // ------------------------------------------------------------------

    private function diagnostics()
    {
        return $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/system/diagnostics');
    }

    private function fix(string $action)
    {
        return $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/system/diagnostics/fix', ['action' => $action]);
    }

    private function find(array $data, string $key): array
    {
        return collect($data['checks'])->firstWhere('key', $key);
    }

    private function user(string $role, string $name): User
    {
        return User::create([
            'name' => $name, 'email' => Str::lower($role.'.'.Str::random(8)).'@example.com', 'password' => 'Password123!',
            'role' => $role, 'account_status' => 'approved', 'municipality_id' => $this->bansud->id,
        ]);
    }

    private function order(string $number): Order
    {
        return Order::create(['order_number' => $number, 'customer_name' => 'Ana', 'order_type' => 'delivery', 'total' => 100, 'subtotal' => 100]);
    }

    private function delivery(Order $order, string $status, ?User $rider = null): Delivery
    {
        return Delivery::create(['order_id' => $order->id, 'status' => $status, 'rider_id' => $rider?->id, 'pickup_address' => 'Pag-asa, Bansud', 'delivery_address' => 'Poblacion, Bansud']);
    }

}
