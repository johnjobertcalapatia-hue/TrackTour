<?php

namespace App\Policies;

use App\Models\Staff;
use App\Models\User;

class StaffPolicy
{
    public function viewAny(User $user): bool
    {
        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        return $user->role === User::ROLE_BUSINESS_OWNER
            && $user->businesses()->exists();
    }

    public function view(User $user, Staff $staff): bool
    {
        if ($staff->user_id === $user->id) {
            return true;
        }

        $business = $staff->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        return false;
    }

    public function create(User $user): bool
    {
        return $user->role === User::ROLE_BUSINESS_OWNER
            && $user->businesses()->exists();
    }

    public function update(User $user, Staff $staff): bool
    {
        $business = $staff->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        return false;
    }

    public function delete(User $user, Staff $staff): bool
    {
        $business = $staff->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE) {
            return true;
        }

        return false;
    }
}
