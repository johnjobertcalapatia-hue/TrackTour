<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DeliveryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'order' => new OrderResource($this->whenLoaded('order')),
            'rider' => new UserResource($this->whenLoaded('rider')),
            'status' => $this->status?->value ?? $this->status,
            'dispatch_status' => $this->dispatch_status,
            'delivery_fee' => $this->delivery_fee,
            'rider_tip' => (float) ($this->primaryOrder()?->rider_tip ?? 0),
            'distance_km' => $this->distance_km,
            'estimated_duration_minutes' => $this->estimated_duration_minutes,
            'pickup_address' => $this->pickup_address,
            'delivery_address' => $this->delivery_address,
            'pickup_latitude' => $this->pickup_latitude,
            'pickup_longitude' => $this->pickup_longitude,
            'delivery_latitude' => $this->delivery_latitude,
            'delivery_longitude' => $this->delivery_longitude,
            'notes' => $this->notes,
            'rider_commission' => $this->rider_commission,
            'is_cod' => strtolower((string) ($this->primaryOrder()?->payment_method ?? '')) === 'cash',
            'cash_due' => $this->cash_due !== null ? (float) $this->cash_due : null,
            'cash_received' => $this->cash_received !== null ? (float) $this->cash_received : null,
            'change_given' => $this->change_given !== null ? (float) $this->change_given : null,
            'cash_settled_at' => $this->cash_settled_at,
            'assigned_at' => $this->assigned_at,
            'picked_up_at' => $this->picked_up_at,
            'delivered_at' => $this->delivered_at,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
