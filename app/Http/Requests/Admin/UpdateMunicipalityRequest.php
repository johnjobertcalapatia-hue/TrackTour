<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateMunicipalityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $municipality = $this->route('municipality');

        return [
            'name' => [
                'sometimes', 'required', 'string', 'max:255',
                Rule::unique('municipalities', 'name')->whereNull('deleted_at')->ignore($municipality?->id),
            ],
            'district' => ['sometimes', 'required', 'string', 'max:255'],
            'province' => ['sometimes', 'required', 'string', 'max:255'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => 'The municipality name is required.',
            'name.unique' => 'A municipality with this name already exists.',
            'district.required' => 'The district is required.',
            'province.required' => 'The province is required.',
        ];
    }
}
