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
            'phone' => $profile?->mobile_number,
            'address' => $profile?->address,
            'profile_photo' => $profile?->avatar,
            'rider_status' => $this->whenLoaded('riderDetail', fn () => $this->riderDetail?->rider_status),
            'current_service' => $this->whenLoaded('riderDetail', fn () => $this->riderDetail?->current_service),
            // NOT whenLoaded(): that helper returns null whenever the related
            // row is absent, which would read as "unknown" for a rider who has
            // never created a rider_details row. Auto accept has a definite
            // default — OFF — so emit a real boolean when the relation is
            // loaded, and omit the key entirely when it is not.
            'auto_accept' => $this->when(
                $this->relationLoaded('riderDetail'),
                fn () => (bool) ($this->riderDetail?->auto_accept ?? false)
            ),
            'profile' => new UserProfileResource($this->whenLoaded('profile')),
            'businesses' => BusinessResource::collection($this->whenLoaded('businesses')),
            'staff' => StaffResource::collection($this->whenLoaded('staff')),
        ];
    }
}
