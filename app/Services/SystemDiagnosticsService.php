<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\BookingDispatchLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\SystemIncident;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

/**
 * Bansud Tourism Office — System Diagnostics.
 *
 * Detects failures from real signals (database, scheduler heartbeat, queue,
 * automation backlogs, rider / trip state, refunds, transaction integrity,
 * application error log, configuration) and offers FIXES from a fixed
 * allow-list. Every fix runs an existing canonical command or service — the
 * same code the scheduler or the rider's own diagnostics already run — so no
 * business rule is bypassed:
 *
 *   automation  dispatch:process-offer-timeouts, schedule:dispatch,
 *               orders:advance-preparation (acceptance gate still applies)
 *   refunds     payments:reconcile-refunds (provider-authoritative, never a
 *               duplicate refund, never marks refunded without PayMongo)
 *   orders      orders:repair-ready-items --apply
 *   riders      RiderDiagnosticsService repair (stale "busy" → available)
 *   trips       TripPathDiagnostics fixes (re-sync derived state only)
 *   platform    queue retry / process, storage:link, optimize:clear
 *
 * Never fixed here (they need a person): a rider with two open deliveries,
 * failed transaction-integrity checks (never "fixed" by re-signing), pending
 * migrations, missing configuration, a stopped scheduler or socket process.
 * Every fix is written to the activity log.
 */
class SystemDiagnosticsService
{
    public const HEARTBEAT_KEY = 'system_diagnostics:scheduler_heartbeat';

    public const ERRORS_REVIEWED_KEY = 'system_diagnostics:errors_reviewed_at';

    /** Scheduler tasks run every minute; older than this means it stopped. */
    private const HEARTBEAT_STALE_SECONDS = 180;

    private const LIVE_EXCLUDED = ['completed', 'cancelled'];

    private const MAX_TRIPS_SCANNED = 100;

    /** @var array<string, array{label: string, description: string, confirm?: bool, danger?: bool}> */
    public const ACTIONS = [
        'run_automation' => ['label' => 'Run automation now', 'description' => 'Runs the every-minute tasks once: expire overdue rider offers, dispatch due scheduled deliveries, start eligible preparations and finish due preparation timers.'],
        'process_offer_timeouts' => ['label' => 'Expire overdue offers', 'description' => 'Runs dispatch:process-offer-timeouts — expires overdue rider offers and moves dispatch on to the next rider.'],
        'dispatch_scheduled' => ['label' => 'Dispatch due deliveries', 'description' => 'Runs schedule:dispatch — offers due scheduled deliveries to the nearest eligible rider.'],
        'advance_preparation' => ['label' => 'Start preparations', 'description' => 'Runs orders:advance-preparation — starts preparation only where a rider has accepted (the acceptance rule still applies) and finishes due timers.'],
        'reconcile_refunds' => ['label' => 'Reconcile refunds with PayMongo', 'description' => 'Runs payments:reconcile-refunds — asks PayMongo for the real refund state. Never issues a second refund and never marks a refund done without PayMongo.'],
        'repair_ready_items' => ['label' => 'Mark items ready', 'description' => 'Runs orders:repair-ready-items --apply — marks the restaurant\'s own items ready on orders that are already READY.'],
        'release_stale_riders' => ['label' => 'Release riders', 'description' => 'Runs the rider diagnostics repair: riders marked "busy" with no open delivery become available again.'],
        'resync_trips' => ['label' => 'Re-sync trips', 'description' => 'Runs trip diagnostics fixes: re-syncs pickup stops and arrival state to what was actually recorded. Never marks a step done that was not.'],
        'retry_failed_jobs' => ['label' => 'Retry failed jobs', 'description' => 'Puts every failed background job back on the queue (queue:retry all).'],
        'clear_failed_jobs' => ['label' => 'Clear failed jobs', 'description' => 'Deletes the failed-job records (queue:flush). Use only after reviewing them; they cannot be retried afterwards.', 'confirm' => true, 'danger' => true],
        'process_queue' => ['label' => 'Process queued jobs', 'description' => 'Works through waiting background jobs now (up to 50 jobs or 20 seconds).'],
        'verify_integrity' => ['label' => 'Verify again', 'description' => 'Re-verifies transaction histories changed in the last 48 hours (read-only check; it never re-signs or changes records).'],
        'storage_link' => ['label' => 'Create storage link', 'description' => 'Runs storage:link so uploaded photos and documents are served again.'],
        'clear_caches' => ['label' => 'Clear caches', 'description' => 'Runs optimize:clear — clears configuration, route, view and application caches.'],
        'acknowledge_errors' => ['label' => 'Mark as reviewed', 'description' => 'Marks the logged errors so far as reviewed; only new errors will be counted.'],
    ];

    public function __construct(
        private ScheduledDispatchProcessor $scheduled,
        private PreparationStartService $preparation,
        private TripPathDiagnostics $trips,
        private RiderDiagnosticsService $riders,
    ) {}

    /** @return array{generated_at: string, summary: array{ok: int, warning: int, error: int}, checks: list<array<string, mixed>>, recent_fixes: list<array<string, mixed>>} */
    public function run(): array
    {
        $this->realtime = null;
        $checks = [];
        foreach ([
            'checkDatabase', 'checkScheduler', 'checkQueue', 'checkRealtime', 'checkStorage', 'checkConfiguration', 'checkMigrations',
            'checkOfferTimeouts', 'checkScheduledDispatch', 'checkPreparationStarts', 'checkPreparationTimers',
            'checkStaleRiders', 'checkDoubleDeliveries', 'checkTrips', 'checkReadyItems',
            'checkRefunds', 'checkIntegrity', 'checkErrorLog',
        ] as $method) {
            try {
                $checks[] = $this->{$method}();
            } catch (Throwable $e) {
                // A broken check is itself a finding; it never hides the others.
                $checks[] = $this->check(Str::snake(substr($method, 5)), 'platform', Str::headline(substr($method, 5)), 'error',
                    'This check could not run: '.Str::limit($e->getMessage(), 200));
            }
        }

        $this->syncIncidents($checks);

        $summary = ['ok' => 0, 'warning' => 0, 'error' => 0];
        foreach ($checks as $c) {
            $summary[$c['status'] === 'error' ? 'error' : ($c['status'] === 'warning' ? 'warning' : 'ok')]++;
        }

        return [
            'generated_at' => now()->toIso8601String(),
            'summary' => $summary,
            'health' => $this->health(),
            'checks' => $checks,
            'recent_fixes' => $this->recentFixes(),
        ];
    }

    // ------------------------------------------------------------------
    // Health measures: measured values against targets, and a 0-100 score
    // ------------------------------------------------------------------

    /** Service-quality window. */
    public const HEALTH_WINDOW_DAYS = 7;

    /**
     * Quantitative health: each measure is a real figure compared with a
     * target (ok / warning / error), or "idle" when there is no data yet.
     * Score = average of measured items (ok 100, warning 60, error 0).
     *
     * @return array{score: ?int, grade: string, window: string, measures: list<array<string, mixed>>}
     */
    public function health(): array
    {
        $measures = [];
        foreach (['measureDatabase', 'measureRealtime', 'measureScheduler', 'measureQueueBacklog', 'measureFailedJobs', 'measureDisk', 'measureErrors',
            'measureDispatchSuccess', 'measureTimeToRider', 'measureOnTime', 'measureCompletion', 'measurePayments', 'measureGps'] as $method) {
            try {
                $measures[] = $this->{$method}();
            } catch (Throwable $e) {
                $measures[] = $this->measure(Str::snake(substr($method, 7)), 'performance', Str::headline(substr($method, 7)), null, 'Unavailable', '—', 'idle',
                    'Could not be measured: '.Str::limit($e->getMessage(), 120));
            }
        }

        $scored = array_filter($measures, fn ($m) => $m['status'] !== 'idle');
        $score = $scored ? (int) round(array_sum(array_map(fn ($m) => ['ok' => 100, 'warning' => 60, 'error' => 0][$m['status']], $scored)) / count($scored)) : null;
        $grade = match (true) {
            $score === null => 'Not enough data',
            $score >= 90 => 'Excellent',
            $score >= 75 => 'Good',
            $score >= 50 => 'Fair',
            default => 'Poor',
        };

        return ['score' => $score, 'grade' => $grade, 'window' => 'Last '.self::HEALTH_WINDOW_DAYS.' days', 'measures' => $measures];
    }

    private function measureDatabase(): array
    {
        $start = microtime(true);
        DB::select('select 1');
        $ms = (int) round((microtime(true) - $start) * 1000);

        return $this->measure('db_latency', 'performance', 'Database response', $ms, "{$ms} ms", '≤ 100 ms',
            $this->lowerIsBetter($ms, 100, 500), 'Time for the database to answer a query.', ratio: min(1, $ms / 500));
    }

    private function measureRealtime(): array
    {
        [$ok, $ms] = $this->realtimeProbe();

        return $ok
            ? $this->measure('realtime_latency', 'performance', 'Realtime server response', $ms, "{$ms} ms", '≤ 300 ms',
                $this->lowerIsBetter($ms, 300, 1500), 'Live tracking and notifications server.', ratio: min(1, $ms / 1500))
            : $this->measure('realtime_latency', 'performance', 'Realtime server response', null, 'Unreachable', '≤ 300 ms', 'error', 'Live tracking and notifications server is not answering.', ratio: 1);
    }

    private function measureScheduler(): array
    {
        $age = $this->heartbeatAge();

        return $age === null
            ? $this->measure('scheduler_lag', 'performance', 'Scheduler last tick', null, 'Never', '≤ 2 min', 'error', 'The scheduler has not ticked since diagnostics were added.', ratio: 1)
            : $this->measure('scheduler_lag', 'performance', 'Scheduler last tick', $age, $this->ago($age), '≤ 2 min',
                $this->lowerIsBetter($age, 120, 300), 'Background automation runs every minute.', ratio: min(1, $age / 300));
    }

    private function measureQueueBacklog(): array
    {
        $waiting = 0;
        if (config('queue.default') === 'database' && Schema::hasTable('jobs')) {
            $waiting = DB::table('jobs')->where('created_at', '<=', now()->subMinutes(5)->getTimestamp())->count();
        }

        return $this->measure('queue_backlog', 'performance', 'Queue backlog', $waiting, number_format($waiting).' waiting', '0 over 5 min',
            $this->lowerIsBetter($waiting, 0, 20), 'Background jobs waiting more than 5 minutes.', ratio: min(1, $waiting / 20));
    }

    private function measureFailedJobs(): array
    {
        $failed = Schema::hasTable('failed_jobs') ? DB::table('failed_jobs')->where('failed_at', '>=', now()->subDay())->count() : 0;

        return $this->measure('failed_jobs', 'performance', 'Failed jobs (24 h)', $failed, number_format($failed), '0',
            $this->lowerIsBetter($failed, 0, 5), 'Background jobs that failed in the last 24 hours.', ratio: min(1, $failed / 5));
    }

    private function measureDisk(): array
    {
        $free = @disk_free_space(storage_path());
        $total = @disk_total_space(storage_path());
        if (! $free || ! $total) {
            return $this->measure('disk_free', 'performance', 'Free disk space', null, 'Unknown', '≥ 15% or 20 GB', 'idle', 'Disk size could not be read.');
        }
        $pct = round($free / $total * 100, 1);
        $gb = round($free / 1073741824, 1);
        // Absolute space matters as much as the share on a large shared disk.
        $status = ($pct >= 15 || $gb >= 20) ? 'ok' : (($pct >= 5 || $gb >= 5) ? 'warning' : 'error');

        return $this->measure('disk_free', 'performance', 'Free disk space', $pct, "{$gb} GB ({$pct}%)", '≥ 15% or 20 GB',
            $status, "{$gb} GB free of ".round($total / 1073741824, 1).' GB.', ratio: $pct / 100);
    }

    private function measureErrors(): array
    {
        $count = array_sum(array_column($this->recentLogErrors(now()->subDay()), 'count'));

        return $this->measure('error_rate', 'performance', 'Errors (24 h)', $count, number_format($count), '0',
            $this->lowerIsBetter($count, 0, 10), 'Errors written to the application log in the last 24 hours.', ratio: min(1, $count / 10));
    }

    private function measureDispatchSuccess(): array
    {
        $rows = Delivery::where('dispatch_ended_at', '>=', $this->windowStart())
            ->whereIn('dispatch_end_reason', ['rider_accepted', 'no_rider_accepted', 'invalid_pickup_coordinates'])
            ->selectRaw('dispatch_end_reason, COUNT(*) as total')->groupBy('dispatch_end_reason')->pluck('total', 'dispatch_end_reason');
        $accepted = (int) ($rows['rider_accepted'] ?? 0);
        $total = (int) $rows->sum();

        return $this->rate('dispatch_success', 'Dispatch success', $accepted, $total, 90, 70,
            "{$accepted} of {$total} dispatches found a rider (cancelled orders excluded).");
    }

    private function measureTimeToRider(): array
    {
        // The clock starts when dispatch could start: the order time, or the
        // scheduled time for a delivery booked for later.
        $minutes = Delivery::whereNotNull('assigned_at')->where('assigned_at', '>=', $this->windowStart())
            ->orderByDesc('id')->limit(2000)->get(['created_at', 'scheduled_at', 'assigned_at'])
            ->map(function ($d) {
                $start = $d->scheduled_at && $d->scheduled_at->gt($d->created_at) ? $d->scheduled_at : $d->created_at;

                return max(0, $start->diffInSeconds($d->assigned_at, false)) / 60;
            })->sort()->values();
        if ($minutes->isEmpty()) {
            return $this->measure('time_to_rider', 'service', 'Time to find a rider', null, 'No data', '≤ 5 min', 'idle', 'No rider was assigned in the window.');
        }
        $n = $minutes->count();
        $median = round($n % 2 ? (float) $minutes[intdiv($n, 2)] : ((float) $minutes[$n / 2 - 1] + (float) $minutes[$n / 2]) / 2, 1);

        $display = $median >= 120 ? round($median / 60, 1).' h' : "{$median} min";

        return $this->measure('time_to_rider', 'service', 'Time to find a rider', $median, $display, '≤ 5 min',
            $this->lowerIsBetter($median, 5, 15), "Median from order to rider assignment ({$minutes->count()} deliveries).", ratio: min(1, $median / 15));
    }

    private function measureOnTime(): array
    {
        $rows = Delivery::whereNotNull('assigned_at')->whereNotNull('delivered_at')->where('delivered_at', '>=', $this->windowStart())
            ->orderByDesc('id')->limit(2000)->get(['assigned_at', 'delivered_at']);
        $onTime = $rows->filter(fn ($d) => $d->assigned_at->diffInMinutes($d->delivered_at) <= 60)->count();

        return $this->rate('on_time', 'On-time delivery', $onTime, $rows->count(), 90, 75,
            "{$onTime} of {$rows->count()} delivered within 60 minutes of rider assignment.");
    }

    private function measureCompletion(): array
    {
        $rows = Order::where('updated_at', '>=', $this->windowStart())
            ->whereIn('status', ['delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected'])
            ->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total', 'status');
        $done = (int) (($rows['delivered'] ?? 0) + ($rows['completed'] ?? 0));
        $total = (int) $rows->sum();

        return $this->rate('order_completion', 'Order completion', $done, $total, 90, 75,
            "{$done} of {$total} finished orders were completed (the rest were cancelled or rejected).");
    }

    private function measurePayments(): array
    {
        $rows = Payment::where('created_at', '>=', $this->windowStart())->whereNotIn('status', ['pending'])
            ->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total', 'status');
        $failed = (int) ($rows['failed'] ?? 0);
        $total = (int) $rows->sum();

        return $this->rate('payment_success', 'Payment success', $total - $failed, $total, 95, 85,
            ($total - $failed)." of {$total} settled payments succeeded (payments still pending are excluded).");
    }

    private function measureGps(): array
    {
        $online = User::where('role', User::ROLE_RIDER)
            ->whereHas('riderDetail', fn ($q) => $q->whereIn('rider_status', [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE, User::RIDER_STATUS_BUSY]))
            ->pluck('id');
        if ($online->isEmpty()) {
            return $this->measure('gps_freshness', 'service', 'Rider GPS freshness', null, 'No riders online', '≥ 90%', 'idle', 'Measured while riders are online.');
        }
        $fresh = DB::table('rider_locations')->whereIn('rider_id', $online)->where('recorded_at', '>=', now()->subMinutes(2))->distinct()->count('rider_id');

        return $this->rate('gps_freshness', 'Rider GPS freshness', $fresh, $online->count(), 90, 60,
            "{$fresh} of {$online->count()} online riders sent a location in the last 2 minutes.", window: false);
    }

    private function rate(string $key, string $label, int $good, int $total, float $okAt, float $warnAt, string $hint, bool $window = true): array
    {
        if ($total === 0) {
            return $this->measure($key, 'service', $label, null, 'No data', "≥ {$okAt}%", 'idle', $window ? 'Nothing to measure in the last '.self::HEALTH_WINDOW_DAYS.' days.' : 'Nothing to measure right now.');
        }
        $pct = round($good / $total * 100, 1);

        return $this->measure($key, 'service', $label, $pct, "{$pct}%", "≥ {$okAt}%", $this->higherIsBetter($pct, $okAt, $warnAt), $hint, ratio: $pct / 100);
    }

    private function lowerIsBetter(float $value, float $okMax, float $warnMax): string
    {
        return $value <= $okMax ? 'ok' : ($value <= $warnMax ? 'warning' : 'error');
    }

    private function higherIsBetter(float $value, float $okMin, float $warnMin): string
    {
        return $value >= $okMin ? 'ok' : ($value >= $warnMin ? 'warning' : 'error');
    }

    private function windowStart(): Carbon
    {
        return now()->subDays(self::HEALTH_WINDOW_DAYS);
    }

    /** @param  'performance'|'service'  $group */
    private function measure(string $key, string $group, string $label, int|float|null $value, string $display, string $target, string $status, string $hint, ?float $ratio = null): array
    {
        return compact('key', 'group', 'label', 'value', 'display', 'target', 'status', 'hint') + ['ratio' => $ratio === null ? null : round(max(0, min(1, $ratio)), 3)];
    }

    /** One realtime probe per diagnostics run: [reachable, milliseconds]. */
    private ?array $realtime = null;

    private function realtimeProbe(): array
    {
        if ($this->realtime === null) {
            $start = microtime(true);
            try {
                $ok = Http::timeout(2)->get(rtrim((string) config('socket.server_url'), '/').'/healthz')->successful();
            } catch (Throwable) {
                $ok = false;
            }
            $this->realtime = [$ok, (int) round((microtime(true) - $start) * 1000)];
        }

        return $this->realtime;
    }

    /**
     * Run one allow-listed fix, log it, then re-run the diagnostics.
     *
     * @return array{action: string, message: string, output: string, diagnostics: array}
     *
     * @throws InvalidArgumentException for an unknown action
     */
    public function fix(string $action, User $admin): array
    {
        if (! array_key_exists($action, self::ACTIONS)) {
            throw new InvalidArgumentException('Unknown diagnostics action.');
        }

        [$message, $output] = match ($action) {
            'run_automation' => $this->runAutomation(),
            'process_offer_timeouts' => $this->artisan('dispatch:process-offer-timeouts', [], 'Overdue offers processed.'),
            'dispatch_scheduled' => $this->artisan('schedule:dispatch', [], 'Due scheduled deliveries processed.'),
            'advance_preparation' => $this->artisan('orders:advance-preparation', [], 'Preparation check run.'),
            'reconcile_refunds' => $this->artisan('payments:reconcile-refunds', [], 'Refunds reconciled with PayMongo.'),
            'repair_ready_items' => $this->artisan('orders:repair-ready-items', ['--apply' => true], 'READY orders repaired.'),
            'release_stale_riders' => $this->releaseStaleRiders($admin),
            'resync_trips' => $this->resyncTrips($admin),
            'retry_failed_jobs' => $this->artisan('queue:retry', ['id' => ['all']], 'Failed jobs queued again.'),
            'clear_failed_jobs' => $this->artisan('queue:flush', [], 'Failed-job records cleared.'),
            'process_queue' => $this->artisan('queue:work', ['--stop-when-empty' => true, '--max-jobs' => 50, '--max-time' => 20, '--tries' => 1], 'Queued jobs processed.'),
            'verify_integrity' => $this->artisan('integrity:verify', ['--hours' => 48], 'Transaction histories verified.'),
            'storage_link' => $this->artisan('storage:link', [], 'Storage link checked.'),
            'clear_caches' => $this->artisan('optimize:clear', [], 'Caches cleared.'),
            'acknowledge_errors' => $this->acknowledgeErrors(),
        };

        ActivityLog::create([
            'user_id' => $admin->id,
            'action' => 'system_diagnostics.fix',
            'type' => 'system',
            'description' => self::ACTIONS[$action]['label'].': '.$message,
        ]);

        // Problems this fix cleared are closed in the incident history with who fixed them.
        $this->justFixed = ['label' => self::ACTIONS[$action]['label'], 'admin' => $admin];
        try {
            $diagnostics = $this->run();
        } finally {
            $this->justFixed = null;
        }

        return ['action' => $action, 'message' => $message, 'output' => Str::limit(trim($output), 4000), 'diagnostics' => $diagnostics];
    }

    /** Set while the diagnostics re-run right after a fix. */
    private ?array $justFixed = null;

    /**
     * Incident history: a failing check opens ONE incident (not one per page
     * view); when the check passes again the incident is closed — "fixed with
     * …" after a fix from this page, otherwise "recovered".
     */
    private function syncIncidents(array $checks): void
    {
        try {
            foreach ($checks as $c) {
                $code = 'diagnostics_'.$c['key'];
                $fingerprint = sha1("diagnostics|{$code}|{$c['key']}");
                $open = fn () => SystemIncident::where('fingerprint', $fingerprint)->where('status', SystemIncident::STATUS_OPEN);

                if ($c['status'] === 'ok') {
                    if ($open()->exists()) {
                        $open()->update([
                            'status' => SystemIncident::STATUS_RESOLVED,
                            'resolved_at' => now(),
                            'resolved_by' => $this->justFixed['admin']->id ?? null,
                            'resolution' => $this->justFixed
                                ? 'Fixed with “'.$this->justFixed['label'].'” by '.$this->justFixed['admin']->name.' (System Diagnostics).'
                                : 'Recovered — this check passed again.',
                        ]);
                    }

                    continue;
                }

                if (! $open()->exists()) {
                    SystemIncidentRecorder::record(
                        'diagnostics', $code, $c['status'] === 'error' ? 'error' : 'warning',
                        $c['title'].': '.Str::limit($c['summary'], 200),
                        $c['details'] ? implode("\n", $c['details']) : null,
                        ['check' => $c['key'], 'count' => $c['count']],
                        fingerprintKey: $c['key'],
                        withActor: false,
                    );
                }
            }
        } catch (Throwable) {
            // History is best-effort; the diagnostics still answer.
        }
    }

    // ------------------------------------------------------------------
    // Platform
    // ------------------------------------------------------------------

    private function checkDatabase(): array
    {
        $start = microtime(true);
        DB::select('select 1');
        $ms = (int) round((microtime(true) - $start) * 1000);

        return $this->check('database', 'platform', 'Database', $ms > 500 ? 'warning' : 'ok',
            $ms > 500 ? "The database is slow to answer ({$ms} ms)." : "Connected · answered in {$ms} ms.");
    }

    private function checkScheduler(): array
    {
        $age = $this->heartbeatAge();
        if ($age === null) {
            return $this->check('scheduler', 'automation', 'Scheduler', 'error',
                'The scheduler has not run since diagnostics were added. Automatic dispatch, offer timeouts, preparation timers and refund reconciliation are not running.',
                ['Start it on the server: php artisan schedule:work (keep it running).', 'Until then you can run the automation once from here.'],
                fixes: ['run_automation']);
        }
        if ($age > self::HEARTBEAT_STALE_SECONDS) {
            return $this->check('scheduler', 'automation', 'Scheduler', 'error',
                'The scheduler stopped '.$this->ago($age).'. Automatic dispatch, offer timeouts, preparation timers and refund reconciliation are paused.',
                ['Restart it on the server: php artisan schedule:work.', 'Until then you can run the automation once from here.'],
                fixes: ['run_automation']);
        }

        return $this->check('scheduler', 'automation', 'Scheduler', 'ok', 'Running · last tick '.$this->ago($age).'.');
    }

    private function checkQueue(): array
    {
        $failed = Schema::hasTable('failed_jobs') ? DB::table('failed_jobs')->count() : 0;
        $recent = $failed ? DB::table('failed_jobs')->orderByDesc('id')->limit(5)->get(['id', 'queue', 'exception', 'failed_at']) : collect();
        $details = $recent->map(fn ($j) => "#{$j->id} ({$j->queue}, ".Carbon::parse($j->failed_at)->diffForHumans().'): '.Str::limit(strtok((string) $j->exception, "\n"), 160))->all();

        $connection = (string) config('queue.default');
        $waiting = 0;
        if ($connection === 'database' && Schema::hasTable('jobs')) {
            $waiting = DB::table('jobs')->where('created_at', '<=', now()->subMinutes(5)->getTimestamp())->count();
        }

        if ($failed > 0) {
            return $this->check('queue', 'platform', 'Background jobs', 'warning',
                "{$failed} background job(s) failed.", $details, $failed, ['retry_failed_jobs', 'clear_failed_jobs']);
        }
        if ($waiting > 0) {
            return $this->check('queue', 'platform', 'Background jobs', 'warning',
                "{$waiting} job(s) have waited more than 5 minutes — no queue worker seems to be running.",
                ['Start a worker on the server: php artisan queue:work.'], $waiting, ['process_queue']);
        }

        return $this->check('queue', 'platform', 'Background jobs', 'ok',
            $connection === 'sync' ? 'Jobs run immediately (sync queue) · no failures.' : 'No failed or stuck jobs.');
    }

    private function checkRealtime(): array
    {
        [$ok] = $this->realtimeProbe();

        return $ok
            ? $this->check('realtime', 'platform', 'Realtime server', 'ok', 'Live tracking and notifications server is reachable.')
            : $this->check('realtime', 'platform', 'Realtime server', 'error',
                'The live tracking / notifications server is not reachable. Riders and tourists fall back to refreshing, but live maps and pings stop.',
                ['Start it on the server: node socket-server.js (or the socket container).']);
    }

    private function checkStorage(): array
    {
        $path = public_path('storage');
        // A Windows junction (what storage:link makes there) is neither is_link() nor
        // is_dir() to PHP, but it exists and resolves.
        $linked = is_link($path) || is_dir($path) || (file_exists($path) && @readlink($path) !== false);
        $free = @disk_free_space(storage_path());
        $details = $free !== false ? ['Free disk space: '.round($free / 1073741824, 1).' GB'] : [];

        if (! $linked) {
            return $this->check('storage', 'platform', 'File storage', 'error',
                'Uploaded photos and documents cannot be shown: the public storage link is missing.', $details, fixes: ['storage_link']);
        }
        if ($free !== false && $free < 1073741824) {
            return $this->check('storage', 'platform', 'File storage', 'warning', 'Less than 1 GB of disk space is left.', $details);
        }

        return $this->check('storage', 'platform', 'File storage', 'ok', 'Uploads are served · '.($details[0] ?? 'disk space unknown').'.', fixes: []);
    }

    private function checkConfiguration(): array
    {
        $problems = [];
        if (! filled(config('services.paymongo.secret_key'))) {
            $problems[] = 'PayMongo secret key is missing — GCash payments and refunds cannot run.';
        }
        if (! filled(config('services.paymongo.webhook_secret'))) {
            $problems[] = 'PayMongo webhook secret is missing — payment confirmations cannot be verified.';
        }
        if (app()->environment('production') && config('app.debug')) {
            $problems[] = 'Debug mode is on in production — error pages can show internal details.';
        }

        return $problems
            ? $this->check('configuration', 'platform', 'Configuration', 'warning', count($problems).' configuration problem(s).',
                [...$problems, 'Set these in the server environment (.env), then clear caches.'], count($problems), ['clear_caches'])
            : $this->check('configuration', 'platform', 'Configuration', 'ok', 'Payments and environment settings are in place.', fixes: ['clear_caches']);
    }

    private function checkMigrations(): array
    {
        $migrator = app('migrator');
        if (! $migrator->repositoryExists()) {
            return $this->check('migrations', 'platform', 'Database updates', 'warning',
                'The migration history table is missing, so pending database updates cannot be checked.');
        }
        $ran = $migrator->getRepository()->getRan();
        $files = array_keys($migrator->getMigrationFiles([database_path('migrations')]));
        $pending = array_values(array_diff($files, $ran));

        return $pending
            ? $this->check('migrations', 'platform', 'Database updates', 'warning',
                count($pending).' database update(s) have not been applied.',
                [...array_slice($pending, 0, 5), 'Apply them on the server after review (never from this page).'], count($pending))
            : $this->check('migrations', 'platform', 'Database updates', 'ok', 'The database is up to date.');
    }

    // ------------------------------------------------------------------
    // Automation backlogs (handled every minute while the scheduler runs)
    // ------------------------------------------------------------------

    private function checkOfferTimeouts(): array
    {
        $count = BookingDispatchLog::where('response', 'pending')
            ->whereNotNull('expires_at')->where('expires_at', '<=', now()->subSeconds(15))->count();

        return $this->backlog('offer_timeouts', 'Rider offer timeouts', $count, 'rider offer(s) expired but were not moved on to the next rider.', 'process_offer_timeouts');
    }

    private function checkScheduledDispatch(): array
    {
        $count = count($this->scheduled->dueDeliveryIds());

        return $this->backlog('scheduled_dispatch', 'Delivery dispatch', $count, 'delivery(ies) are due for dispatch to a rider.', 'dispatch_scheduled');
    }

    private function checkPreparationStarts(): array
    {
        $count = $this->preparation->eligibleWaitingOrderIds()->count();

        return $this->backlog('preparation_starts', 'Preparation start', $count, 'order(s) have an accepted rider but the restaurant has not been moved to preparing.', 'advance_preparation');
    }

    private function checkPreparationTimers(): array
    {
        $count = Order::where('status', 'preparing')->whereNotNull('predicted_ready_at')->where('predicted_ready_at', '<=', now()->subMinute())->count();

        return $this->backlog('preparation_timers', 'Preparation timers', $count, 'order(s) passed their preparation timer but are not marked ready.', 'advance_preparation');
    }

    /** Backlogs are normal for under a minute while the scheduler runs; an error when it does not. */
    private function backlog(string $key, string $title, int $count, string $what, string $fix): array
    {
        if ($count === 0) {
            return $this->check($key, 'automation', $title, 'ok', 'Nothing waiting.');
        }
        $age = $this->heartbeatAge();
        if ($age !== null && $age <= self::HEARTBEAT_STALE_SECONDS) {
            return $this->check($key, 'automation', $title, 'ok', "{$count} {$what} The scheduler handles these within a minute.", count: $count, fixes: [$fix]);
        }

        return $this->check($key, 'automation', $title, 'error', "{$count} {$what} The scheduler is not running, so they are stuck.", count: $count, fixes: [$fix]);
    }

    // ------------------------------------------------------------------
    // Riders and trips
    // ------------------------------------------------------------------

    private function staleBusyRiders()
    {
        return User::query()->where('role', User::ROLE_RIDER)
            ->whereHas('riderDetail', fn ($q) => $q->where('rider_status', User::RIDER_STATUS_BUSY))
            ->whereDoesntHave('deliveries', fn ($q) => $q->whereNotIn('status', self::LIVE_EXCLUDED))
            ->get(['id', 'name']);
    }

    private function checkStaleRiders(): array
    {
        $riders = $this->staleBusyRiders();

        return $riders->isEmpty()
            ? $this->check('stale_riders', 'operations', 'Rider availability', 'ok', 'No rider is stuck as "busy".')
            : $this->check('stale_riders', 'operations', 'Rider availability', 'warning',
                $riders->count().' rider(s) are marked "busy" with no open delivery, so they receive no new offers.',
                $riders->take(8)->map(fn ($r) => $r->name)->all(), $riders->count(), ['release_stale_riders']);
    }

    private function checkDoubleDeliveries(): array
    {
        $rows = Delivery::query()->whereNotNull('rider_id')->whereNotIn('status', self::LIVE_EXCLUDED)
            ->groupBy('rider_id')->havingRaw('COUNT(*) > 1')->selectRaw('rider_id, COUNT(*) as total')->get();

        if ($rows->isEmpty()) {
            return $this->check('double_deliveries', 'operations', 'One delivery per rider', 'ok', 'Every rider has at most one open delivery.');
        }
        $names = User::whereIn('id', $rows->pluck('rider_id'))->pluck('name', 'id');

        return $this->check('double_deliveries', 'operations', 'One delivery per rider', 'error',
            $rows->count().' rider(s) have more than one open delivery. This breaks the one-active-delivery rule and needs a person to release the extra delivery.',
            $rows->map(fn ($r) => ($names[$r->rider_id] ?? "Rider #{$r->rider_id}")." — {$r->total} open deliveries")->all(),
            $rows->count(), link: '/admin/live/deliveries');
    }

    /** @return array{0: list<array{delivery: Delivery, label: string, fixable: list<string>, review: list<string>}>, 1: int} */
    private function scanTrips(): array
    {
        $deliveries = Delivery::query()->whereNotNull('rider_id')->whereNotIn('status', ['delivered', ...self::LIVE_EXCLUDED])
            ->orderBy('id')->limit(self::MAX_TRIPS_SCANNED)->get();
        $rows = [];
        foreach ($deliveries as $delivery) {
            $d = $this->trips->diagnose($delivery, false, null, log: false);
            if (! $d['covered']) {
                continue;
            }
            $fixable = collect($d['findings'])->filter(fn ($f) => $f['kind'] === TripPathDiagnostics::FIX && $f['status'] !== 'ok')->pluck('message')->all();
            $review = collect($d['findings'])->filter(fn ($f) => $f['kind'] === TripPathDiagnostics::PERSON && $f['status'] === 'needs_action' && $f['code'] === 'pickups_skipped')->pluck('message')->all();
            if ($fixable || $review) {
                $rows[] = ['delivery' => $delivery, 'label' => (string) ($d['order_number'] ?? "#{$delivery->id}"), 'fixable' => $fixable, 'review' => $review];
            }
        }

        return [$rows, $deliveries->count()];
    }

    private function checkTrips(): array
    {
        [$rows, $scanned] = $this->scanTrips();
        $fixable = array_values(array_filter($rows, fn ($r) => $r['fixable']));
        $review = array_values(array_filter($rows, fn ($r) => $r['review']));

        if (! $rows) {
            return $this->check('trips', 'operations', 'Active trips', 'ok', "{$scanned} active trip(s) checked · all consistent.");
        }
        $details = [
            ...array_map(fn ($r) => "{$r['label']}: ".$r['fixable'][0], array_slice($fixable, 0, 6)),
            ...array_map(fn ($r) => "{$r['label']} (needs review): ".$r['review'][0], array_slice($review, 0, 4)),
        ];

        return $this->check('trips', 'operations', 'Active trips', $review ? 'error' : 'warning',
            trim(($fixable ? count($fixable).' trip(s) have state that disagrees with what was recorded. ' : '')
                .($review ? count($review).' trip(s) moved on before every pickup was confirmed and need review.' : '')),
            $details, count($rows), $fixable ? ['resync_trips'] : [], '/admin/live/deliveries');
    }

    private function checkReadyItems(): array
    {
        $orders = Order::query()->where('status', 'ready')
            ->whereHas('items', fn ($q) => $q->whereNotIn('status', ['cancelled', 'rejected', 'ready'])->where(fn ($w) => $w
                ->whereNull('business_id')->orWhereColumn('order_items.business_id', 'orders.business_id')))
            ->pluck('order_number');

        return $orders->isEmpty()
            ? $this->check('ready_items', 'operations', 'Ready orders', 'ok', 'Every READY order has its items ready.')
            : $this->check('ready_items', 'operations', 'Ready orders', 'warning',
                $orders->count().' READY order(s) still show items as not ready, which can block pickup.', $orders->take(8)->all(), $orders->count(), ['repair_ready_items']);
    }

    // ------------------------------------------------------------------
    // Payments and integrity
    // ------------------------------------------------------------------

    private function checkRefunds(): array
    {
        $payments = Payment::where('status', 'pending_refund')->where('updated_at', '<=', now()->subMinutes(45))->count();
        $requests = Refund::where('status', 'requested')->where('created_at', '<=', now()->subMinutes(45))->count();
        $total = $payments + $requests;

        return $total === 0
            ? $this->check('refunds', 'payments', 'Refunds', 'ok', 'No refund has been waiting on PayMongo for more than 45 minutes.')
            : $this->check('refunds', 'payments', 'Refunds', 'warning',
                "{$total} refund(s) have been waiting for a PayMongo result for more than 45 minutes.",
                array_filter([$payments ? "{$payments} payment(s) pending refund" : null, $requests ? "{$requests} refund request(s) not confirmed" : null]),
                $total, ['reconcile_refunds']);
    }

    private function checkIntegrity(): array
    {
        if (! Schema::hasTable('transaction_integrity_checks')) {
            return $this->check('integrity', 'integrity', 'Transaction integrity', 'warning', 'Transaction integrity tables are not installed.');
        }
        $latest = DB::table('transaction_integrity_checks')->where('created_at', '>=', now()->subDays(7))
            ->whereIn('id', DB::table('transaction_integrity_checks')->selectRaw('MAX(id)')->groupBy('blueprint_id'))
            ->whereIn('result', ['flag', 'block'])->count();
        $last = DB::table('transaction_integrity_checks')->max('created_at');
        $when = $last ? 'last verified '.Carbon::parse($last)->diffForHumans() : 'not verified yet';

        return $latest > 0
            ? $this->check('integrity', 'integrity', 'Transaction integrity', 'error',
                "{$latest} transaction history(ies) failed verification ({$when}). Records may have been changed outside the app.",
                ['This is never fixed by re-signing: review the affected orders in the transaction ledger.', 'You can verify again after a correction.'], $latest, ['verify_integrity'])
            : $this->check('integrity', 'integrity', 'Transaction integrity', 'ok', "Every recent transaction history verifies · {$when}.", fixes: ['verify_integrity']);
    }

    // ------------------------------------------------------------------
    // Application errors
    // ------------------------------------------------------------------

    private function checkErrorLog(): array
    {
        $since = now()->subDay();
        $reviewed = Cache::get(self::ERRORS_REVIEWED_KEY);
        if ($reviewed && Carbon::parse($reviewed)->gt($since)) {
            $since = Carbon::parse($reviewed);
        }
        $errors = $this->recentLogErrors($since);
        $count = array_sum(array_column($errors, 'count'));

        if ($count === 0) {
            return $this->check('error_log', 'errors', 'Application errors', 'ok', 'No errors logged in the last 24 hours'.($reviewed ? ' since the last review' : '').'.');
        }

        return $this->check('error_log', 'errors', 'Application errors', $count >= 25 ? 'error' : 'warning',
            "{$count} error(s) logged".($reviewed && Carbon::parse($reviewed)->gt(now()->subDay()) ? ' since the last review.' : ' in the last 24 hours.'),
            array_map(fn ($e) => "×{$e['count']} · {$e['last']} · {$e['message']}", array_slice($errors, 0, 6)), $count, ['acknowledge_errors', 'clear_caches']);
    }

    /** @return list<array{message: string, count: int, last: string}> grouped, newest first */
    private function recentLogErrors(Carbon $since): array
    {
        $files = glob(storage_path('logs/laravel*.log')) ?: [];
        usort($files, fn ($a, $b) => filemtime($b) <=> filemtime($a));
        $file = $files[0] ?? null;
        if (! $file || ! is_readable($file)) {
            return [];
        }

        $size = filesize($file);
        $handle = fopen($file, 'rb');
        fseek($handle, max(0, $size - 1_048_576)); // last 1 MB
        $text = (string) stream_get_contents($handle);
        fclose($handle);

        preg_match_all('/^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})[^\]]*\] ([\w-]+)\.(ERROR|CRITICAL|ALERT|EMERGENCY): (.+)$/m', $text, $m, PREG_SET_ORDER);
        $groups = [];
        foreach ($m as [, $at, $env, , $message]) {
            // Test runs write to the same log as "testing.*" — not the app's errors.
            if ($env !== app()->environment()) {
                continue;
            }
            $time = Carbon::parse($at, config('app.timezone'));
            if ($time->lt($since)) {
                continue;
            }
            // Drop the JSON context and long paths; keep the readable part.
            $clean = Str::limit(trim(preg_replace('/\s+\{.*$/s', '', $message)), 180);
            $key = md5($clean);
            $groups[$key] ??= ['message' => $clean, 'count' => 0, 'last' => ''];
            $groups[$key]['count']++;
            $groups[$key]['last'] = $time->diffForHumans();
        }

        return array_values(array_reverse($groups));
    }

    private function acknowledgeErrors(): array
    {
        Cache::forever(self::ERRORS_REVIEWED_KEY, now()->toIso8601String());

        return ['Errors logged so far are marked as reviewed.', ''];
    }

    // ------------------------------------------------------------------
    // Fix helpers
    // ------------------------------------------------------------------

    /** @return array{0: string, 1: string} */
    private function artisan(string $command, array $args, string $done): array
    {
        try {
            $code = Artisan::call($command, $args);
            $output = Artisan::output();
        } catch (Throwable $e) {
            return ["Failed: {$e->getMessage()}", ''];
        }

        return [$code === 0 ? $done : "Finished with problems (exit code {$code}).", $output];
    }

    private function runAutomation(): array
    {
        $out = [];
        foreach (['dispatch:process-offer-timeouts', 'schedule:dispatch', 'orders:advance-preparation'] as $command) {
            [$msg, $output] = $this->artisan($command, [], 'ok');
            $out[] = "{$command}: ".($msg === 'ok' ? trim($output) ?: 'done' : $msg);
        }

        return ['Automation ran once. Start the scheduler on the server to keep it running.', implode("\n", $out)];
    }

    private function releaseStaleRiders(User $admin): array
    {
        $lines = [];
        foreach ($this->staleBusyRiders() as $rider) {
            $result = $this->riders->run($rider, true);
            $lines[] = "{$rider->name}: ".(($result['repaired'] ?? []) ? implode('; ', $result['repaired']) : 'nothing to repair');
        }

        return [count($lines).' rider(s) checked and repaired.', implode("\n", $lines)];
    }

    private function resyncTrips(User $admin): array
    {
        [$rows] = $this->scanTrips();
        $lines = [];
        foreach ($rows as $row) {
            if (! $row['fixable']) {
                continue;
            }
            $result = $this->trips->diagnose($row['delivery']->fresh(), true, $admin);
            $lines[] = "{$row['label']}: ".($result['repaired'] ? implode('; ', $result['repaired']) : 'nothing changed');
        }

        return [count($lines).' trip(s) re-synced.', implode("\n", $lines)];
    }

    // ------------------------------------------------------------------

    private function heartbeatAge(): ?int
    {
        $beat = Cache::get(self::HEARTBEAT_KEY);

        return $beat ? (int) max(0, Carbon::parse($beat)->diffInSeconds(now())) : null;
    }

    private function ago(int $seconds): string
    {
        return $seconds < 60 ? "{$seconds} s ago" : now()->subSeconds($seconds)->diffForHumans();
    }

    private function recentFixes(): array
    {
        return ActivityLog::with('user:id,name')->where('action', 'system_diagnostics.fix')->latest('id')->take(8)->get()
            ->map(fn (ActivityLog $l) => ['id' => $l->id, 'description' => $l->description, 'by' => $l->user?->name, 'at' => $l->created_at?->toIso8601String()])
            ->all();
    }

    /**
     * @param  list<string>  $details
     * @param  list<string>  $fixes  allow-listed action keys
     */
    private function check(string $key, string $area, string $title, string $status, string $summary, array $details = [], ?int $count = null, array $fixes = [], ?string $link = null): array
    {
        return [
            'key' => $key,
            'area' => $area,
            'title' => $title,
            'status' => $status,
            'summary' => $summary,
            'details' => array_values($details),
            'count' => $count,
            'fixes' => array_map(fn ($a) => ['action' => $a, ...self::ACTIONS[$a]], $fixes),
            'link' => $link,
        ];
    }
}
