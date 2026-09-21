<?php

namespace App\Http\Requests\Staff;

use Illuminate\Foundation\Http\FormRequest;

class StaffUpdateBookingStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['required', 'string', 'in:confirmed,in_progress,completed,cancelled,rejected'],
            'cancellation_reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
