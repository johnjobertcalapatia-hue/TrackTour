<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

class StorePromotionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:1000'],
            'discount_percentage' => ['required', 'numeric', 'min:1', 'max:100'],
            'valid_from' => ['required', 'date'],
            'valid_until' => ['required', 'date', 'after_or_equal:valid_from'],
        ];
    }

    public function messages(): array
    {
        return [
            'title.required' => '促销标题为必填项。',
            'title.max' => '促销标题不能超过255个字符。',
            'description.max' => '促销描述不能超过1000个字符。',
            'discount_percentage.required' => '折扣百分比为必填项。',
            'discount_percentage.numeric' => '折扣百分比必须是数字。',
            'discount_percentage.min' => '折扣百分比不能低于1%。',
            'discount_percentage.max' => '折扣百分比不能超过100%。',
            'valid_from.required' => '有效期开始日期为必填项。',
            'valid_from.date' => '有效期开始日期必须是有效日期。',
            'valid_until.required' => '有效期结束日期为必填项。',
            'valid_until.date' => '有效期结束日期必须是有效日期。',
            'valid_until.after_or_equal' => '有效期结束日期必须等于或晚于开始日期。',
        ];
    }
}
