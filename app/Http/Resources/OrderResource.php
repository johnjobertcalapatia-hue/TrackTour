<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'order_number' => $this->order_number,
            'group_order_id' => $this->group_order_id,
            'group_reference_number' => $this->whenLoaded('groupOrder', fn () => $this->groupOrder?->reference_number),
            'group_paid' => $this->whenLoaded('groupOrder', fn () => $this->groupOrder?->payment_status === 'paid'),
            'business' => new BusinessResource($this->whenLoaded('business')),
            'customer_name' => $this->customer_name,
            'customer_phone' => $this->customer_phone,
            'customer_email' => $this->customer_email,
            'delivery_address' => $this->delivery_address,
            'items' => OrderItemResource::collection($this->whenLoaded('items')),
            'status' => $this->status,
            'order_type' => $this->order_type,
            'delivery_speed' => $this->delivery_speed,
            'subtotal' => $this->subtotal,
            'total' => $this->total,
            'total_amount' => $this->total,
            'delivery_fee' => $this->delivery_fee,
            'rider_tip' => $this->rider_tip,
            'delivery_distance_km' => $this->delivery_distance_km,
            'delivery_duration_minutes' => $this->delivery_duration_minutes,
            'pickup_latitude' => $this->pickup_latitude,
            'pickup_longitude' => $this->pickup_longitude,
            'delivery_latitude' => $this->delivery_latitude,
            'delivery_longitude' => $this->delivery_longitude,
            'delivery_fee_calculated_at' => $this->delivery_fee_calculated_at,
            'delivery_distance_is_estimated' => $this->delivery_distance_is_estimated,
            'delivery_fee_details' => $this->delivery_distance_km !== null ? [
                'business_id' => $this->business_id,
                'distance_km' => (float) $this->delivery_distance_km,
                'base_fare' => (float) config('delivery.base_fare'),
                'included_kilometers' => (float) config('delivery.included_kilometers', 2.00),
                'distance_rate' => (float) config('delivery.per_kilometer'),
                'distance_charge' => round(
                    max(
                        (float) $this->delivery_distance_km - (float) config('delivery.included_kilometers', 2.00),
                        0
                    ) * (float) config('delivery.per_kilometer'),
                    2
                ),
                'service_adjustment' => (float) config('delivery.service_adjustment'),
                'surge_multiplier' => (float) config('delivery.surge_multiplier'),
                'delivery_fee' => (float) $this->delivery_fee,
                'rider_tip' => (float) $this->rider_tip,
                'is_estimated' => (bool) $this->delivery_distance_is_estimated,
            ] : null,
            'discount' => $this->discount,
            'paid_amount' => $this->paid_amount,
            'payment_method' => $this->payment_method,
            'special_instructions' => $this->notes,
            'delivery' => new DeliveryResource($this->whenLoaded('delivery')),
            'cancelled_by' => $this->cancelled_by,
            'cancellation_reason' => $this->cancellation_reason,
            'cancelled_at' => $this->cancelled_at,
            'completed_at' => $this->completed_at,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'items_summary' => $this->whenLoaded('items', function () {
                $items = $this->items;
                return [
                    'total' => $items->count(),
                    'pending' => $items->where('status', 'pending')->count(),
                    'accepted' => $items->where('status', 'accepted')->count(),
                    'preparing' => $items->where('status', 'preparing')->count(),
                    'ready' => $items->where('status', 'ready')->count(),
                    'rejected' => $items->where('status', 'rejected')->count(),
                    'has_pending' => $items->contains('status', 'pending'),
                    'has_accepted' => $items->contains('status', 'accepted'),
                    'all_accepted' => $items->every(function ($item) {
                        return in_array($item->status, ['accepted', 'preparing', 'ready', 'rejected']);
                    }),
                    'all_rejected' => $items->every('status', 'rejected'),
                ];
            }),
            'preparation_started_at' => $this->preparation_started_at,
            'predicted_ready_at' => $this->predicted_ready_at,
            'food_ready_at' => $this->food_ready_at,
            'predicted_preparation_seconds' => $this->predicted_preparation_seconds,
            'prediction_source' => $this->prediction_source,
        ];
    }
}
