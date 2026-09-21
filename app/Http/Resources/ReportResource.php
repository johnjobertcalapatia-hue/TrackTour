<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReportResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'title' => $this->title,
            'description' => $this->description,
            'data' => $this->data,
            'generated_by' => new UserResource($this->whenLoaded('generatedBy')),
            'filters' => $this->when(isset($this->filters), $this->filters),
            'summary' => $this->when(isset($this->summary), $this->summary),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
