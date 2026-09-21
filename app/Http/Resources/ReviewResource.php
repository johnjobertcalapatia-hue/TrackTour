<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReviewResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user' => new UserResource($this->whenLoaded('user')),
            'business' => new BusinessResource($this->whenLoaded('business')),
            'rating' => $this->rating,
            'food_rating' => $this->food_rating,
            'service_rating' => $this->service_rating,
            'cleanliness_rating' => $this->cleanliness_rating,
            'atmosphere_rating' => $this->atmosphere_rating,
            'value_rating' => $this->value_rating,
            'average_dimensional_rating' => $this->getAverageDimensionalRating(),
            'comment' => $this->review,
            'visit_type' => $this->visit_type,
            'would_recommend' => $this->would_recommend,
            'status' => $this->status,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
