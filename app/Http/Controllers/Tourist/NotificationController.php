<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationResource;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function __construct(private NotificationService $notificationService) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $notifications = $this->notificationService->getForUser($user->id);
        $this->notificationService->markAllAsRead($user->id);

        if ($request->expectsJson()) {
            return $this->successResponse(compact('notifications'));
        }

        return response()->json($notifications);
    }

    public function apiIndex(Request $request): JsonResponse
    {
        $user = $request->user();
        $perPage = $request->integer('per_page', 20);

        $notifications = $this->notificationService->getForUser($user->id, $perPage);
        $this->notificationService->markAllAsRead($user->id);

        return $this->paginatedResponse($notifications, 'Notifications retrieved.');
    }

    public function markAsRead(Request $request, int $notificationId): JsonResponse
    {
        $result = $this->notificationService->markAsRead($notificationId, $request->user()->id);

        if (! $result) {
            return $this->notFoundResponse('Notification not found.');
        }

        return $this->successResponse(null, 'Notification marked as read.');
    }

    public function readAll(Request $request): JsonResponse
    {
        $request->user()->notifications()->whereNull('read_at')->update(['read_at' => now()]);

        return $this->successResponse(null, 'All notifications marked as read.');
    }

    public function unreadCount(Request $request): JsonResponse
    {
        $count = $this->notificationService->getUnreadCount($request->user()->id);

        return $this->successResponse(['count' => $count]);
    }
}
