<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $profile = $this->profile;

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'role' => $this->role,
            'account_status' => $this->account_status,
            'email_verified_at' => $this->email_verified_at,
            'created_at' => $this->created_at,
            'municipality_id' => $this->municipality_id,
            'municipality' => $this->whenLoaded('municipality', fn () => $this->municipality->name),
            'first_name' => $profile?->first_name,
            'last_name' => $profile?->last_name,
            'phone' => $profile?->phone,
            'address' => $profile?->address,
            'profile_photo' => $profile?->avatar,
            'rider_status' => $this->whenLoaded('riderDetail', fn () => $this->riderDetail?->rider_status),
            'current_service' => $this->whenLoaded('riderDetail', fn () => $this->riderDetail?->current_service),
            'profile' => new UserProfileResource($this->whenLoaded('profile')),
            'businesses' => BusinessResource::collection($this->whenLoaded('businesses')),
            'staff' => StaffResource::collection($this->whenLoaded('staff')),
        ];
    }
}
