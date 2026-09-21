<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

class StoreStaffRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:20'],
            'role' => ['required', 'in:staff,1,2'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => '员工姓名为必填项。',
            'name.max' => '员工姓名不能超过255个字符。',
            'email.required' => '电子邮件为必填项。',
            'email.email' => '请输入有效的电子邮件地址。',
            'email.unique' => '该电子邮件已被注册。',
            'phone.max' => '电话号码不能超过20个字符。',
            'role.required' => '角色为必填项。',
            'role.in' => '角色必须是staff、1或2。',
        ];
    }
}
