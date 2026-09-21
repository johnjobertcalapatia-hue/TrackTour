<?php

namespace App\Services;

use App\Models\User;
use App\Repositories\Contracts\UserRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Hash;

class UserService
{
    public function __construct(
        protected UserRepositoryInterface $userRepository,
    ) {}

    public function getDashboardStats(): array
    {
        $roles = User::ROLES;
        $counts = [];
        foreach ($roles as $role) {
            $counts[$role] = $this->userRepository->countByRole($role);
        }

        return [
            'total' => $this->userRepository->count(),
            'by_role' => $counts,
            'recent' => $this->userRepository->getRecentUsers(5),
        ];
    }

    public function getUser(int $id): ?User
    {
        return $this->userRepository->findById($id);
    }

    public function getPaginatedUsers(array $filters = [], int $perPage = 15): LengthAwarePaginator
    {
        return $this->userRepository->getPaginated($filters, $perPage);
    }

    public function createUser(array $data): User
    {
        if (isset($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        }

        return $this->userRepository->create($data);
    }

    public function updateUser(User $user, array $data): User
    {
        if (isset($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        }

        return $this->userRepository->update($user, $data);
    }

    public function deleteUser(User $user): bool
    {
        return $this->userRepository->delete($user);
    }

    public function getByRole(string $role): LengthAwarePaginator
    {
        return $this->userRepository->getByRole($role);
    }
}
