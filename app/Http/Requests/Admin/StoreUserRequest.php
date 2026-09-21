<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class StoreUserRequest extends FormRequest
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
            'role' => ['required', 'in:tourist,business_owner,rider,tourism_office,bansud_tourism_office'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => '姓名为必填项。',
            'name.max' => '姓名不能超过255个字符。',
            'email.required' => '电子邮件为必填项。',
            'email.email' => '请输入有效的电子邮件地址。',
            'email.unique' => '该电子邮件已被注册。',
            'role.required' => '角色为必填项。',
            'role.in' => '角色必须是游客、商户所有者、骑手、旅游局或Bansud旅游局之一。',
            'password.required' => '密码为必填项。',
            'password.min' => '密码长度不能少于8个字符。',
            'password.confirmed' => '两次输入的密码不一致。',
        ];
    }
}
