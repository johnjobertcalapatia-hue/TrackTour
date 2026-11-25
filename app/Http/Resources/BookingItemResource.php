<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A booked line. Resort reservations (Stage 7) carry the priced snapshot of the
 * offering as it was booked; older bookings have only description, quantity,
 * price and subtotal.
 */
class BookingItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'resort_offering_id' => $this->resort_offering_id,
            'name' => $this->description,
            'category' => $this->category,
            'booking_mode' => $this->booking_mode,
            'pricing_basis' => $this->pricing_basis,
            'quantity' => $this->quantity,
            'units' => $this->units,
            'guests' => $this->guests,
            'nights' => $this->nights,
            'unit_price' => $this->price !== null ? (float) $this->price : null,
            'subtotal' => $this->subtotal !== null ? (float) $this->subtotal : null,
            'start_date' => $this->start_date?->toDateString(),
            'end_date' => $this->end_date?->toDateString(),
            'slot' => $this->slot,
        ];
    }
}
