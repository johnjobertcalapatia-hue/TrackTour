<?php

namespace App\Http\Requests\Rider;

use Illuminate\Foundation\Http\FormRequest;

class UpdateDeliveryStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['required', 'in:en_route_pickup,arrived_pickup,tour_started,en_route_destination,arrived_destination'],
        ];
    }

    public function messages(): array
    {
        return [
            'status.required' => '配送状态为必填项。',
            'status.in' => '配送状态必须是前往取货点、已到达取货点、行程开始、前往目的地或已到达目的地之一。',
        ];
    }
}
