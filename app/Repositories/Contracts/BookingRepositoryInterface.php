<?php

namespace App\Repositories\Contracts;

use App\Models\Booking;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface BookingRepositoryInterface
{
    public function findById(int $id): ?Booking;

    public function create(array $data): Booking;

    public function update(Booking $booking, array $data): Booking;

    public function getByBusiness(int $businessId, ?string $status = null, int $perPage = 20): LengthAwarePaginator;

    public function getTodaySummary(int $businessId): array;

    public function getStatusCounts(int $businessId): Collection;

    public function getRecentBookings(int $businessId, int $limit = 10): Collection;

    public function updateStatus(Booking $booking, string $status, ?string $reason = null): Booking;
}
