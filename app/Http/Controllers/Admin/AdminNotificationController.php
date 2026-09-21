<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminNotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $notifications = $request->user()->notifications()->latest()->paginate(20);

        return $this->paginatedResponse($notifications);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $request->user()->notifications()->update(['read_at' => now()]);

        return $this->successResponse(null, 'All notifications marked as read.');
    }
}
