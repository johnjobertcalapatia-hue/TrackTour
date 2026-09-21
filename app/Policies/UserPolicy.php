<?php

namespace App\Policies;

use App\Models\User;

class UserPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE
            || $user->role === User::ROLE_TOURISM_OFFICE;
    }

    public function view(User $user, User $model): bool
    {
        if ($user->id === $model->id) {
            return true;
        }

        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE
            || $user->role === User::ROLE_TOURISM_OFFICE;
    }

    public function create(User $user): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function update(User $user, User $model): bool
    {
        if ($user->id === $model->id) {
            return true;
        }

        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function delete(User $user, User $model): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function approve(User $user, User $model): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE
            || $user->role === User::ROLE_TOURISM_OFFICE;
    }

    public function reject(User $user, User $model): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE
            || $user->role === User::ROLE_TOURISM_OFFICE;
    }

    public function suspend(User $user, User $model): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function archive(User $user, User $model): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function restore(User $user, User $model): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }
}
