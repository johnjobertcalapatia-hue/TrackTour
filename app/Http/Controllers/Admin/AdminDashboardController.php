<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\User;
use App\Services\AdminService;
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
            ],
            'usersByRole' => $usersByRole,
            'recentUsers' => $recentUsers,
            'recentBusinesses' => $recentBusinesses,
        ];

        return $this->successResponse($data);
    }
}
