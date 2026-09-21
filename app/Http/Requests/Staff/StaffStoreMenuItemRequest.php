<?php

namespace App\Http\Requests\Staff;

use Illuminate\Foundation\Http\FormRequest;

class StaffStoreMenuItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:1000'],
            'price' => ['required', 'numeric', 'min:0'],
            'offering_category_id' => ['nullable', 'integer', 'exists:offering_categories,id'],
            'is_available' => ['nullable', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => '菜品名称为必填项。',
            'name.max' => '菜品名称不能超过255个字符。',
            'description.max' => '菜品描述不能超过1000个字符。',
            'price.required' => '价格为必填项。',
            'price.numeric' => '价格必须是数字。',
            'price.min' => '价格不能低于0。',
            'is_available.boolean' => '可用状态必须是布尔值。',
        ];
    }
}
