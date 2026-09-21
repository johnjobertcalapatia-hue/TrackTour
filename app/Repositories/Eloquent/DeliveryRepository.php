<?php

namespace App\Repositories\Eloquent;

use App\Enums\TripStatus;
use App\Models\Delivery;
use App\Repositories\Contracts\DeliveryRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class DeliveryRepository implements DeliveryRepositoryInterface
{
    /**
     * Statuses shown in the rider's active-deliveries list. 'delivered' stays
     * visible so a COD delivery awaiting cash settlement can be completed there.
     */
    const ACTIVE_FOR_SETTLEMENT = [
        'assigned',
        'en_route_pickup',
        'arrived_pickup',
        'tour_started',
        'en_route_destination',
        'arrived_destination',
        'delivered',
    ];

    public function __construct(
        protected Delivery $model,
    ) {}

    public function findById(int $id): ?Delivery
    {
        return $this->model->with(['order.business', 'rider', 'tripLog'])->find($id);
    }

    public function getByRider(int $riderId, ?string $status = null, int $perPage = 15): LengthAwarePaginator
    {
        $query = $this->model->with(['order.business'])
            ->where('rider_id', $riderId);

        if ($status) {
            $query->where('status', $status);
        }

        return $query->latest()->paginate($perPage);
    }

    public function getPendingDeliveries(int $riderId, int $limit = 20): Collection
    {
        return $this->model->with(['order.business'])
            ->where('status', TripStatus::WAITING)
            ->whereHas('dispatchLogs', function ($query) use ($riderId) {
                $query->where('rider_id', $riderId)
                    ->where('response', 'pending');
            })
            ->orderBy('created_at')
            ->take($limit)
            ->get();
    }

    public function getActiveDeliveries(int $riderId): Collection
    {
        return $this->model->with(['order.business'])
            ->where('rider_id', $riderId)
            ->whereIn('status', self::ACTIVE_FOR_SETTLEMENT)
            ->get();
    }

    public function getCompletedDeliveries(int $riderId, int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->with(['order.business'])
            ->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            ->latest()
            ->paginate($perPage);
    }

    public function getRiderEarnings(int $riderId, int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->with(['order.business'])
            ->where('rider_id', $riderId)
            ->where('status', '!=', TripStatus::CANCELLED)
            ->latest('assigned_at')
            ->latest()
            ->paginate($perPage);
    }

    public function countPending(): int
    {
        return $this->model->where('status', TripStatus::WAITING)->count();
    }

    public function countActiveByRider(int $riderId): int
    {
        return $this->model->where('rider_id', $riderId)
            ->whereIn('status', self::ACTIVE_FOR_SETTLEMENT)
            ->count();
    }

    public function countCompletedByRider(int $riderId): int
    {
        return $this->model->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            ->count();
    }

    public function getTotalEarningsByRider(int $riderId): float
    {
        return (float) $this->model->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            ->sum('rider_commission');
    }

    public function getThisMonthEarningsByRider(int $riderId): float
    {
        return (float) $this->model->where('rider_id', $riderId)
            ->where('status', TripStatus::COMPLETED)
            ->whereMonth('delivered_at', now()->month)
            ->whereYear('delivered_at', now()->year)
            ->sum('rider_commission');
    }

    public function getActiveOperationsByBusiness(int $businessId): Collection
    {
        return $this->model->with(['order', 'rider'])
            ->whereHas('order', function ($q) use ($businessId) {
                $q->where('business_id', $businessId);
            })
            ->whereIn('status', [
                TripStatus::ASSIGNED,
                TripStatus::EN_ROUTE_PICKUP,
                TripStatus::ARRIVED_PICKUP,
                TripStatus::TOUR_STARTED,
                TripStatus::EN_ROUTE_DESTINATION,
                TripStatus::ARRIVED_DESTINATION,
            ])
            ->get();
    }

    public function countActiveByBusiness(int $businessId): int
    {
        return $this->model->whereHas('order', function ($q) use ($businessId) {
            $q->where('business_id', $businessId);
        })
            ->whereIn('status', [
            TripStatus::ASSIGNED,
            TripStatus::EN_ROUTE_PICKUP,
            TripStatus::ARRIVED_PICKUP,
            TripStatus::TOUR_STARTED,
            TripStatus::EN_ROUTE_DESTINATION,
            TripStatus::ARRIVED_DESTINATION,
        ])
            ->count();
    }
}
