<?php

namespace App\Repositories\Contracts;

use App\Models\Business;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface BusinessRepositoryInterface
{
    public function findById(int $id): ?Business;

    public function create(array $data): Business;

    public function update(Business $business, array $data): Business;

    public function delete(Business $business): bool;

    public function getPaginated(array $filters = [], int $perPage = 15): LengthAwarePaginator;

    public function getApproved(?int $limit = null): Collection;

    public function getByOwner(int $ownerId): Collection;

    public function getByCategory(int $categoryId): Collection;

    public function count(): int;

    public function countByStatus(string $status): int;

    public function getNearby(float $lat, float $lng, float $radiusKm = 20, int $limit = 8): Collection;

    public function search(string $query, int $limit = 10): Collection;

    public function getFeatured(int $limit = 8): Collection;

    public function getPopular(int $limit = 8): Collection;

    public function getRecent(int $limit = 5): Collection;
}
