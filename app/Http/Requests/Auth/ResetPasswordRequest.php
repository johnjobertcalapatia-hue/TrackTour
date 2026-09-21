<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class ResetPasswordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'token' => ['required'],
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ];
    }

    public function messages(): array
    {
        return [
            'token.required' => '重置令牌为必填项。',
            'email.required' => '电子邮件为必填项。',
            'email.email' => '请输入有效的电子邮件地址。',
            'password.required' => '新密码为必填项。',
            'password.min' => '密码长度不能少于8个字符。',
            'password.confirmed' => '两次输入的密码不一致。',
        ];
    }
}
