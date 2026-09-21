<?php

namespace App\Repositories\Eloquent;

use App\Models\Notification;
use App\Repositories\Contracts\NotificationRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;

class NotificationRepository implements NotificationRepositoryInterface
{
    public function __construct(
        protected Notification $model,
    ) {}

    public function getForUser(int $userId, int $perPage = 20): LengthAwarePaginator
    {
        return $this->model->where('user_id', $userId)
            ->latest()
            ->paginate($perPage);
    }

    public function markAsRead(int $notificationId, int $userId): bool
    {
        $notification = $this->model->where('id', $notificationId)
            ->where('user_id', $userId)
            ->first();

        if (! $notification) {
            return false;
        }

        if ($notification->read_at) {
            return true;
        }

        $notification->update(['read_at' => now()]);

        return true;
    }

    public function markAllAsRead(int $userId): bool
    {
        $this->model->where('user_id', $userId)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return true;
    }

    public function getUnreadCount(int $userId): int
    {
        return $this->model->where('user_id', $userId)
            ->whereNull('read_at')
            ->count();
    }
}
