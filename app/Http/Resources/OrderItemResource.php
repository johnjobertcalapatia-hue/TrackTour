<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrderItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'offering' => new OfferingResource($this->whenLoaded('offering')),
            'product_name' => $this->product_name,
            'quantity' => $this->quantity,
            'unit_price' => $this->unit_price,
            'total_price' => $this->subtotal,
            'special_notes' => $this->notes,
            'status' => $this->status ?? 'pending',
            'accepted_at' => $this->accepted_at,
            'preparation_started_at' => $this->preparation_started_at,
            'ready_at' => $this->ready_at,
            'rejection_reason' => $this->rejection_reason,
            'rejected_by' => $this->rejected_by,
            'cancelled_quantity' => $this->cancelled_quantity,
            'cancellation_reason' => $this->cancellation_reason,
        ];
    }
}
