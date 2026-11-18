<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\User;
use App\Services\AdminService;
use App\Services\RiderOnboardingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

class AdminDashboardController extends Controller
{
    public function __construct(
        private AdminService $adminService
    ) {}

    public function index(Request $request)
    {
        $stats = $this->adminService->getDashboardStats();

        $usersByRole = User::selectRaw('role, count(*) as count')
            ->groupBy('role')
            ->pluck('count', 'role')
            ->toArray();

        $recentUsers = User::latest()
            ->take(10)
            ->get(['id', 'name', 'email', 'role', 'account_status', 'created_at']);

        $recentBusinesses = Business::latest()
            ->take(10)
            ->get(['id', 'business_name', 'status', 'created_at'])
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->business_name,
                'category' => $b->category?->name ?? 'N/A',
                'municipality' => $b->municipality?->name ?? 'N/A',
                'status' => $b->status,
                'created_at' => $b->created_at,
            ]);

        $businessOwners = User::where('role', User::ROLE_BUSINESS_OWNER)->count();
        $approvedOwners = User::where('role', User::ROLE_BUSINESS_OWNER)
            ->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count();
        $pendingReview = User::where('role', User::ROLE_BUSINESS_OWNER)
            ->where('account_status', User::ACCOUNT_STATUS_PENDING)->count();

        $data = [
            'user' => [
                'id' => $request->user()->id,
                'name' => $request->user()->name,
                'role' => $request->user()->role,
            ],
            'stats' => [
                'total_users' => $stats['total_users'],
                'total_businesses' => $stats['total_businesses'],
                'total_municipalities' => $stats['total_municipalities'],
                'pending_verifications' => $stats['pending_approvals'],
                'business_owners' => $businessOwners,
                'pending_review' => $pendingReview,
                'approved_owners' => $approvedOwners,
                'total_orders' => $stats['total_orders'],
                'active_deliveries' => $stats['active_deliveries'],
                'total_riders' => $stats['total_riders'],
                'riders_online' => $stats['riders_online'],
                'total_revenue' => $stats['total_revenue'],
                // Riders signed in for work (online, available or on a trip).
                'riders_active' => RiderDetail::whereIn('rider_status', [
                    User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE, User::RIDER_STATUS_BUSY,
                ])->count(),
            ],
            'usersByRole' => $usersByRole,
            'recentUsers' => $recentUsers,
            'recentBusinesses' => $recentBusinesses,
        ] + $this->overview();

        return $this->successResponse($data);
    }

    /**
     * Read-only oversight figures for the Bansud dashboard: today, the last
     * seven Philippine days, each municipality at a glance, Bansud rider
     * onboarding and recent administrative activity. Grouping by local date is
     * done in PHP so it is identical on MySQL and SQLite.
     */
    private function overview(): array
    {
        $tz = 'Asia/Manila';
        $today = CarbonImmutable::now($tz)->startOfDay();
        $from = $today->subDays(6);
        $fromUtc = $from->utc();
        $localDay = fn ($at) => $at ? CarbonImmutable::parse($at)->timezone($tz)->toDateString() : null;

        $orders = Order::where('created_at', '>=', $fromUtc)->get(['created_at'])
            ->countBy(fn ($o) => $localDay($o->created_at));
        // Provider-confirmed money (status paid), dated by paid_at when present.
        $revenue = Payment::where('status', 'paid')
            ->where(fn ($q) => $q->where('paid_at', '>=', $fromUtc)->orWhere(fn ($q) => $q->whereNull('paid_at')->where('updated_at', '>=', $fromUtc)))
            ->get(['amount', 'paid_at', 'updated_at'])
            ->groupBy(fn ($p) => $localDay($p->paid_at ?? $p->updated_at))
            ->map(fn ($rows) => round((float) $rows->sum('amount'), 2));

        $trend = [];
        for ($day = $from; $day->lte($today); $day = $day->addDay()) {
            $key = $day->toDateString();
            $trend[] = ['date' => $key, 'orders' => (int) ($orders[$key] ?? 0), 'revenue' => (float) ($revenue[$key] ?? 0)];
        }
        $todayKey = $today->toDateString();

        $municipalities = Municipality::query()
            ->withCount([
                'businesses',
                'businesses as pending_businesses_count' => fn ($q) => $q->where('status', 'pending'),
                'riders',
                'riders as pending_riders_count' => fn ($q) => $q->where('account_status', User::ACCOUNT_STATUS_PENDING),
                'tourismOfficers as office_accounts_count' => fn ($q) => $q->where('account_status', User::ACCOUNT_STATUS_APPROVED),
            ])
            ->orderBy('name')
            ->get()
            ->map(fn (Municipality $m) => [
                'id' => $m->id,
                'name' => $m->name,
                'logo' => $m->logo,
                'is_home' => $m->isHome(),
                'businesses' => $m->businesses_count,
                'riders' => $m->riders_count,
                'pending' => $m->pending_businesses_count + $m->pending_riders_count,
                'has_office' => $m->isHome() || $m->office_accounts_count > 0,
            ])
            ->sortByDesc(fn ($m) => [$m['is_home'], $m['businesses'] + $m['riders']])
            ->values();

        $home = Municipality::whereRaw('LOWER(name) = ?', [strtolower(Municipality::HOME_MUNICIPALITY)])->value('id');
        $applicants = User::where('role', User::ROLE_RIDER)
            ->where('account_status', User::ACCOUNT_STATUS_PENDING)
            ->where('municipality_id', $home)
            ->with('riderDetail:id,user_id,application_status')
            ->get(['id']);
        $byStatus = $applicants->countBy(fn ($u) => $u->riderDetail?->application_status);

        $activity = ActivityLog::with('user:id,name')->latest('id')->take(6)->get()
            ->map(fn (ActivityLog $log) => [
                'id' => $log->id,
                'description' => $log->description ?: str_replace(['.', '_'], ' ', (string) $log->action),
                'by' => $log->user?->name,
                'at' => $log->created_at,
            ]);

        return [
            'today' => [
                'orders' => $trend[count($trend) - 1]['orders'],
                'revenue' => $trend[count($trend) - 1]['revenue'],
                'date' => $todayKey,
            ],
            'trend' => $trend,
            'municipalities' => $municipalities,
            'onboarding' => [
                'applicants' => $applicants->count(),
                'for_final_approval' => (int) ($byStatus[RiderOnboardingService::STATUS_FOR_FINAL_APPROVAL] ?? 0),
                'pending_schedule' => (int) ($byStatus[RiderOnboardingService::STATUS_PENDING_SCHEDULE] ?? 0),
            ],
            'recentActivity' => $activity,
        ];
    }
}
