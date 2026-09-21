<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return $this->successResponse([]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return $this->successResponse(['unread_count' => 0]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'recipient_id' => 'required|integer',
            'message' => 'required|string|max:2000',
        ]);

        return $this->createdResponse(
            ['id' => 1, ...$validated, 'created_at' => now()],
            'Message sent.'
        );
    }
}
