<?php

namespace App\Policies;

use App\Models\Business;
use App\Models\User;

class BusinessPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Business $business): bool
    {
        if ($business->status === Business::where('status', 'approved')->first()?->status
            || $business->status === 'approved') {
            return true;
        }

        return $business->owner_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $user->role === User::ROLE_BUSINESS_OWNER;
    }

    public function update(User $user, Business $business): bool
    {
        return $business->owner_id === $user->id;
    }

    public function delete(User $user, Business $business): bool
    {
        if ($business->owner_id === $user->id) {
            return true;
        }

        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE;
    }

    public function manage(User $user, Business $business): bool
    {
        if ($business->owner_id === $user->id) {
            return true;
        }

        return $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists();
    }

    public function approve(User $user, Business $business): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE
            || $user->role === User::ROLE_TOURISM_OFFICE;
    }

    public function reject(User $user, Business $business): bool
    {
        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE
            || $user->role === User::ROLE_TOURISM_OFFICE;
    }
}
