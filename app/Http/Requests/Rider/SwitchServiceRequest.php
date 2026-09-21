<?php

namespace App\Http\Requests\Rider;

use Illuminate\Foundation\Http\FormRequest;

class SwitchServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'service_type' => ['required', 'in:delivery,tour'],
        ];
    }

    public function messages(): array
    {
        return [
            'service_type.required' => '服务类型为必填项。',
            'service_type.in' => '服务类型必须是配送或导游之一。',
        ];
    }
}
