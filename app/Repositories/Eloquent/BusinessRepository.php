<?php

namespace App\Repositories\Eloquent;

use App\Models\Business;
use App\Repositories\Contracts\BusinessRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class BusinessRepository implements BusinessRepositoryInterface
{
    public function __construct(
        protected Business $model,
    ) {}

    public function findById(int $id): ?Business
    {
        return $this->model->with(['owner', 'municipality', 'barangay', 'category'])->find($id);
    }

    public function create(array $data): Business
    {
        return $this->model->create($data);
    }

    public function update(Business $business, array $data): Business
    {
        $business->update($data);

        return $business->fresh();
    }

    public function delete(Business $business): bool
    {
        return $business->delete();
    }

    public function getPaginated(array $filters = [], int $perPage = 15): LengthAwarePaginator
    {
        $query = $this->model->with(['owner', 'municipality', 'barangay', 'category']);

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        if (! empty($filters['business_category_id'])) {
            $query->where('business_category_id', $filters['business_category_id']);
        }

        if (! empty($filters['municipality_id'])) {
            $query->where('municipality_id', $filters['municipality_id']);
        }

        if (! empty($filters['owner_id'])) {
            $query->where('owner_id', $filters['owner_id']);
        }

        if (! empty($filters['search'])) {
            $search = $filters['search'];
            $query->where(function ($q) use ($search) {
                $q->where('business_name', 'like', "%{$search}%")
                    ->orWhere('business_description', 'like', "%{$search}%");
            });
        }

        if (! empty($filters['price_range'])) {
            $query->where('price_range', $filters['price_range']);
        }

        return $query->latest()->paginate($perPage);
    }

    public function getApproved(?int $limit = null): Collection
    {
        $query = $this->model->with(['owner', 'municipality', 'category'])
            ->where('status', 'approved');

        if ($limit) {
            return $query->take($limit)->get();
        }

        return $query->get();
    }

    public function getByOwner(int $ownerId): Collection
    {
        return $this->model->with(['municipality', 'barangay', 'category', 'activeModules'])
            ->where('owner_id', $ownerId)
            ->latest()
            ->get();
    }

    public function getByCategory(int $categoryId): Collection
    {
        return $this->model->with(['owner', 'municipality'])
            ->where('business_category_id', $categoryId)
            ->where('status', 'approved')
            ->latest()
            ->get();
    }

    public function count(): int
    {
        return $this->model->count();
    }

    public function countByStatus(string $status): int
    {
        return $this->model->where('status', $status)->count();
    }

    public function getNearby(float $lat, float $lng, float $radiusKm = 20, int $limit = 8): Collection
    {
        $haversine = '(6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))';

        return $this->model->with(['category', 'municipality'])
            ->where('status', 'approved')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->selectRaw("*, {$haversine} AS distance_km", [$lat, $lng, $lat])
            ->orderBy('distance_km')
            ->take($limit)
            ->get();
    }

    public function search(string $query, int $limit = 10): Collection
    {
        return $this->model->with(['category', 'municipality'])
            ->where('status', 'approved')
            ->where(function ($q) use ($query) {
                $q->where('business_name', 'like', "%{$query}%")
                    ->orWhere('business_description', 'like', "%{$query}%")
                    ->orWhere('tagline', 'like', "%{$query}%");
            })
            ->take($limit)
            ->get();
    }

    public function getFeatured(int $limit = 8): Collection
    {
        return $this->model->with(['category', 'municipality'])
            ->where('status', 'approved')
            ->orderByDesc('popularity_score')
            ->take($limit)
            ->get();
    }

    public function getPopular(int $limit = 8): Collection
    {
        return $this->model->with(['category', 'municipality'])
            ->where('status', 'approved')
            ->orderByDesc('average_rating')
            ->orderByDesc('review_count')
            ->take($limit)
            ->get();
    }

    public function getRecent(int $limit = 5): Collection
    {
        return $this->model->with(['owner', 'category', 'municipality'])
            ->where('status', 'approved')
            ->latest()
            ->take($limit)
            ->get();
    }
}
