<?php

namespace App\Policies;

use App\Models\Review;
use App\Models\User;

class ReviewPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->role === User::ROLE_TOURIST;
    }

    public function update(User $user, Review $review): bool
    {
        return $review->user_id === $user->id;
    }

    public function delete(User $user, Review $review): bool
    {
        if ($review->user_id === $user->id) {
            return true;
        }

        return $user->role === User::ROLE_BANSUD_TOURISM_OFFICE
            || $user->role === User::ROLE_TOURISM_OFFICE;
    }
}
