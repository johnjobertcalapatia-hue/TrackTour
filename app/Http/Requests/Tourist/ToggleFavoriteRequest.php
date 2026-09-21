<?php

namespace App\Http\Requests\Tourist;

use Illuminate\Foundation\Http\FormRequest;

class ToggleFavoriteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'business_id' => ['required_without:favoritable_id', 'integer'],
            'favoritable_type' => ['nullable', 'string'],
            'favoritable_id' => ['required_without:business_id', 'integer'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if ($this->filled('business_id') && empty($this->favoritable_type)) {
            $this->merge([
                'favoritable_type' => \App\Models\Business::class,
                'favoritable_id' => $this->business_id,
            ]);
        }
    }
}
