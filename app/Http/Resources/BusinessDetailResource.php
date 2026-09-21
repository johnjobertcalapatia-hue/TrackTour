<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;

class BusinessDetailResource extends BusinessResource
{
    public function toArray(Request $request): array
    {
        return array_merge(parent::toArray($request), [
            'details' => BusinessDetailItemResource::collection($this->whenLoaded('details')),
            'offerings' => OfferingResource::collection($this->whenLoaded('offerings')),
            'reviews' => ReviewResource::collection($this->whenLoaded('reviews')),
            'promotions' => PromotionResource::collection($this->whenLoaded('promotions')),
            'is_favorited' => $this->when(
                $request->user() && $this->relationLoaded('favorites'),
                fn () => $this->favorites->contains('user_id', $request->user()->id)
            ),
            'opening_hours' => [
                'opening_time' => $this->opening_time,
                'closing_time' => $this->closing_time,
                'business_days' => $this->business_days,
                'business_hours' => $this->business_hours,
                'schedule_summary' => $this->scheduleSummary(),
                'is_open_now' => $this->isOpenNow(),
                'availability' => $this->availability(),
                'open_status' => $this->openStatusLabel(),
            ],
        ]);
    }
}
