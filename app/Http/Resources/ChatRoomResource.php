<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ChatRoomResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $lastMessage = $this->whenLoaded('messages');
        $lastMessageItem = $lastMessage?->last();

        return [
            'id' => $this->id,
            'name' => $this->name ?? $this->type,
            'type' => $this->type,
            'business' => new BusinessResource($this->whenLoaded('business')),
            'participants' => UserResource::collection($this->whenLoaded('participants', function () {
                return $this->participants->pluck('user')->filter();
            })),
            'last_message' => new ChatMessageResource($lastMessageItem),
            'unread_count' => $this->when(
                $request->user(),
                fn () => $this->participants
                    ->where('user_id', $request->user()->id)
                    ->first()?->unread_count ?? 0
            ),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
