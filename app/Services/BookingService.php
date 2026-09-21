<?php

namespace App\Services;

use App\Models\Booking;
use App\Repositories\Contracts\BookingRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class BookingService
{
    public function __construct(
        protected BookingRepositoryInterface $bookingRepository,
    ) {}

    public function getBookingsByBusiness(int $businessId, array $filters = []): LengthAwarePaginator
    {
        $status = $filters['status'] ?? null;

        return $this->bookingRepository->getByBusiness($businessId, $status, $filters['perPage'] ?? 20);
    }

    public function getBooking(int $id): ?Booking
    {
        return $this->bookingRepository->findById($id);
    }

    public function getTodaySummary(int $businessId): array
    {
        return $this->bookingRepository->getTodaySummary($businessId);
    }

    public function getStatusCounts(int $businessId): Collection
    {
        return $this->bookingRepository->getStatusCounts($businessId);
    }

    public function updateStatus(Booking $booking, string $status, ?string $reason = null): Booking
    {
        return $this->bookingRepository->updateStatus($booking, $status, $reason);
    }

    public function getRecentBookings(int $businessId, int $limit = 10): Collection
    {
        return $this->bookingRepository->getRecentBookings($businessId, $limit);
    }
}
