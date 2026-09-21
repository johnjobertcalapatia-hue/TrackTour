<?php

namespace App\Repositories\Contracts;

use Illuminate\Pagination\LengthAwarePaginator;

interface NotificationRepositoryInterface
{
    public function getForUser(int $userId, int $perPage = 20): LengthAwarePaginator;

    public function markAsRead(int $notificationId, int $userId): bool;

    public function markAllAsRead(int $userId): bool;

    public function getUnreadCount(int $userId): int;
}
