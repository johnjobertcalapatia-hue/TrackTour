<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\ChatRoom;
use App\Models\Order;
use App\Services\OrderChatService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Tourist side of chat per order: message a restaurant about one of your own
 * orders (a concern, a question, a special request) and read the replies.
 */
class OrderChatController extends Controller
{
    public function __construct(private OrderChatService $chat) {}

    /** GET /tourist/orders/{order}/chats: the restaurants in this order you can message. */
    public function forOrder(Request $request, Order $order): JsonResponse
    {
        $this->authorizeOrder($request, $order);
        $user = $request->user();
        $rooms = ChatRoom::with(['order', 'business'])
            ->where('order_id', $order->id)
            ->where('type', OrderChatService::TYPE)
            ->get()
            ->keyBy('business_id');

        return $this->successResponse(
            $this->chat->businessesIn($order)->map(fn ($business) => [
                'business_id' => $business->id,
                'business_name' => $business->business_name,
                'room_id' => $rooms->get($business->id)?->id,
                'unread' => $rooms->has($business->id) ? $this->chat->summary($rooms->get($business->id), $user)['unread'] : 0,
            ])->values()->all()
        );
    }

    /** POST /tourist/orders/{order}/chats {business_id}: open (or reopen) the conversation. */
    public function open(Request $request, Order $order): JsonResponse
    {
        $this->authorizeOrder($request, $order);
        $validated = $request->validate(['business_id' => ['required', 'integer']]);

        $business = $this->chat->businessesIn($order)->firstWhere('id', (int) $validated['business_id']);
        if (! $business) {
            return $this->errorResponse('That restaurant is not part of this order.', 422);
        }

        $room = $this->chat->open($order, $business, $request->user());

        return $this->successResponse(['room_id' => $room->id]);
    }

    /** GET /tourist/chats: all your order conversations, newest first. */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $rooms = ChatRoom::with(['order', 'business'])
            ->where('type', OrderChatService::TYPE)
            ->whereHas('order', fn ($q) => $q->where('user_id', $user->id))
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        return $this->successResponse($rooms->map(fn (ChatRoom $room) => $this->chat->summary($room, $user))->values()->all());
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

    private function authorizeOrder(Request $request, Order $order): void
    {
        abort_unless((int) $order->user_id === (int) $request->user()->id && $this->chat->orderAllowsChat($order), 404);
    }

    private function authorizeRoom(Request $request, ChatRoom $room): void
    {
        $room->load(['order', 'business']);
        abort_unless($room->type === OrderChatService::TYPE && $this->chat->isTourist($request->user(), $room), 404);
    }
}
