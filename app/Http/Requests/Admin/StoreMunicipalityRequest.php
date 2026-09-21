<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class StoreMunicipalityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'province' => ['required', 'string', 'max:255'],
            'region' => ['required', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => '市/镇名称为必填项。',
            'name.max' => '市/镇名称不能超过255个字符。',
            'province.required' => '省份为必填项。',
            'province.max' => '省份不能超过255个字符。',
            'region.required' => '地区为必填项。',
            'region.max' => '地区不能超过255个字符。',
        ];
    }
}
