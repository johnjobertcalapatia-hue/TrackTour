<?php

namespace App\Repositories\Eloquent;

use App\Models\Order;
use App\Repositories\Contracts\OrderRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class OrderRepository implements OrderRepositoryInterface
{
    public function __construct(
        protected Order $model,
    ) {}

    public function findById(int $id): ?Order
    {
        return $this->model->with(['business', 'items', 'delivery', 'canceller'])->find($id);
    }

    public function create(array $data): Order
    {
        return $this->model->create($data);
    }

    public function update(Order $order, array $data): Order
    {
        $order->update($data);

        return $order->fresh();
    }

    public function getByBusiness(int $businessId, ?string $status = null, int $perPage = 20): LengthAwarePaginator
    {
        $query = $this->model->with(['items', 'delivery'])
            ->where('business_id', $businessId);

        if ($status) {
            $query->where('status', $status);
        }

        return $query->latest()->paginate($perPage);
    }

    public function getTodaySummary(int $businessId): array
    {
        $today = Carbon::today();

        $query = $this->model->where('business_id', $businessId)
            ->whereDate('created_at', $today);

        $pending = (clone $query)->whereIn('status', ['pending_payment', 'waiting_restaurant'])->count();
        $confirmed = (clone $query)->whereIn('status', ['accepted', 'preparing', 'ready'])->count();
        $inProgress = (clone $query)->where('status', 'in_progress')->count();
        $completedToday = (clone $query)->where('status', 'completed')->count();
        $cancelledToday = (clone $query)->where('status', 'cancelled')->count();
        $revenueToday = (clone $query)->where('status', 'completed')->sum('total');

        return [
            'pending' => $pending,
            'confirmed' => $confirmed,
            'in_progress' => $inProgress,
            'completed_today' => $completedToday,
            'cancelled_today' => $cancelledToday,
            'revenue_today' => (float) $revenueToday,
        ];
    }

    public function getStatusCounts(int $businessId): Collection
    {
        return $this->model->where('business_id', $businessId)
            ->selectRaw('status, count(*) as count')
            ->groupBy('status')
            ->get();
    }

    public function getRecentOrders(int $businessId, int $limit = 10): Collection
    {
        return $this->model->with(['items'])
            ->where('business_id', $businessId)
            ->latest()
            ->take($limit)
            ->get();
    }

    public function updateStatus(Order $order, string $status, ?string $reason = null): Order
    {
        $data = ['status' => $status];

        if ($status === 'completed') {
            $data['completed_at'] = now();
        }

        if ($status === 'cancelled') {
            $data['cancelled_at'] = now();
            if ($reason) {
                $data['cancellation_reason'] = $reason;
            }
        }

        $order->update($data);

        return $order->fresh();
    }
}
