<?php

namespace App\Services;

use App\Models\Staff;
use App\Repositories\Contracts\BookingRepositoryInterface;
use App\Repositories\Contracts\OrderRepositoryInterface;
use App\Repositories\Contracts\StaffRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;

class StaffService
{
    public function __construct(
        protected StaffRepositoryInterface $staffRepository,
        protected ?OrderRepositoryInterface $orderRepository = null,
        protected ?BookingRepositoryInterface $bookingRepository = null,
    ) {}

    public function getStaffByUser(int $userId): ?Staff
    {
        return $this->staffRepository->getByUser($userId);
    }

    public function getStaffDashboardData(int $userId): array
    {
        $staff = $this->staffRepository->getByUser($userId);

        if (! $staff) {
            return [];
        }

        $businessId = $staff->business_id;
        $business = $staff->business;

        $orderSummary = [];
        $bookingSummary = [];

        if ($this->orderRepository) {
            $counts = $this->orderRepository->getStatusCounts($businessId);
            $today = $this->orderRepository->getTodaySummary($businessId);
            $orderSummary = [
                'status_counts' => $counts,
                'today' => $today,
            ];
        }

        if ($this->bookingRepository) {
            $counts = $this->bookingRepository->getStatusCounts($businessId);
            $today = $this->bookingRepository->getTodaySummary($businessId);
            $bookingSummary = [
                'status_counts' => $counts,
                'today' => $today,
            ];
        }

        return [
            'staff' => $staff,
            'business' => $business,
            'order_summary' => $orderSummary,
            'booking_summary' => $bookingSummary,
        ];
    }

    public function getOrdersForStaff(int $businessId, array $filters = []): LengthAwarePaginator
    {
        $status = $filters['status'] ?? null;

        return $this->orderRepository
            ? $this->orderRepository->getByBusiness($businessId, $status, $filters['perPage'] ?? 20)
            : new LengthAwarePaginator([], 0, $filters['perPage'] ?? 20);
    }

    public function getBookingsForStaff(int $businessId, array $filters = []): LengthAwarePaginator
    {
        $status = $filters['status'] ?? null;

        return $this->bookingRepository
            ? $this->bookingRepository->getByBusiness($businessId, $status, $filters['perPage'] ?? 20)
            : new LengthAwarePaginator([], 0, $filters['perPage'] ?? 20);
    }
}
