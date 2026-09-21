<?php

namespace App\Repositories\Contracts;

use App\Models\User;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

interface UserRepositoryInterface
{
    public function findById(int $id): ?User;

    public function findByEmail(string $email): ?User;

    public function create(array $data): User;

    public function update(User $user, array $data): User;

    public function delete(User $user): bool;

    public function getPaginated(array $filters = [], int $perPage = 15): LengthAwarePaginator;

    public function getByRole(string $role, int $perPage = 15): LengthAwarePaginator;

    public function count(): int;

    public function countByRole(string $role): int;

    public function getRecentUsers(int $limit = 5): Collection;
}
