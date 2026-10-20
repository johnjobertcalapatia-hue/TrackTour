<?php

namespace App\Http\Requests\Auth;

use App\Models\Barangay;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $rules = [
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255', 'unique:'.User::class],
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
            'role' => ['required', 'string', Rule::in(User::REGISTRABLE_ROLES)],
        ];

        if ($this->role === User::ROLE_BUSINESS_OWNER) {
            $rules = array_merge($rules, [
                'first_name' => ['required', 'string', 'max:255'],
                'middle_name' => ['nullable', 'string', 'max:255'],
                'last_name' => ['required', 'string', 'max:255'],
                'suffix' => ['nullable', 'string', 'max:50'],
                'date_of_birth' => ['required', 'date', 'before:today'],
                'sex' => ['required', 'string', Rule::in(User::SEX_OPTIONS)],
                'nationality' => ['required', 'string', Rule::in(User::NATIONALITIES)],
                'mobile_number' => ['required', 'string', 'max:20'],
                'municipality_id' => ['required', 'integer', 'exists:municipalities,id'],
                'barangay' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) {
                        $exists = Barangay::where('municipality_id', $this->municipality_id)
                            ->where('name', $value)
                            ->exists();
                        if (! $exists) {
                            $fail('The selected barangay is invalid.');
                        }
                    },
                ],
                'house_no_street' => ['required', 'string', 'max:255'],
                'zip_code' => ['nullable', 'string', 'max:10'],
                'government_id_type' => ['required', 'string', Rule::in(User::GOVERNMENT_ID_TYPES)],
                'government_id_number' => ['required', 'string', 'max:255'],
                'valid_id_front' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
                'valid_id_back' => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
                'selfie_holding_id' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
                'tin' => ['nullable', 'string', 'max:50'],
            ]);
        } elseif (in_array($this->role, [User::ROLE_RIDER, User::ROLE_TOURIST, User::ROLE_TOURISM_OFFICE])) {
            if (in_array($this->role, [User::ROLE_TOURIST, User::ROLE_TOURISM_OFFICE])) {
                $rules = array_merge($rules, [
                    'first_name' => ['required', 'string', 'max:255'],
                    'middle_name' => ['nullable', 'string', 'max:255'],
                    'last_name' => ['required', 'string', 'max:255'],
                    'date_of_birth' => ['required', 'date', 'before:today'],
                    'mobile_number' => ['required', 'string', 'max:20'],
                ]);
            } elseif ($this->role === User::ROLE_RIDER) {
                $adultCutoff = now()->subYears(18)->format('Y-m-d');

                $rules = array_merge($rules, [
                    'first_name' => ['required', 'string', 'max:50', 'regex:/^[A-Za-z\s]+$/'],
                    'middle_name' => ['nullable', 'string', 'max:50', 'regex:/^[A-Za-z\s]+$/'],
                    'last_name' => [
                        'required',
                        'string',
                        'max:50',
                        'regex:/^[A-Za-z\s]+$/',
                        // Identity dedup: a rider may not register twice under the
                        // same first name + last name + date of birth.
                        function ($attribute, $value, $fail) {
                            $first = trim((string) $this->input('first_name'));
                            $last = trim((string) $value);
                            $dob = $this->input('date_of_birth');

                            if ($first === '' || $last === '' || empty($dob)) {
                                return;
                            }

                            $exists = UserProfile::whereHas(
                                'user',
                                fn ($query) => $query->where('role', User::ROLE_RIDER)
                            )
                                ->whereRaw('LOWER(first_name) = ?', [mb_strtolower($first)])
                                ->whereRaw('LOWER(last_name) = ?', [mb_strtolower($last)])
                                ->whereDate('date_of_birth', $dob)
                                ->exists();

                            if ($exists) {
                                $fail('A rider with the same first name, last name, and date of birth is already registered.');
                            }
                        },
                    ],
                    'suffix' => ['nullable', 'string', 'in:Jr.,Sr.,II,III,IV,V'],
                    'date_of_birth' => ['required', 'date', 'before_or_equal:'.$adultCutoff],
                    'mobile_number' => [
                        'required',
                        'string',
                        'max:20',
                        'regex:/^(\+63|0)9\d{9}$/',
                        'unique:user_profiles,mobile_number',
                    ],
                    'otp_code' => ['required', 'string', 'size:6'],
                    'referral_code' => ['nullable', 'string', 'max:50'],
                    'confirm_age' => ['required', 'boolean', 'accepted'],
                    'agree_terms' => ['required', 'boolean', 'accepted'],
                    'agree_privacy' => ['required', 'boolean', 'accepted'],
                ]);
            }
        }

        return $rules;
    }
}
