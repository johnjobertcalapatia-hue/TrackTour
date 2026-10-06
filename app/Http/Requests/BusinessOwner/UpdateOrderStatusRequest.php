<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOrderStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['required', 'in:preparing,ready,cancelled'],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'status.required' => '订单状态为必填项。',
            'status.in' => '订单状态必须是准备中、已就绪或已取消。',
            'reason.max' => '原因不能超过500个字符。',
        ];
    }
}
