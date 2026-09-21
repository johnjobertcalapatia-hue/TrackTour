<?php

namespace App\Http\Requests\Tourist;

use Illuminate\Foundation\Http\FormRequest;

class CreateMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'room_id' => ['required', 'integer'],
            'content' => ['required', 'string', 'max:2000'],
        ];
    }

    public function messages(): array
    {
        return [
            'room_id.required' => '聊天室ID为必填项。',
            'room_id.integer' => '聊天室ID必须是整数。',
            'content.required' => '消息内容为必填项。',
            'content.string' => '消息内容必须是字符串。',
            'content.max' => '消息内容不能超过2000个字符。',
        ];
    }
}
