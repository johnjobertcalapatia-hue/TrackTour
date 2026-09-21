<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class UpdateUserRequest extends FormRequest
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
            'role' => ['required', 'in:tourist,business_owner,rider,tourism_office,bansud_tourism_office'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => '姓名为必填项。',
            'name.max' => '姓名不能超过255个字符。',
            'email.required' => '电子邮件为必填项。',
            'email.email' => '请输入有效的电子邮件地址。',
            'role.required' => '角色为必填项。',
            'role.in' => '角色必须是游客、商户所有者、骑手、旅游局或Bansud旅游局之一。',
        ];
    }
}
