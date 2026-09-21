<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\User;
use App\Repositories\Contracts\BusinessRepositoryInterface;
use App\Repositories\Contracts\UserRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;

class TourismOfficeService
{
    public function __construct(
        protected BusinessRepositoryInterface $businessRepository,
        protected UserRepositoryInterface $userRepository,
    ) {}

    public function getDashboardStats(): array
    {
        $totalUsers = $this->userRepository->count();
        $totalBusinesses = $this->businessRepository->count();
        $pendingBusinesses = $this->businessRepository->countByStatus('pending');
        $approvedBusinesses = $this->businessRepository->countByStatus('approved');
        $pendingOwners = User::where('role', User::ROLE_BUSINESS_OWNER)
            ->where('account_status', User::ACCOUNT_STATUS_PENDING)
            ->count();
        $pendingApprovals = ApprovalRequest::where('status', 'pending')->count();

        return [
            'total_users' => $totalUsers,
            'total_businesses' => $totalBusinesses,
            'pending_businesses' => $pendingBusinesses,
            'approved_businesses' => $approvedBusinesses,
            'pending_owners' => $pendingOwners,
            'pending_approvals' => $pendingApprovals,
        ];
    }

    public function getBusinessOwnerApprovals(array $filters = []): LengthAwarePaginator
    {
        $perPage = $filters['perPage'] ?? 15;

        $query = User::where('role', User::ROLE_BUSINESS_OWNER)
            ->where('account_status', User::ACCOUNT_STATUS_PENDING)
            ->with(['profile', 'businesses']);

        if (! empty($filters['search'])) {
            $search = $filters['search'];
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        return $query->orderBy('created_at', 'desc')
            ->paginate($perPage);
    }
}
