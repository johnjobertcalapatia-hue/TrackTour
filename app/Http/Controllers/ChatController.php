<?php

namespace App\Http\Controllers;

use App\Models\ChatMessage;
use App\Models\ChatParticipant;
use App\Models\ChatRoom;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    public function rooms(Request $request): JsonResponse
    {
        $user = $request->user();
        $participants = ChatParticipant::where('user_id', $user->id)
            ->with(['room.business', 'room.participants.user'])
            ->orderBy('updated_at', 'desc')
            ->get();

        $rooms = $participants->map(function ($p) use ($user) {
            $room = $p->room;
            $other = $room->participants->firstWhere('user_id', '!=', $user->id);
            $lastMessage = $room->messages()->latest()->first();
            $unread = $room->messages()
                ->where('sender_id', '!=', $user->id)
                ->where('created_at', '>', $p->last_read_at ?? now()->subYear())
                ->count();

            return [
                'id' => $room->id,
                'type' => $room->type,
                'other_user' => $other ? [
                    'id' => $other->user->id,
                    'name' => $other->user->name,
                ] : null,
                'business_name' => $room->business?->business_name,
                'last_message' => $lastMessage?->message,
                'last_message_at' => $lastMessage?->created_at,
                'unread' => $unread,
            ];
        });

        return response()->json($rooms);
    }

    public function messages(Request $request, ChatRoom $room): JsonResponse
    {
        $user = $request->user();

        $isParticipant = ChatParticipant::where('chat_room_id', $room->id)
            ->where('user_id', $user->id)
            ->exists();

        if (! $isParticipant) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $messages = $room->messages()
            ->with('sender')
            ->orderBy('created_at', 'asc')
            ->limit(100)
            ->get()
            ->map(fn ($m) => [
                'id' => $m->id,
                'sender_id' => $m->sender_id,
                'sender_name' => $m->sender->name,
                'message' => $m->message,
                'message_type' => $m->message_type,
                'created_at' => $m->created_at,
                'is_mine' => $m->sender_id === $user->id,
            ]);

        ChatParticipant::where('chat_room_id', $room->id)
            ->where('user_id', $user->id)
            ->update(['last_read_at' => now()]);

        return response()->json($messages);
    }

    public function send(Request $request, ChatRoom $room): JsonResponse
    {
        $user = $request->user();

        $isParticipant = ChatParticipant::where('chat_room_id', $room->id)
            ->where('user_id', $user->id)
            ->exists();

        if (! $isParticipant) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $validated = $request->validate([
            'message' => 'required|string|max:5000',
            'message_type' => 'nullable|string|in:text,image,location',
        ]);

        $message = $room->messages()->create([
            'sender_id' => $user->id,
            'message' => $validated['message'],
            'message_type' => $validated['message_type'] ?? 'text',
        ]);

        $message->load('sender');

        return response()->json([
            'id' => $message->id,
            'sender_id' => $message->sender_id,
            'sender_name' => $message->sender->name,
            'message' => $message->message,
            'message_type' => $message->message_type,
            'created_at' => $message->created_at,
            'is_mine' => true,
        ], 201);
    }

    public function markRead(Request $request, ChatRoom $room): JsonResponse
    {
        $user = $request->user();

        ChatParticipant::where('chat_room_id', $room->id)
            ->where('user_id', $user->id)
            ->update(['last_read_at' => now()]);

        return response()->json(['success' => true]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        $user = $request->user();
        $totalUnread = 0;

        $participants = ChatParticipant::where('user_id', $user->id)->get();

        foreach ($participants as $p) {
            $count = ChatMessage::where('chat_room_id', $p->chat_room_id)
                ->where('sender_id', '!=', $user->id)
                ->where('created_at', '>', $p->last_read_at ?? now()->subYear())
                ->count();
            $totalUnread += $count;
        }

        return response()->json(['count' => $totalUnread]);
    }

    public function findOrCreateRoom(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'other_user_id' => 'required|exists:users,id',
            'type' => 'required|string|in:food,transport,general',
            'business_id' => 'nullable|exists:businesses,id',
            'booking_id' => 'nullable|integer',
            'delivery_id' => 'nullable|integer',
        ]);

        // Check if room already exists between these two users
        $existingRoom = ChatRoom::where('type', $validated['type'])
            ->whereHas('participants', fn ($q) => $q->where('user_id', $user->id))
            ->whereHas('participants', fn ($q) => $q->where('user_id', $validated['other_user_id']))
            ->latest()
            ->first();

        if ($existingRoom) {
            return response()->json(['room_id' => $existingRoom->id]);
        }

        $room = ChatRoom::create([
            'type' => $validated['type'],
            'business_id' => $validated['business_id'],
            'booking_id' => $validated['booking_id'],
            'delivery_id' => $validated['delivery_id'],
        ]);

        $room->participants()->createMany([
            ['user_id' => $user->id],
            ['user_id' => $validated['other_user_id']],
        ]);

        return response()->json(['room_id' => $room->id], 201);
    }
}
