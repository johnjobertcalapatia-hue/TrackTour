<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

class UpdateBookingStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['required', 'in:pending,confirmed,active,cancelled'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'status.required' => '预订状态为必填项。',
            'status.in' => '预订状态必须是待处理、已确认、进行中或已取消。',
            'reason.max' => '原因不能超过500个字符。',
        ];
    }
}
