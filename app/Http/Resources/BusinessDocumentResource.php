<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class BusinessDocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->requiredDocument?->document_name ?? 'Document',
            'file_url' => $this->file_path ? request()->getSchemeAndHttpHost() . Storage::url($this->file_path) : null,
            'file_path' => $this->file_path,
            'document_number' => $this->document_number,
            'registered_name' => $this->registered_name,
            'issued_by' => $this->issued_by,
            'issue_date' => $this->issue_date?->format('Y-m-d'),
            'expiration_date' => $this->expiration_date?->format('Y-m-d'),
            'owner_remarks' => $this->owner_remarks,
            'admin_remarks' => $this->admin_remarks,
            'verification_status' => $this->verification_status,
            'required_document' => $this->when($this->relationLoaded('requiredDocument'), [
                'id' => $this->requiredDocument?->id,
                'name' => $this->requiredDocument?->document_name,
                'is_expirable' => (bool) ($this->requiredDocument?->has_expiration ?? false),
            ]),
        ];
    }
}
