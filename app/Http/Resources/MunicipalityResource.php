<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MunicipalityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'province' => $this->province,
            'district' => $this->district,
            'region' => $this->region,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'logo' => $this->logo,
            'cover_photo' => $this->cover_photo,
            'barangays' => BarangayResource::collection($this->whenLoaded('barangays')),
        ];
    }
}
