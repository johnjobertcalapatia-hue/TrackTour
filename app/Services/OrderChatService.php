<?php

namespace App\Services;

use App\Models\Business;
use App\Models\ChatMessage;
use App\Models\ChatParticipant;
use App\Models\ChatRoom;
use App\Models\Notification;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Chat per order: the tourist who placed an order and the owner of a
 * restaurant in it talk in one conversation per (order, restaurant). In a group
 * checkout each restaurant has its own thread and never sees the others.
 *
 * Access is decided from the order and the business every time (not from the
 * participants table), so a conversation is only ever readable by the order's
 * tourist and the restaurant's current owner.
 */
class OrderChatService
{
    public const TYPE = 'order';

    public const MAX_MESSAGE = 2000;

    public function __construct(private InboxNotifier $inbox) {}

    /** Food orders only (ride-hailing has its own in-trip channel). */
    public function orderAllowsChat(Order $order): bool
    {
        return $order->order_type !== 'transport';
    }

    /** Restaurants in the order: the canonical business plus every item's business. */
    public function businessesIn(Order $order): Collection
    {
        $ids = $order->items()->whereNotNull('business_id')->pluck('business_id')
            ->push($order->business_id)
            ->filter()
            ->unique()
            ->values();

        return Business::whereIn('id', $ids)->orderBy('business_name')->get(['id', 'business_name', 'owner_id']);
    }

    public function isTourist(User $user, ChatRoom $room): bool
    {
        return $room->order !== null && (int) $room->order->user_id === (int) $user->id;
    }

    public function isOwner(User $user, ChatRoom $room): bool
    {
        return $room->business !== null && (int) $room->business->owner_id === (int) $user->id;
    }

    public function canAccess(User $user, ChatRoom $room): bool
    {
        return $room->type === self::TYPE && ($this->isTourist($user, $room) || $this->isOwner($user, $room));
    }

    /** Find or start the conversation for this order and restaurant. */
    public function open(Order $order, Business $business, User $tourist): ChatRoom
    {
        return DB::transaction(function () use ($order, $business, $tourist) {
            $room = ChatRoom::firstOrCreate(
                ['order_id' => $order->id, 'business_id' => $business->id],
                ['type' => self::TYPE],
            );

            foreach (array_filter([$tourist->id, $business->owner_id]) as $userId) {
                ChatParticipant::firstOrCreate(['chat_room_id' => $room->id, 'user_id' => $userId]);
            }

            return $room;
        });
    }

    /** Messages, oldest first; viewing them marks the conversation read for this user. */
    public function messages(ChatRoom $room, User $user, int $limit = 200): array
    {
        $ownerSide = $this->isOwner($user, $room);
        $messages = $room->messages()->orderByDesc('id')->limit($limit)->get()->reverse()->values();

        $this->markRead($room, $user);

        return $messages->map(fn (ChatMessage $m) => [
            'id' => $m->id,
            'message' => $m->message,
            'is_mine' => (int) $m->sender_id === (int) $user->id,
            // Each side sees the other as "the customer" or "the restaurant", never a personal account.
            'sender_name' => (int) $m->sender_id === (int) $user->id
                ? 'You'
                : ($ownerSide ? ($room->order?->customer_name ?: 'Customer') : ($room->business?->business_name ?? 'Restaurant')),
            'created_at' => $m->created_at?->toISOString(),
        ])->all();
    }

    public function markRead(ChatRoom $room, User $user): void
    {
        ChatParticipant::updateOrCreate(
            ['chat_room_id' => $room->id, 'user_id' => $user->id],
            ['last_read_at' => now()],
        );
        // Reading the conversation also clears its "new message" notification.
        Notification::where('user_id', $user->id)
            ->where('type', 'message_received')
            ->where('data->room_id', $room->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);
    }

    public function send(ChatRoom $room, User $sender, string $text): ChatMessage
    {
        $text = trim($text);
        $message = DB::transaction(function () use ($room, $sender, $text) {
            $message = $room->messages()->create([
                'sender_id' => $sender->id,
                'message' => $text,
                'message_type' => 'text',
            ]);
            $room->touch();
            ChatParticipant::updateOrCreate(
                ['chat_room_id' => $room->id, 'user_id' => $sender->id],
                ['last_read_at' => now()],
            );

            return $message;
        });

        $this->notifyOtherSide($room, $sender, $text);

        return $message;
    }

    private function notifyOtherSide(ChatRoom $room, User $sender, string $text): void
    {
        $order = $room->order;
        $business = $room->business;
        if (! $order || ! $business) {
            return;
        }

        $snippet = Str::limit($text, 120);
        $data = ['room_id' => $room->id, 'order_id' => $order->id, 'business_id' => $business->id];

        if ($this->isOwner($sender, $room)) {
            if ($order->user_id) {
                $this->inbox->notify((int) $order->user_id, 'message_received', "{$business->business_name} replied",
                    "Order #{$order->order_number}: {$snippet}", $data, ['room_id']);
            }

            return;
        }

        if ($business->owner_id) {
            $customer = $order->customer_name ?: 'A customer';
            $this->inbox->notify((int) $business->owner_id, 'message_received', "New message from {$customer}",
                "Order #{$order->order_number} · {$business->business_name}: {$snippet}", $data, ['room_id']);
        }
    }

    /** List row for a conversation, from this user's side. */
    public function summary(ChatRoom $room, User $user): array
    {
        $last = $room->messages()->latest('id')->first();
        $readAt = ChatParticipant::where('chat_room_id', $room->id)->where('user_id', $user->id)->value('last_read_at');
        $unread = $room->messages()
            ->where('sender_id', '!=', $user->id)
            ->when($readAt, fn ($q) => $q->where('created_at', '>', $readAt))
            ->count();

        return [
            'id' => $room->id,
            'order_id' => $room->order_id,
            'order_number' => $room->order?->order_number,
            'order_status' => $room->order?->status,
            'business_id' => $room->business_id,
            'business_name' => $room->business?->business_name,
            'customer_name' => $room->order?->customer_name ?: 'Customer',
            'last_message' => $last?->message,
            'last_message_at' => $last?->created_at?->toISOString(),
            'last_message_mine' => $last ? (int) $last->sender_id === (int) $user->id : false,
            'unread' => $unread,
        ];
    }
}
