<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RequiredDocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'business_category_id' => $this->business_category_id,
            'document_name' => $this->document_name,
            'document_code' => $this->document_code,
            'description' => $this->description,
            'is_required' => $this->is_required,
            'has_expiration' => $this->has_expiration,
            'validity_period' => $this->validity_period,
            'required_fields' => $this->required_fields,
            'is_active' => $this->is_active,
            'sort_order' => $this->sort_order,
            'archived_at' => $this->archived_at,
        ];
    }
}
