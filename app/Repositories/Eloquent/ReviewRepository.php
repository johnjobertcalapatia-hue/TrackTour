<?php

namespace App\Repositories\Eloquent;

use App\Models\Review;
use App\Repositories\Contracts\ReviewRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;

class ReviewRepository implements ReviewRepositoryInterface
{
    public function __construct(
        protected Review $model,
    ) {}

    public function getByBusiness(int $businessId, int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->with(['user.profile'])
            ->where('business_id', $businessId)
            ->where('status', 'approved')
            ->latest()
            ->paginate($perPage);
    }

    public function getByUser(int $userId, int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->with(['business'])
            ->where('user_id', $userId)
            ->latest()
            ->paginate($perPage);
    }

    public function getAverageRating(int $businessId): float
    {
        return (float) $this->model->where('business_id', $businessId)
            ->where('status', 'approved')
            ->avg('rating');
    }

    public function getCount(int $businessId): int
    {
        return $this->model->where('business_id', $businessId)
            ->where('status', 'approved')
            ->count();
    }
}
