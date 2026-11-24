<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Create a promotion (owner or Menu & Promotions staff).
 *
 * The owner page sends discount_type / discount_value / start_date / end_date /
 * business_id, while the API originally expected discount_percentage /
 * valid_from / valid_until and had no business_id rule, so creating a
 * promotion failed. Both shapes are accepted (Staff Management §5).
 */
class StorePromotionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->merge(PromotionInput::normalize($this->all()));
    }

    public function rules(): array
    {
        return [
            'business_id' => ['required', 'integer', 'exists:businesses,id'],
            'title' => ['required', 'string', 'max:255'],
            ...PromotionInput::rules(),
        ];
    }

    public function messages(): array
    {
        return PromotionInput::messages();
    }
}
