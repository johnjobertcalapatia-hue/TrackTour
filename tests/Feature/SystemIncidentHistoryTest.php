<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\RiderDetail;
use App\Models\SystemIncident;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\SystemDiagnosticsService;
use App\Services\SystemIncidentRecorder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Mockery;
use RuntimeException;
use Tests\TestCase;

/**
 * Incident history: every failure is recorded (logins, uploads, server
 * errors, access, payments, refunds, jobs, dispatch, diagnostics), filterable,
 * and closed with a record of the fix.
 */
class SystemIncidentHistoryTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $bansud;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        RateLimiter::clear('x');
        Http::fake(['*/healthz' => Http::response('ok', 200)]);
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->admin = $this->user('bansud_tourism_office', 'Office', 'office@example.com');

        // Test-only endpoints for upload validation and crashes.
        Route::middleware('api')->post('/api/_incident-test/upload', fn (Request $r) => $r->validate(['photo' => ['required', 'image', 'max:1']]) ? 'ok' : 'ok');
        Route::middleware('api')->post('/api/_incident-test/crash', fn () => throw new RuntimeException('Disk write failed'));
    }

    public function test_failed_logins_are_recorded_without_the_password_and_a_lockout_opens_a_problem(): void
    {
        $this->postJson('/api/login', ['email' => 'nobody@example.com', 'password' => 'Secret123!'])->assertStatus(422);
        $user = $this->user('tourist', 'Ana', 'ana@example.com');
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/login', ['email' => 'ana@example.com', 'password' => 'Wrong-pass1!']);
        }

        $failed = SystemIncident::where('code', 'login_failed')->get();
        $this->assertCount(6, $failed);
        $this->assertSame('Failed login: no account for this email', $failed->first()->title);
        $this->assertSame('nobody@example.com', $failed->first()->context['email']);
        $this->assertSame(SystemIncident::STATUS_RECORDED, $failed->first()->status);
        $this->assertSame($user->id, $failed->last()->user_id);
        $this->assertStringNotContainsString('Wrong-pass1!', SystemIncident::all()->toJson());

        $locked = SystemIncident::where('code', 'account_locked')->sole();
        $this->assertSame(SystemIncident::STATUS_OPEN, $locked->status);
        $this->assertSame('error', $locked->severity);

        // The Security page now shows the real count instead of 0.
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/system/security')->assertJsonPath('data.failed_logins_today', 6);
    }

    public function test_rejected_and_crashed_uploads_and_server_errors_are_recorded(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->post('/api/_incident-test/upload', ['photo' => UploadedFile::fake()->create('menu.pdf', 50, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertStatus(422);

        $rejected = SystemIncident::where('code', 'upload_rejected')->sole();
        $this->assertSame('upload', $rejected->category);
        $this->assertSame(['photo'], $rejected->context['fields']);
        $this->assertSame('menu.pdf', $rejected->context['files'][0]['name']);
        $this->assertSame($this->admin->id, $rejected->user_id);
        $this->assertSame('/api/_incident-test/upload', $rejected->path);

        $this->post('/api/_incident-test/crash', ['photo' => UploadedFile::fake()->image('a.jpg')], ['Accept' => 'application/json'])->assertStatus(500);
        $this->postJson('/api/_incident-test/crash')->assertStatus(500);

        $this->assertSame('An upload failed on the server', SystemIncident::where('code', 'upload_failed')->sole()->title);
        $server = SystemIncident::where('code', 'server_error')->sole();
        $this->assertSame(SystemIncident::STATUS_OPEN, $server->status);
        $this->assertSame('Disk write failed', $server->message);
        $this->assertSame(RuntimeException::class, $server->context['exception']);
    }

    public function test_access_denied_payments_refunds_jobs_and_dispatch_failures_are_recorded(): void
    {
        $tourist = $this->user('tourist', 'Tina', 'tina@example.com');
        $this->actingAs($tourist, 'sanctum')->getJson('/api/admin/system/incidents')->assertForbidden();
        $denied = SystemIncident::where('code', 'access_denied')->sole();
        $this->assertSame('tourist', $denied->context['role']);

        $order = $this->order('TT-1');
        $payment = Payment::create(['payment_number' => 'PAY-1', 'payable_type' => Order::class, 'payable_id' => $order->id, 'user_id' => $tourist->id, 'amount' => 250, 'method' => 'gcash', 'provider' => 'paymongo', 'status' => 'pending']);
        $payment->update(['status' => 'failed']);
        $paymentIncident = SystemIncident::where('code', 'payment_failed')->sole();
        $this->assertSame($tourist->id, $paymentIncident->user_id);
        $this->assertTrue($paymentIncident->subject->is($payment));

        $refund = Refund::create(['payment_id' => $payment->id, 'amount' => 100, 'status' => 'pending', 'reason' => 'Test']);
        $refund->update(['status' => 'failed']);
        $this->assertSame(SystemIncident::STATUS_OPEN, SystemIncident::where('code', 'refund_failed')->sole()->status);

        $job = Mockery::mock(\Illuminate\Contracts\Queue\Job::class);
        $job->shouldReceive('resolveName')->andReturn('App\\Jobs\\SendReceipt');
        $job->shouldReceive('getQueue')->andReturn('default');
        event(new JobFailed('database', $job, new RuntimeException('SMTP down')));
        $this->assertSame('Background task failed: SendReceipt', SystemIncident::where('code', 'job_failed')->sole()->title);

        $delivery = Delivery::create(['order_id' => $this->order('TT-2')->id, 'status' => 'waiting', 'pickup_address' => 'A', 'delivery_address' => 'B']);
        app(NearestRiderService::class)->failDispatch($delivery, 'no_rider_accepted');
        $dispatch = SystemIncident::where('code', 'dispatch_no_rider')->sole();
        $this->assertSame(SystemIncident::STATUS_OPEN, $dispatch->status);
        $this->assertTrue($dispatch->subject->is($delivery));
    }

    public function test_diagnostics_open_one_incident_per_problem_and_close_it_with_the_fix(): void
    {
        $rider = $this->user('rider', 'Stuck Rider', 'stuck@example.com');
        RiderDetail::create(['user_id' => $rider->id, 'rider_status' => 'busy']);

        $this->diagnostics();
        $this->diagnostics();
        $stale = SystemIncident::where('code', 'diagnostics_stale_riders')->sole(); // not one per page view
        $this->assertSame(SystemIncident::STATUS_OPEN, $stale->status);
        $this->assertNull($stale->user_id);
        $this->assertSame(SystemIncident::STATUS_OPEN, SystemIncident::where('code', 'diagnostics_scheduler')->sole()->status);

        $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/system/diagnostics/fix', ['action' => 'release_stale_riders'])->assertOk();
        $stale->refresh();
        $this->assertSame(SystemIncident::STATUS_RESOLVED, $stale->status);
        $this->assertSame('Fixed with “Release riders” by Office (System Diagnostics).', $stale->resolution);
        $this->assertSame($this->admin->id, $stale->resolved_by);

        // Recovering on its own is recorded too.
        Cache::forever(SystemDiagnosticsService::HEARTBEAT_KEY, now()->toIso8601String());
        $this->diagnostics();
        $this->assertSame('Recovered — this check passed again.', SystemIncident::where('code', 'diagnostics_scheduler')->sole()->resolution);
    }

    public function test_history_filters_and_counts(): void
    {
        $this->incident('auth', 'login_failed', 'warning', SystemIncident::STATUS_RECORDED, 'Failed login: wrong password', '2026-11-10 09:00:00', ['email' => 'ana@example.com']);
        $this->incident('payment', 'payment_failed', 'warning', SystemIncident::STATUS_RECORDED, 'Payment failed: PAY-9', '2026-11-12 09:00:00');
        $this->incident('server', 'server_error', 'error', SystemIncident::STATUS_OPEN, 'Server error: QueryException', '2026-11-15 09:00:00');
        $this->incident('server', 'server_error', 'critical', SystemIncident::STATUS_RESOLVED, 'Server error: TypeError', '2026-11-16 09:00:00');

        $all = $this->list([])->assertOk();
        $this->assertSame(4, $all->json('meta.total'));
        $this->assertSame('Server error: TypeError', $all->json('data.0.title')); // newest first
        $this->assertEquals(['auth' => 1, 'payment' => 1, 'server' => 2], $all->json('meta.by_category'));

        $this->assertSame(['Server error: TypeError', 'Server error: QueryException'], collect($this->list(['category' => 'server'])->json('data'))->pluck('title')->all());
        $this->assertSame(2, $this->list(['category' => 'auth,payment'])->json('meta.total'));
        $this->assertSame(['Server error: QueryException'], collect($this->list(['status' => 'open'])->json('data'))->pluck('title')->all());
        $this->assertSame(['Server error: TypeError'], collect($this->list(['severity' => 'critical'])->json('data'))->pluck('title')->all());
        $this->assertSame(['Failed login: wrong password'], collect($this->list(['q' => 'ana@example'])->json('data'))->pluck('title')->all());
        $this->assertSame(['Payment failed: PAY-9'], collect($this->list(['from' => '2026-11-11', 'to' => '2026-11-13'])->json('data'))->pluck('title')->all());
        // Category counts follow the other filters.
        $this->assertEquals(['server' => 1], $this->list(['status' => 'open'])->json('meta.by_category'));
        $this->assertSame(1, $this->list([])->json('meta.stats.open'));

        $this->list(['status' => 'weird'])->assertStatus(422);
        $this->list(['from' => '2026-11-13', 'to' => '2026-11-11'])->assertStatus(422);
    }

    public function test_marking_fixed_dismissing_and_reopening_keep_the_record(): void
    {
        $a = $this->incident('server', 'server_error', 'error', SystemIncident::STATUS_OPEN, 'Server error: QueryException', '2026-11-15 09:00:00', [], 'same');
        $b = $this->incident('server', 'server_error', 'error', SystemIncident::STATUS_OPEN, 'Server error: QueryException', '2026-11-16 09:00:00', [], 'same');
        $other = $this->incident('jobs', 'job_failed', 'error', SystemIncident::STATUS_OPEN, 'Background task failed', '2026-11-16 10:00:00');

        $show = $this->actingAs($this->admin, 'sanctum')->getJson("/api/admin/system/incidents/{$a->id}")->assertOk();
        $this->assertSame(2, $show->json('data.similar.total'));
        $this->assertSame(2, $show->json('data.similar.open'));

        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/system/incidents/{$a->id}/resolve", [])->assertStatus(422); // a note is required
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/system/incidents/{$a->id}/resolve", ['note' => 'Restarted MySQL service.', 'include_similar' => true])
            ->assertOk()->assertJsonPath('data.status', 'resolved')->assertJsonPath('data.resolved_by', 'Office')->assertJsonPath('message', '2 incident(s) marked as fixed.');
        $this->assertSame('Restarted MySQL service.', $b->fresh()->resolution);
        // Fixing never rewrites when it happened (MySQL ON UPDATE guard in the migration).
        $this->assertSame('2026-11-15 09:00:00', $a->fresh()->occurred_at->timezone('Asia/Manila')->format('Y-m-d H:i:s'));
        $this->assertSame('open', $other->fresh()->status);
        $this->assertDatabaseHas('activity_logs', ['action' => 'system_incident.resolved', 'user_id' => $this->admin->id]);

        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/system/incidents/{$other->id}/dismiss", [])->assertOk()->assertJsonPath('data.status', 'dismissed');
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/system/incidents/{$other->id}/reopen")->assertOk()->assertJsonPath('data.status', 'open');
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/system/incidents/{$other->id}/reopen")->assertStatus(422);

        // Resolution history keeps every step, oldest first, even after a reopen.
        $history = $this->actingAs($this->admin, 'sanctum')->getJson("/api/admin/system/incidents/{$other->id}")->json('data.history');
        $this->assertSame(['dismissed', 'reopened'], array_column($history, 'action'));
        $this->assertSame('Office', $history[0]['by']);
        $recent = $this->actingAs($this->admin, 'sanctum')->getJson("/api/admin/system/incidents/{$b->id}")->json('data.similar.recent.0');
        $this->assertSame(['status' => 'resolved', 'resolved_by' => 'Office', 'resolution' => 'Restarted MySQL service.'], array_intersect_key($recent, array_flip(['status', 'resolved_by', 'resolution'])));
    }

    public function test_only_the_bansud_office_can_read_or_change_the_history(): void
    {
        $i = $this->incident('server', 'server_error', 'error', SystemIncident::STATUS_OPEN, 'x', '2026-11-15 09:00:00');
        $this->getJson('/api/admin/system/incidents')->assertUnauthorized();
        foreach (['tourism_office', 'business_owner', 'rider', 'tourist'] as $role) {
            $u = $this->user($role, ucfirst($role), Str::random(6).'@example.com');
            $this->actingAs($u, 'sanctum')->getJson('/api/admin/system/incidents')->assertForbidden();
            $this->actingAs($u, 'sanctum')->postJson("/api/admin/system/incidents/{$i->id}/resolve", ['note' => 'nope'])->assertForbidden();
        }
        $this->assertSame('open', $i->fresh()->status);
    }

    public function test_recorder_hides_secrets_and_never_throws(): void
    {
        $incident = SystemIncidentRecorder::record('server', 'test', 'info', 'T', null, ['password' => 'x', 'access_token' => 'y', 'shipping_fee' => 50, 'nested' => ['pin' => '1234', 'note' => 'ok']]);
        $this->assertSame(['password' => '[hidden]', 'access_token' => '[hidden]', 'shipping_fee' => 50, 'nested' => ['pin' => '[hidden]', 'note' => 'ok']], $incident->context);

        \Illuminate\Support\Facades\Schema::drop('system_incidents');
        $this->assertNull(SystemIncidentRecorder::record('server', 'test', 'info', 'T')); // no exception
    }

    // ------------------------------------------------------------------

    private function diagnostics()
    {
        return $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/system/diagnostics')->assertOk();
    }

    private function list(array $query)
    {
        return $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/system/incidents?'.http_build_query($query));
    }

    private function incident(string $category, string $code, string $severity, string $status, string $title, string $at, array $context = [], ?string $key = null): SystemIncident
    {
        return SystemIncident::create([
            'category' => $category, 'code' => $code, 'severity' => $severity, 'status' => $status, 'title' => $title, 'context' => $context ?: null,
            'fingerprint' => sha1($category.'|'.$code.'|'.($key ?? Str::random())), 'occurred_at' => \Carbon\Carbon::parse($at, 'Asia/Manila')->utc(),
        ]);
    }

    private function user(string $role, string $name, string $email): User
    {
        return User::create(['name' => $name, 'email' => $email, 'password' => 'Password123!', 'role' => $role, 'account_status' => 'approved', 'municipality_id' => $this->bansud->id]);
    }

    private function order(string $number): Order
    {
        return Order::create(['order_number' => $number, 'customer_name' => 'Ana', 'order_type' => 'delivery', 'total' => 250, 'subtotal' => 250]);
    }
}
