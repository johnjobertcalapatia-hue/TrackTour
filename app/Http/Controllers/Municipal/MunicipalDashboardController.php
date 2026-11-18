<?php

namespace App\Http\Controllers\Municipal;

use App\Http\Resources\MunicipalityResource;
use App\Models\BusinessDocument;
use App\Models\User;
use App\Services\AdminAnalyticsService;
use App\Services\MunicipalScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Read-only overview of one municipality for its Tourism Office.
 */
class MunicipalDashboardController extends MunicipalController
{
    public function index(Request $request): JsonResponse
    {
        $municipality = $this->municipality($request)->loadCount('barangays');
        $id = (int) $municipality->id;

        $owners = fn () => $this->scope->businessOwners($id);
        $businesses = fn () => $this->scope->businesses($id);
        $riders = fn () => $this->scope->riders($id);

        $monthStart = now('Asia/Manila')->startOfMonth()->timezone(config('app.timezone'));
        $orders = fn () => DB::table('orders')
            ->whereIn('id', $this->scope->orderIds($id))
            ->whereNull('deleted_at');

        return $this->successResponse([
            'municipality' => array_merge(
                MunicipalityResource::make($municipality)->resolve(),
                ['barangays_count' => $municipality->barangays_count]
            ),
            'stats' => [
                'business_owners' => [
                    'total' => $owners()->count(),
                    'pending' => $owners()->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
                    'approved' => $owners()->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
                    'suspended' => $owners()->where('account_status', User::ACCOUNT_STATUS_SUSPENDED)->count(),
                ],
                'businesses' => [
                    'total' => $businesses()->count(),
                    'pending' => $businesses()->whereIn('status', MunicipalScopeService::PENDING_BUSINESS_STATUSES)->count(),
                    'approved' => $businesses()->where('status', 'approved')->count(),
                    'suspended' => $businesses()->where('status', 'suspended')->count(),
                ],
                'riders' => [
                    'total' => $riders()->count(),
                    'pending' => $riders()->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
                    'approved' => $riders()->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
                    'active_now' => $riders()
                        ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
                        ->whereHas('riderDetail', fn ($q) => $q->whereIn('rider_status', MunicipalScopeService::ACTIVE_RIDER_STATUSES))
                        ->count(),
                ],
                'tourists' => [
                    'total' => $this->scope->tourists($id)->count(),
                ],
                'orders' => [
                    'total' => $orders()->count(),
                    'this_month' => $orders()->where('created_at', '>=', $monthStart)->count(),
                ],
                'documents' => [
                    'business_pending' => BusinessDocument::whereHas('business', fn ($b) => $b->where('municipality_id', $id))
                        ->where('verification_status', 'pending')->count(),
                    'business_flagged' => BusinessDocument::whereHas('business', fn ($b) => $b->where('municipality_id', $id))
                        ->where('verification_status', 'flagged')->count(),
                    'riders_pending' => $riders()->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
                ],
            ],
            'recent_businesses' => $businesses()
                ->with('category:id,name', 'barangay:id,name')
                ->latest()->limit(5)
                ->get(['id', 'business_name', 'business_category_id', 'barangay_id', 'status', 'logo', 'created_at'])
                ->map(fn ($b) => [
                    'id' => $b->id,
                    'business_name' => $b->business_name,
                    'category' => $b->category?->name,
                    'barangay' => $b->barangay?->name,
                    'status' => $b->status,
                    'logo' => $b->logo,
                    'created_at' => $b->created_at,
                ]),
            'recent_activity' => $this->scope->activityLogs($id)
                ->with('user:id,name,email')
                ->orderByDesc('created_at')->orderByDesc('id')
                ->limit(8)->get()
                ->map(fn ($log) => MunicipalActivityLogController::present($log)),
            'pending' => [
                'business_owners' => $owners()
                    ->where('account_status', User::ACCOUNT_STATUS_PENDING)
                    ->latest()->limit(5)->get(['users.id', 'users.name', 'users.email', 'users.created_at']),
                'businesses' => $businesses()
                    ->whereIn('status', MunicipalScopeService::PENDING_BUSINESS_STATUSES)
                    ->with('category:id,name')
                    ->latest()->limit(5)
                    ->get(['id', 'business_name', 'business_category_id', 'status', 'created_at'])
                    ->map(fn ($b) => [
                        'id' => $b->id,
                        'business_name' => $b->business_name,
                        'category' => $b->category?->name,
                        'status' => $b->status,
                        'created_at' => $b->created_at,
                    ]),
                'riders' => $riders()
                    ->where('account_status', User::ACCOUNT_STATUS_PENDING)
                    ->latest()->limit(5)->get(['users.id', 'users.name', 'users.email', 'users.created_at']),
            ],
        ]);
    }

    /**
     * Business-intelligence figures for this municipality only (period +
     * previous-period comparison). The municipality always comes from the
     * officer's account, never from the request.
     */
    public function analytics(Request $request, AdminAnalyticsService $analytics): JsonResponse
    {
        $v = $request->validate([
            'period' => ['nullable', Rule::in(AdminAnalyticsService::PERIODS)],
            'from' => ['nullable', 'date_format:Y-m-d', 'required_if:period,custom'],
            'to' => ['nullable', 'date_format:Y-m-d', 'required_if:period,custom', 'after_or_equal:from'],
        ]);
        if (($v['period'] ?? null) === 'custom' && now()->parse($v['from'])->diffInDays(now()->parse($v['to'])) > 366) {
            return $this->errorResponse('Choose a custom range of one year or less.', 422);
        }

        return $this->successResponse($analytics->buildForMunicipalOffice(
            $v['period'] ?? 'this_month', $v['from'] ?? null, $v['to'] ?? null, (int) $this->municipality($request)->id
        ));
    }
}
