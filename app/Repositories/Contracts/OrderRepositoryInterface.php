<?php

namespace App\Repositories\Contracts;

use App\Models\Order;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface OrderRepositoryInterface
{
    public function findById(int $id): ?Order;

    public function create(array $data): Order;

    public function update(Order $order, array $data): Order;

    public function getByBusiness(int $businessId, ?string $status = null, int $perPage = 20): LengthAwarePaginator;

    public function getTodaySummary(int $businessId): array;

    public function getStatusCounts(int $businessId): Collection;

    public function getRecentOrders(int $businessId, int $limit = 10): Collection;

    public function updateStatus(Order $order, string $status, ?string $reason = null): Order;
}
