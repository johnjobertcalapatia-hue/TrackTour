<?php

namespace App\Repositories\Eloquent;

use App\Models\Favorite;
use App\Repositories\Contracts\FavoriteRepositoryInterface;
use Illuminate\Support\Collection;

class FavoriteRepository implements FavoriteRepositoryInterface
{
    public function __construct(
        protected Favorite $model,
    ) {}

    public function toggle(int $userId, string $type, int $objectId): bool
    {
        $existing = $this->model->where('user_id', $userId)
            ->where('favoritable_type', $type)
            ->where('favoritable_id', $objectId)
            ->first();

        if ($existing) {
            $existing->delete();

            return false;
        }

        $this->model->create([
            'user_id' => $userId,
            'favoritable_type' => $type,
            'favoritable_id' => $objectId,
        ]);

        return true;
    }

    public function isFavorited(int $userId, string $type, int $objectId): bool
    {
        return $this->model->where('user_id', $userId)
            ->where('favoritable_type', $type)
            ->where('favoritable_id', $objectId)
            ->exists();
    }

    public function getUserFavoriteIds(int $userId, string $type): array
    {
        return $this->model->where('user_id', $userId)
            ->where('favoritable_type', $type)
            ->pluck('favoritable_id')
            ->toArray();
    }

    public function getByUser(int $userId): Collection
    {
        return $this->model->where('user_id', $userId)
            ->with('favoritable')
            ->latest()
            ->get();
    }
}
