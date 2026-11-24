<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PromotionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->name,
            'description' => $this->description,
            'type' => $this->type,
            'discount_percentage' => $this->value,
            'code' => $this->code,
            'min_order' => $this->min_order,
            'valid_from' => $this->start_date,
            'valid_until' => $this->end_date,
            // The names the owner/staff promotion pages read (Staff Management section 5).
            'discount_type' => $this->type,
            'discount_value' => $this->value,
            'start_date' => $this->start_date ? \Illuminate\Support\Carbon::parse($this->start_date)->toDateString() : null,
            'end_date' => $this->end_date ? \Illuminate\Support\Carbon::parse($this->end_date)->toDateString() : null,
            'is_active' => $this->is_active,
            'usage_limit' => $this->usage_limit,
            'usage_count' => $this->usage_count,
            'business' => new BusinessResource($this->whenLoaded('business')),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
