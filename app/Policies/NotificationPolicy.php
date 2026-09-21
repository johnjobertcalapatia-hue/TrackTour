<?php

namespace App\Policies;

use App\Models\Notification;
use App\Models\User;

class NotificationPolicy
{
    public function view(User $user, Notification $notification): bool
    {
        return $notification->user_id === $user->id;
    }

    public function markAsRead(User $user, Notification $notification): bool
    {
        return $notification->user_id === $user->id;
    }

    public function markAllAsRead(User $user): bool
    {
        return true;
    }
}
