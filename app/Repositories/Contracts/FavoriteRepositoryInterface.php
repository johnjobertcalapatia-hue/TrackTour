<?php

namespace App\Repositories\Contracts;

use Illuminate\Support\Collection;

interface FavoriteRepositoryInterface
{
    public function toggle(int $userId, string $type, int $objectId): bool;

    public function isFavorited(int $userId, string $type, int $objectId): bool;

    public function getUserFavoriteIds(int $userId, string $type): array;

    public function getByUser(int $userId): Collection;
}
