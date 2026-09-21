<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

class UpdateBusinessRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'business_name' => ['sometimes', 'required', 'string', 'max:255'],
            'business_description' => ['sometimes', 'required', 'string', 'max:2000'],
            'business_category_id' => ['sometimes', 'required', 'exists:business_categories,id'],
            'tagline' => ['nullable', 'string', 'max:255'],
            'municipality_id' => ['sometimes', 'required', 'exists:municipalities,id'],
            'barangay_id' => ['sometimes', 'required', 'exists:barangays,id'],
            'address' => ['sometimes', 'required', 'string', 'max:500'],
            'contact_number' => ['sometimes', 'required', 'string', 'max:20'],
            'email' => ['sometimes', 'required', 'email'],
            'website' => ['nullable', 'url'],
            'facebook' => ['nullable', 'url'],
            'instagram' => ['nullable', 'url'],
            'other_social_media' => ['nullable', 'string', 'max:500'],
            'opening_time' => ['sometimes', 'required', 'date_format:H:i'],
            'closing_time' => ['sometimes', 'required', 'date_format:H:i', 'after:opening_time'],
            'business_days' => ['sometimes', 'required', 'array'],
            'latitude' => ['sometimes', 'required', 'numeric'],
            'longitude' => ['sometimes', 'required', 'numeric'],
            'details' => ['nullable', 'array'],
            'details.attraction_type' => ['nullable', 'string', 'max:100'],
            'details.entrance_fee' => ['nullable', 'numeric', 'min:0'],
            'details.best_time_to_visit' => ['nullable', 'string', 'max:255'],
            'details.activities' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function messages(): array
    {
        return [
            'business_name.required' => '商户名称为必填项。',
            'business_name.max' => '商户名称不能超过255个字符。',
            'business_description.required' => '商户描述为必填项。',
            'business_description.max' => '商户描述不能超过2000个字符。',
            'business_category_id.required' => '商户类别为必填项。',
            'business_category_id.exists' => '所选商户类别不存在。',
            'municipality_id.required' => '市/镇为必填项。',
            'municipality_id.exists' => '所选市/镇不存在。',
            'barangay_id.required' => '村/区为必填项。',
            'barangay_id.exists' => '所选村/区不存在。',
            'address.required' => '地址为必填项。',
            'address.max' => '地址不能超过500个字符。',
            'contact_number.required' => '联系电话为必填项。',
            'contact_number.max' => '联系电话不能超过20个字符。',
            'email.required' => '电子邮件为必填项。',
            'email.email' => '请输入有效的电子邮件地址。',
            'website.url' => '请输入有效的网站URL。',
            'facebook.url' => '请输入有效的Facebook URL。',
            'instagram.url' => '请输入有效的Instagram URL。',
            'opening_time.required' => '营业开始时间为必填项。',
            'opening_time.date_format' => '营业开始时间格式必须为 HH:MM。',
            'closing_time.required' => '营业结束时间为必填项。',
            'closing_time.date_format' => '营业结束时间格式必须为 HH:MM。',
            'closing_time.after' => '营业结束时间必须晚于开始时间。',
            'business_days.required' => '营业日为必填项。',
            'business_days.array' => '营业日必须是数组。',
            'latitude.required' => '纬度为必填项。',
            'latitude.numeric' => '纬度必须是数字。',
            'longitude.required' => '经度为必填项。',
            'longitude.numeric' => '经度必须是数字。',
        ];
    }
}
