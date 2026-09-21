<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ChatMessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'room_id' => $this->chat_room_id,
            'sender' => new UserResource($this->whenLoaded('sender')),
            'content' => $this->message,
            'message_type' => $this->message_type,
            'read_at' => $this->when(
                $request->user() && $this->relationLoaded('reads'),
                fn () => $this->reads->where('user_id', $request->user()->id)->first()?->read_at
            ),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
