<?php

namespace App\Repositories\Contracts;

use App\Models\Delivery;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface DeliveryRepositoryInterface
{
    public function findById(int $id): ?Delivery;

    public function getByRider(int $riderId, ?string $status = null, int $perPage = 15): LengthAwarePaginator;

    public function getPendingDeliveries(int $riderId, int $limit = 20): Collection;

    public function getActiveDeliveries(int $riderId): Collection;

    public function getCompletedDeliveries(int $riderId, int $perPage = 15): LengthAwarePaginator;

    public function getRiderEarnings(int $riderId, int $perPage = 15): LengthAwarePaginator;

    public function countPending(): int;

    public function countActiveByRider(int $riderId): int;

    public function countCompletedByRider(int $riderId): int;

    public function getTotalEarningsByRider(int $riderId): float;

    public function getThisMonthEarningsByRider(int $riderId): float;

    public function getActiveOperationsByBusiness(int $businessId): Collection;

    public function countActiveByBusiness(int $businessId): int;
}
