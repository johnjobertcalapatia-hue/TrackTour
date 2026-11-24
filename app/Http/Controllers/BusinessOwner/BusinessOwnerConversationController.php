<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\ChatRoom;
use App\Services\OrderChatService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Notifications → Messages & Concerns: conversations customers started from
 * their orders with one of this owner's restaurants. Owners only.
 */
class BusinessOwnerConversationController extends Controller
{
    public function __construct(private OrderChatService $chat) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_id' => ['nullable', 'integer'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $user = $request->user();
        $businessIds = Business::where('owner_id', $user->id)
            ->when($validated['business_id'] ?? null, fn ($q, $id) => $q->whereKey($id))
            ->pluck('id');

        $page = ChatRoom::with(['order', 'business'])
            ->where('type', OrderChatService::TYPE)
            ->whereIn('business_id', $businessIds)
            ->whereHas('messages')
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->paginate(15);

        return response()->json([
            'success' => true,
            'message' => 'Success',
            'data' => collect($page->items())->map(fn (ChatRoom $room) => $this->chat->summary($room, $user))->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    public function show(Request $request, ChatRoom $room): JsonResponse
    {
        $user = $request->user();
        $this->authorizeRoom($request, $room);

        return $this->successResponse([
            'conversation' => $this->chat->summary($room, $user),
            'messages' => $this->chat->messages($room, $user),
        ]);
    }

    public function send(Request $request, ChatRoom $room): JsonResponse
    {
        $user = $request->user();
        $this->authorizeRoom($request, $room);

        $validated = $request->validate(['message' => ['required', 'string', 'max:'.OrderChatService::MAX_MESSAGE, 'not_regex:/^\s*$/']]);
        $message = $this->chat->send($room, $user, $validated['message']);

        return $this->createdResponse([
            'id' => $message->id,
            'message' => $message->message,
            'is_mine' => true,
            'sender_name' => 'You',
            'created_at' => $message->created_at?->toISOString(),
        ], 'Message sent.');
    }

    /** Someone else's conversation answers 404, so its existence is not revealed. */
    private function authorizeRoom(Request $request, ChatRoom $room): void
    {
        $room->load(['order', 'business']);
        abort_unless($room->type === OrderChatService::TYPE && $this->chat->isOwner($request->user(), $room), 404);
    }
}
