<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class EventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->name,
            'description' => $this->description,
            'date' => $this->start_date,
            'time' => $this->start_date?->format('H:i'),
            'start_date' => $this->start_date,
            'end_date' => $this->end_date,
            'location' => $this->location,
            'municipality' => new MunicipalityResource($this->whenLoaded('municipality')),
            'image_url' => $this->image ? Storage::url($this->image) : null,
            'category' => $this->when(isset($this->category), $this->category),
            'status' => $this->status,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
