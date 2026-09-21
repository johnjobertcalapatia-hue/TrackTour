<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BusinessCategoryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'description' => $this->description,
            'icon' => $this->icon,
            'archived_at' => $this->archived_at,
            'is_active' => $this->archived_at === null,
            'required_documents' => RequiredDocumentResource::collection($this->whenLoaded('requiredDocuments')),
        ];
    }
}
