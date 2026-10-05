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
            'purchasing_cash' => $this->purchasing_cash !== null ? (float) $this->purchasing_cash : null,
            'purchasing_cash_issued_at' => $this->purchasing_cash_issued_at,
            'purchasing_cash_issued_by' => $this->purchasing_cash_issued_by,
            'purchasing_cash_received_at' => $this->purchasing_cash_received_at,
            'cod_purchases' => \App\Models\CodPurchase::query()
                ->where('delivery_id', $this->id)
                ->with('business')
                ->get()
                ->map(fn ($purchase) => [
                    'id' => $purchase->id,
                    'business_id' => $purchase->business_id,
                    'business_name' => $purchase->business?->business_name ?? $purchase->business?->name,
                    'purchase_amount' => (float) $purchase->purchase_amount,
                    'status' => $purchase->status,
                    'purchased_at' => $purchase->purchased_at,
                    'collected_at' => $purchase->collected_at,
                ]),
            'assigned_at' => $this->assigned_at,
            'picked_up_at' => $this->picked_up_at,
            'delivered_at' => $this->delivered_at,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
