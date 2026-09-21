<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Repositories\Contracts\BookingRepositoryInterface;
use App\Repositories\Contracts\BusinessRepositoryInterface;
use App\Repositories\Contracts\MunicipalityRepositoryInterface;
use App\Repositories\Contracts\OrderRepositoryInterface;
use App\Repositories\Contracts\UserRepositoryInterface;
use Illuminate\Support\Collection;

class AdminService
{
    public function __construct(
        protected UserRepositoryInterface $userRepository,
        protected BusinessRepositoryInterface $businessRepository,
        protected MunicipalityRepositoryInterface $municipalityRepository,
        protected ?OrderRepositoryInterface $orderRepository = null,
        protected ?BookingRepositoryInterface $bookingRepository = null,
    ) {}

    public function getDashboardStats(): array
    {
        $totalUsers = $this->userRepository->count();
        $totalBusinesses = $this->businessRepository->count();
        $totalMunicipalities = $this->municipalityRepository->count();
        $pendingBusinesses = $this->businessRepository->countByStatus('pending');
        $pendingApprovals = ApprovalRequest::where('status', 'pending')->count();

        return [
            'total_users' => $totalUsers,
            'total_businesses' => $totalBusinesses,
            'total_municipalities' => $totalMunicipalities,
            'pending_businesses' => $pendingBusinesses,
            'pending_approvals' => $pendingApprovals,
        ];
    }

    public function getUsersByRole(): array
    {
        $roles = [
            'tourist',
            'business_owner',
            'rider',
            'tourism_office',
            'bansud_tourism_office',
        ];

        $total = $this->userRepository->count();
        $byRole = [];

        foreach ($roles as $role) {
            $count = $this->userRepository->countByRole($role);
            $byRole[$role] = [
                'count' => $count,
                'percentage' => $total > 0 ? round(($count / $total) * 100, 2) : 0,
            ];
        }

        return [
            'total' => $total,
            'by_role' => $byRole,
        ];
    }

    public function getSystemStats(): array
    {
        $users = $this->getUsersByRole();

        $businessStats = [
            'total' => $this->businessRepository->count(),
            'approved' => $this->businessRepository->countByStatus('approved'),
            'pending' => $this->businessRepository->countByStatus('pending'),
            'rejected' => $this->businessRepository->countByStatus('rejected'),
            'suspended' => $this->businessRepository->countByStatus('suspended'),
        ];

        $totalOrders = 0;
        $totalBookings = 0;

        // Collection placeholder - actual counts would require a broader repository method
        $municipalities = $this->municipalityRepository->count();

        return [
            'users' => $users,
            'businesses' => $businessStats,
            'municipalities' => $municipalities,
        ];
    }

    public function getReportData(string $type, array $filters = []): Collection
    {
        return match ($type) {
            'users' => collect($this->getUsersByRole()),
            'businesses' => collect($this->getSystemStats()),
            'system' => collect($this->getSystemStats()),
            default => collect([]),
        };
    }
}
