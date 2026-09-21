<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class BusinessMediaResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'file_path' => Storage::url($this->file_path),
            'type' => $this->type,
            'title' => $this->title,
            'category' => $this->category,
            'caption' => $this->caption,
            'sort_order' => $this->sort_order,
            'featured' => $this->featured,
            'visibility' => $this->visibility,
            'status' => $this->status,
            'created_at' => $this->created_at,
        ];
    }
}
