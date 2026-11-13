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

    public function getRecentlyTakenForRider(int $riderId, int $minutes = 10, int $limit = 15): Collection;

    /**
     * Rider → first-pickup distance (km) per delivery id; null without a GPS
     * fix or pickup coordinates.
     *
     * @return array<int, float|null>
     */
    public function pickupDistancesKm(int $riderId, Collection $deliveries): array;

    public function getActiveDeliveries(int $riderId): Collection;

    /** @param  'food'|'ride'|null  $type  food orders only, ride bookings only, or both */
    public function getCompletedDeliveries(int $riderId, int $perPage = 15, ?string $type = null): LengthAwarePaginator;

    public function getRiderEarnings(int $riderId, int $perPage = 15): LengthAwarePaginator;

    public function countPending(): int;

    public function countActiveByRider(int $riderId): int;

    public function countCompletedByRider(int $riderId): int;

    public function getTotalEarningsByRider(int $riderId): float;

    public function getThisMonthEarningsByRider(int $riderId): float;

    public function getActiveOperationsByBusiness(int $businessId): Collection;

    public function countActiveByBusiness(int $businessId): int;
}
