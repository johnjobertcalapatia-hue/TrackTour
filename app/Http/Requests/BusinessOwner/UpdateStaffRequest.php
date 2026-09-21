<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

class UpdateStaffRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['required', 'email'],
            'phone' => ['nullable', 'string', 'max:20'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => '员工姓名为必填项。',
            'name.max' => '员工姓名不能超过255个字符。',
            'email.required' => '电子邮件为必填项。',
            'email.email' => '请输入有效的电子邮件地址。',
            'phone.max' => '电话号码不能超过20个字符。',
        ];
    }
}
