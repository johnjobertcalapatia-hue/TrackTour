<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'booking_number' => $this->booking_number,
            'business' => new BusinessResource($this->whenLoaded('business')),
            'customer_name' => $this->customer_name,
            'customer_phone' => $this->customer_phone,
            'customer_email' => $this->customer_email,
            'booking_date' => $this->check_in_date,
            'booking_type' => $this->booking_type,
            'check_in_date' => $this->check_in_date,
            'check_out_date' => $this->check_out_date,
            'check_in_time' => $this->check_in_time,
            'number_of_guests' => $this->guests,
            'special_requests' => $this->notes,
            'status' => $this->status,
            'total_amount' => $this->total_amount,
            'paid_amount' => $this->paid_amount,
            'cancellation_reason' => $this->cancellation_reason,
            'cancelled_at' => $this->cancelled_at,
            'completed_at' => $this->completed_at,
            'items' => BookingItemResource::collection($this->whenLoaded('items')),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
