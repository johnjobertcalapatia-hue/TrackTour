<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FavoriteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'favoritable_type' => $this->favoritable_type,
            'favoritable_id' => $this->favoritable_id,
            'favoritable' => $this->whenLoaded('favoritable', function () {
                return match (class_basename($this->favoritable_type)) {
                    'Business' => new BusinessResource($this->favoritable),
                    'TourismEvent' => new EventResource($this->favoritable),
                    default => [
                        'id' => $this->favoritable->id,
                        'type' => class_basename($this->favoritable_type),
                    ],
                };
            }),
            'created_at' => $this->created_at,
        ];
    }
}
