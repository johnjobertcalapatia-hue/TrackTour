<?php

namespace App\Repositories\Eloquent;

use App\Models\Booking;
use App\Repositories\Contracts\BookingRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class BookingRepository implements BookingRepositoryInterface
{
    public function __construct(
        protected Booking $model,
    ) {}

    public function findById(int $id): ?Booking
    {
        return $this->model->with(['business', 'items'])->find($id);
    }

    public function create(array $data): Booking
    {
        return $this->model->create($data);
    }

    public function update(Booking $booking, array $data): Booking
    {
        $booking->update($data);

        return $booking->fresh();
    }

    public function getByBusiness(int $businessId, ?string $status = null, int $perPage = 20): LengthAwarePaginator
    {
        $query = $this->model->with(['items'])
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

        $pending = (clone $query)->where('status', 'pending')->count();
        $confirmed = (clone $query)->where('status', 'confirmed')->count();
        $inProgress = (clone $query)->where('status', 'in_progress')->count();
        $completedToday = (clone $query)->where('status', 'completed')->count();
        $cancelledToday = (clone $query)->where('status', 'cancelled')->count();
        $revenueToday = (clone $query)->where('status', 'completed')->sum('total_amount');

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

    public function getRecentBookings(int $businessId, int $limit = 10): Collection
    {
        return $this->model->with(['items'])
            ->where('business_id', $businessId)
            ->latest()
            ->take($limit)
            ->get();
    }

    public function updateStatus(Booking $booking, string $status, ?string $reason = null): Booking
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

        $booking->update($data);

        return $booking->fresh();
    }
}
