<?php

namespace App\Http\Requests\Tourist;

use Illuminate\Foundation\Http\FormRequest;

class BookTransportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'pickup_lat' => ['required', 'numeric'],
            'pickup_lng' => ['required', 'numeric'],
            'pickup_address' => ['nullable', 'string', 'max:500'],
            'destination_lat' => ['required', 'numeric'],
            'destination_lng' => ['required', 'numeric'],
            'destination_address' => ['nullable', 'string', 'max:500'],
            'vehicle_type' => ['required', 'string', 'in:motorcycle,tricycle,car,van'],
            'passenger_count' => ['required', 'integer', 'min:1', 'max:8'],
            'fare' => ['sometimes', 'numeric', 'min:0'],
            'distance_km' => ['sometimes', 'numeric', 'min:0'],
            'duration_min' => ['sometimes', 'integer', 'min:1'],
            'payment_method' => ['required', 'string', 'in:cash,gcash,maya,card'],
            'booking_notes' => ['nullable', 'string', 'max:500'],
        ];
    }
}
