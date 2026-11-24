<?php

namespace App\Http\Requests\BusinessOwner;

use Illuminate\Foundation\Http\FormRequest;

/** Update a promotion; accepts both field shapes (see StorePromotionRequest). */
class UpdatePromotionRequest extends FormRequest
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
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            ...PromotionInput::rules(),
        ];
    }

    public function messages(): array
    {
        return PromotionInput::messages();
    }
}
