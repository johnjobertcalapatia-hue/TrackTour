<?php

namespace App\Services;

use App\Models\Order;
use App\Repositories\Contracts\OrderRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class OrderService
{
    public function __construct(
        protected OrderRepositoryInterface $orderRepository,
    ) {}

    public function getOrdersByBusiness(int $businessId, array $filters = []): LengthAwarePaginator
    {
        $status = $filters['status'] ?? null;

        if (! empty($filters['search'])) {
            return $this->orderRepository->getByBusiness($businessId, $status, $filters['perPage'] ?? 20);
        }

        if (! empty($filters['order_type'])) {
            // Repository handles order_type filter within getByBusiness via filters array
            return $this->orderRepository->getByBusiness($businessId, $status, $filters['perPage'] ?? 20);
        }

        return $this->orderRepository->getByBusiness($businessId, $status, $filters['perPage'] ?? 20);
    }

    public function getOrder(int $id): ?Order
    {
        return $this->orderRepository->findById($id);
    }

    public function getTodaySummary(int $businessId): array
    {
        return $this->orderRepository->getTodaySummary($businessId);
    }

    public function getStatusCounts(int $businessId): Collection
    {
        return $this->orderRepository->getStatusCounts($businessId);
    }

    public function updateStatus(Order $order, string $status, ?string $reason = null): Order
    {
        return $this->orderRepository->updateStatus($order, $status, $reason);
    }

    public function getRecentOrders(int $businessId, int $limit = 10): Collection
    {
        return $this->orderRepository->getRecentOrders($businessId, $limit);
    }
}
