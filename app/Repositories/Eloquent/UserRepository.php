<?php

namespace App\Repositories\Eloquent;

use App\Models\User;
use App\Repositories\Contracts\UserRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class UserRepository implements UserRepositoryInterface
{
    public function __construct(
        protected User $model,
    ) {}

    public function findById(int $id): ?User
    {
        return $this->model->with(['profile', 'municipality'])->find($id);
    }

    public function findByEmail(string $email): ?User
    {
        return $this->model->where('email', $email)->first();
    }

    public function create(array $data): User
    {
        return $this->model->create($data);
    }

    public function update(User $user, array $data): User
    {
        $user->update($data);

        return $user->fresh();
    }

    public function delete(User $user): bool
    {
        return $user->delete();
    }

    public function getPaginated(array $filters = [], int $perPage = 15): LengthAwarePaginator
    {
        $query = $this->model->with(['profile', 'municipality']);

        if (! empty($filters['role'])) {
            $query->where('role', $filters['role']);
        }

        if (! empty($filters['account_status'])) {
            $query->where('account_status', $filters['account_status']);
        }

        if (! empty($filters['search'])) {
            $search = $filters['search'];
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        if (! empty($filters['municipality_id'])) {
            $query->where('municipality_id', $filters['municipality_id']);
        }

        return $query->latest()->paginate($perPage);
    }

    public function getByRole(string $role, int $perPage = 15): LengthAwarePaginator
    {
        return $this->model->with(['profile', 'municipality'])
            ->where('role', $role)
            ->latest()
            ->paginate($perPage);
    }

    public function count(): int
    {
        return $this->model->count();
    }

    public function countByRole(string $role): int
    {
        return $this->model->where('role', $role)->count();
    }

    public function getRecentUsers(int $limit = 5): Collection
    {
        return $this->model->with(['profile'])
            ->latest()
            ->take($limit)
            ->get();
    }
}
