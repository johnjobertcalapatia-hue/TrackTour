<?php

namespace App\Http\Requests\Staff;

use Illuminate\Foundation\Http\FormRequest;

class StaffUpdateOrderStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['required', 'string', 'in:preparing,ready,completed,cancelled,rejected'],
            'cancellation_reason' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
