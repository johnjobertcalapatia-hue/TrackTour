<?php

namespace App\Services;

use App\Repositories\Contracts\NotificationRepositoryInterface;
use Illuminate\Pagination\LengthAwarePaginator;

class NotificationService
{
    public function __construct(
        protected NotificationRepositoryInterface $notificationRepository,
    ) {}

    public function getForUser(int $userId, int $perPage = 20): LengthAwarePaginator
    {
        return $this->notificationRepository->getForUser($userId, $perPage);
    }

    public function markAsRead(int $notificationId, int $userId): bool
    {
        return $this->notificationRepository->markAsRead($notificationId, $userId);
    }

    public function markAllAsRead(int $userId): bool
    {
        return $this->notificationRepository->markAllAsRead($userId);
    }

    public function getUnreadCount(int $userId): int
    {
        return $this->notificationRepository->getUnreadCount($userId);
    }
}
