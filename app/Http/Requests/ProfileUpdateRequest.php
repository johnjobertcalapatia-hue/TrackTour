<?php

namespace App\Http\Requests;

use App\Models\Barangay;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ProfileUpdateRequest extends FormRequest
{
    public function rules(): array
    {
        $rules = [
            'name' => ['required', 'string', 'max:255'],
            'email' => [
                'required',
                'string',
                'lowercase',
                'email',
                'max:255',
                Rule::unique(User::class)->ignore($this->user()->id),
            ],
        ];

        if ($this->user()->role === User::ROLE_BUSINESS_OWNER) {
            $rules['first_name'] = ['required', 'string', 'max:255'];
            $rules['middle_name'] = ['nullable', 'string', 'max:255'];
            $rules['last_name'] = ['required', 'string', 'max:255'];
            $rules['suffix'] = ['nullable', 'string', 'in:Jr.,Sr.,II,III,IV'];
            $rules['date_of_birth'] = ['required', 'date'];
            $rules['sex'] = ['nullable', 'string', Rule::in(User::SEX_OPTIONS)];
            $rules['nationality'] = ['required', 'string', Rule::in(User::NATIONALITIES)];
            $rules['mobile_number'] = ['required', 'string', 'max:20'];
            $rules['barangay'] = [
                'nullable',
                'string',
                'max:255',
                function ($attribute, $value, $fail) {
                    $municipalityId = $this->user()->profile?->municipality_id;
                    if ($value && $municipalityId) {
                        $exists = Barangay::where('municipality_id', $municipalityId)
                            ->where('name', $value)
                            ->exists();
                        if (! $exists) {
                            $fail('The selected barangay is invalid.');
                        }
                    }
                },
            ];
            $rules['house_no_street'] = ['required', 'string', 'max:255'];
            $rules['zip_code'] = ['nullable', 'string', 'max:10'];
            $rules['tin'] = ['nullable', 'string', 'max:50'];
        }

        return $rules;
    }
}
