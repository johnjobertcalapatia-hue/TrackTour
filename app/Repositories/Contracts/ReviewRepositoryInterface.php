<?php

namespace App\Repositories\Contracts;

use Illuminate\Pagination\LengthAwarePaginator;

interface ReviewRepositoryInterface
{
    public function getByBusiness(int $businessId, int $perPage = 15): LengthAwarePaginator;

    public function getByUser(int $userId, int $perPage = 15): LengthAwarePaginator;

    public function getAverageRating(int $businessId): float;

    public function getCount(int $businessId): int;
}
