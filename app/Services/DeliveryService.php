<?php

namespace App\Services;

use App\Enums\TripStatus;
use App\Models\Delivery;
use App\Models\User;
use App\Repositories\Contracts\DeliveryRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class DeliveryService
{
    public function __construct(
        protected DeliveryRepositoryInterface $deliveryRepository,
    ) {}

    /**
     * Is the rider bound to a delivery/trip that is still on the road?
     *
     * The 'whole trip' spans every in-road TripStatus plus 'delivered' (a
     * dropped-off trip is still owned by the rider until completed or
     * cash-settled). Terminal/completed/cancelled trips never bind.
     *
     * This is the authoritative row-based guard — never the rider_status flag
     * alone — shared by every controller that must keep a mid-trip rider bound.
     */
    public function riderHasActiveTrip(User $user): bool
    {
        $inTripStatuses = collect(TripStatus::cases())
            ->filter(fn (TripStatus $status) => $status->isActive())
            ->map(fn (TripStatus $status) => $status->value)
            ->push(TripStatus::DELIVERED->value)
            ->values()
            ->all();

        return Delivery::where('rider_id', $user->id)
            ->whereIn('status', $inTripStatuses)
            ->exists();
    }

    public function getPendingDeliveries(int $riderId, int $limit = 20): Collection
    {
        return $this->deliveryRepository->getPendingDeliveries($riderId, $limit);
    }

    public function getActiveDeliveries(int $riderId): Collection
    {
        return $this->deliveryRepository->getActiveDeliveries($riderId);
    }

    public function getCompletedDeliveries(int $riderId, int $perPage = 15): LengthAwarePaginator
    {
        return $this->deliveryRepository->getCompletedDeliveries($riderId, $perPage);
    }

    public function getRiderStats(int $riderId): array
    {
        return [
            'pending' => $this->deliveryRepository->countPending(),
            'active' => $this->deliveryRepository->countActiveByRider($riderId),
            'completed' => $this->deliveryRepository->countCompletedByRider($riderId),
            'total_earnings' => $this->deliveryRepository->getTotalEarningsByRider($riderId),
            'month_earnings' => $this->deliveryRepository->getThisMonthEarningsByRider($riderId),
        ];
    }

    public function getRiderEarnings(int $riderId, int $perPage = 15): LengthAwarePaginator
    {
        $paginator = $this->deliveryRepository->getRiderEarnings($riderId, $perPage);

        $paginator->setCollection($paginator->getCollection()->map(function ($delivery) {
            $order = $delivery->primaryOrder();
            $tip = (float) ($order?->rider_tip ?? 0);
            $commission = (float) ($delivery->rider_commission ?? 0);
            $isCash = ($order?->payment_method ?? 'cash') === 'cash';
            $isCompleted = $delivery->status?->value === 'completed' || $delivery->status === 'completed';

            return [
                'id' => $delivery->id,
                'order_number' => $order?->order_number ?? 'N/A',
                'business_name' => $order?->business?->business_name ?? $order?->business?->name ?? 'Restaurant',
                'status' => $delivery->status?->value ?? $delivery->status,
                'payment_method' => $order?->payment_method ?? 'cash',
                'payment_status' => $order?->payment_status ?? 'pending',
                'customer_payment' => $isCash && $isCompleted ? (float) ($order?->total ?? 0) : 0,
                'delivery_fee' => (float) ($delivery->delivery_fee ?? 0),
                'tip' => $tip,
                'rider_commission' => $commission,
                'earnings' => $isCompleted ? round($commission + $tip, 2) : 0,
                'total' => $isCompleted ? round($commission + $tip, 2) : 0,
                'assigned_at' => $delivery->assigned_at,
                'completed_at' => $delivery->delivered_at ?? $delivery->updated_at,
            ];
        }));

        return $paginator;
    }

    public function getActiveOperationsByBusiness(int $businessId): Collection
    {
        return $this->deliveryRepository->getActiveOperationsByBusiness($businessId);
    }
}
