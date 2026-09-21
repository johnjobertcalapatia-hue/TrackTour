<?php

namespace App\Policies;

use App\Models\Municipality;
use App\Models\User;

class MunicipalityPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function update(User $user, Municipality $municipality): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function delete(User $user, Municipality $municipality): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }
}
