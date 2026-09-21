<?php

namespace App\Http\Requests\Rider;

use Illuminate\Foundation\Http\FormRequest;

class UpdateLocationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'latitude' => ['required', 'numeric'],
            'longitude' => ['required', 'numeric'],
        ];
    }

    public function messages(): array
    {
        return [
            'latitude.required' => '纬度为必填项。',
            'latitude.numeric' => '纬度必须是数字。',
            'longitude.required' => '经度为必填项。',
            'longitude.numeric' => '经度必须是数字。',
        ];
    }
}
