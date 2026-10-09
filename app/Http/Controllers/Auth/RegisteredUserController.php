<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\Barangay;
use App\Models\Municipality;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules;

class RegisteredUserController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $rules = [
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255', 'unique:'.User::class],
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
            'role' => ['required', 'string', Rule::in(User::REGISTRABLE_ROLES)],
        ];

        if ($request->role === User::ROLE_BUSINESS_OWNER) {
            $rules = array_merge($rules, [
                'first_name' => ['required', 'string', 'max:255'],
                'middle_name' => ['nullable', 'string', 'max:255'],
                'last_name' => ['required', 'string', 'max:255'],
                'suffix' => ['nullable', 'string', 'max:50'],
                'date_of_birth' => ['required', 'date', 'before:today'],
                'sex' => ['required', 'string', Rule::in(User::SEX_OPTIONS)],
                'nationality' => ['required', 'string', Rule::in(User::NATIONALITIES)],
                'mobile_number' => ['required', 'string', 'max:20', Rule::unique('user_profiles', 'mobile_number')],
                'municipality_id' => ['required', 'integer', 'exists:municipalities,id'],
                'barangay' => [
                    'required',
                    'string',
                    'max:255',
                    function ($attribute, $value, $fail) use ($request) {
                        $exists = Barangay::where('municipality_id', $request->municipality_id)
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
        } elseif ($request->role === User::ROLE_RIDER) {
            $rules = array_merge($rules, [
                'first_name' => ['required', 'string', 'max:50', 'regex:/^[A-Za-z\s]+$/'],
                'middle_name' => ['nullable', 'string', 'max:50', 'regex:/^[A-Za-z\s]+$/'],
                'last_name' => ['required', 'string', 'max:50', 'regex:/^[A-Za-z\s]+$/'],
                'suffix' => ['nullable', 'string', 'in:Jr.,Sr.,II,III,IV,V'],
                'mobile_number' => [
                    'required',
                    'string',
                    'max:20',
                    'regex:/^(\+63|0)9\d{9}$/',
                    Rule::unique('user_profiles', 'mobile_number'),
                ],
                'otp_code' => ['required', 'string', 'size:6'],
                'referral_code' => ['nullable', 'string', 'max:50'],
                'confirm_age' => ['required', 'boolean', 'accepted'],
                'agree_terms' => ['required', 'boolean', 'accepted'],
                'agree_privacy' => ['required', 'boolean', 'accepted'],
            ]);
        } elseif (in_array($request->role, [User::ROLE_TOURIST, User::ROLE_TOURISM_OFFICE])) {
            $rules = array_merge($rules, [
                'first_name' => ['required', 'string', 'max:255'],
                'middle_name' => ['nullable', 'string', 'max:255'],
                'last_name' => ['required', 'string', 'max:255'],
                'date_of_birth' => ['required', 'date', 'before:today'],
                'mobile_number' => ['required', 'string', 'max:20', Rule::unique('user_profiles', 'mobile_number')],
            ]);
        }

        $request->validate($rules);

        $userData = [
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'role' => $request->role,
            'email_verified_at' => now(),
            'account_status' => $request->role === User::ROLE_BUSINESS_OWNER
                ? User::ACCOUNT_STATUS_PENDING
                : User::ACCOUNT_STATUS_APPROVED,
        ];

        if (in_array($request->role, [User::ROLE_BUSINESS_OWNER, User::ROLE_RIDER, User::ROLE_TOURIST, User::ROLE_TOURISM_OFFICE])) {
            $userData['name'] = trim($request->first_name.' '.$request->last_name);
        } else {
            $userData['name'] = $request->name;
        }

        $user = User::create($userData);

        if ($request->role === User::ROLE_BUSINESS_OWNER) {
            $barangay = Barangay::where('municipality_id', $request->municipality_id)
                ->where('name', $request->barangay)
                ->first();

            $user->profile()->create([
                'first_name' => $request->first_name,
                'middle_name' => $request->middle_name,
                'last_name' => $request->last_name,
                'suffix' => $request->suffix,
                'date_of_birth' => $request->date_of_birth,
                'sex' => $request->sex,
                'nationality' => $request->nationality,
                'mobile_number' => $request->mobile_number,
                'municipality_id' => $request->municipality_id,
                'barangay_id' => $barangay?->id,
                'house_no_street' => $request->house_no_street,
                'zip_code' => $request->zip_code,
            ]);

            $validIdFrontPath = $request->file('valid_id_front')?->store('ids', 'local');
            $validIdBackPath = $request->file('valid_id_back')?->store('ids', 'local');
            $selfiePath = $request->file('selfie_holding_id')?->store('ids', 'local');

            $user->kyc()->create([
                'government_id_type' => $request->government_id_type,
                'government_id_number' => $request->government_id_number,
                'valid_id_front' => $validIdFrontPath,
                'valid_id_back' => $validIdBackPath,
                'selfie_holding_id' => $selfiePath,
                'tin' => $request->tin,
                'verification_status' => 'pending',
            ]);
        } elseif ($request->role === User::ROLE_RIDER) {
            $user->profile()->create([
                'first_name' => $request->first_name,
                'middle_name' => $request->middle_name,
                'last_name' => $request->last_name,
                'suffix' => $request->suffix,
                'mobile_number' => $request->mobile_number,
            ]);

            $user->riderDetail()->create([
                'referral_code' => $request->referral_code,
                'rider_status' => User::RIDER_STATUS_OFFLINE,
                'current_service' => User::SERVICE_FOOD,
            ]);
        } elseif (in_array($request->role, [User::ROLE_TOURIST, User::ROLE_TOURISM_OFFICE])) {
            $user->profile()->create([
                'first_name' => $request->first_name,
                'middle_name' => $request->middle_name,
                'last_name' => $request->last_name,
                'mobile_number' => $request->mobile_number,
            ]);
        }

        event(new Registered($user));

        session()->forget('owner_registration');

        Auth::login($user);

        if ($user->role === User::ROLE_BUSINESS_OWNER) {
            session()->flash('success', 'Your Business Owner account has been created successfully! Your application is now pending review by the Municipal Tourism Office.');
        }

        return redirect(route('home', absolute: false));
    }

    public function saveStep(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'step' => ['nullable', 'string', Rule::in(['personal_information', 'contact_information', 'address_information', 'identity_verification'])],
            'data' => ['required', 'array'],
            'current_step' => ['nullable', 'integer', 'min:1', 'max:5'],
        ]);

        if ($validated['step']) {
            session()->put('owner_registration.'.$validated['step'], $validated['data']);
        }

        if ($validated['current_step']) {
            session()->put('owner_registration.current_step', $validated['current_step']);
        }

        return response()->json(['success' => true]);
    }

    public function checkUnique(Request $request): JsonResponse
    {
        $field = $request->input('field');
        $value = $request->input('value');

        $exists = match ($field) {
            'email' => User::where('email', $value)->exists(),
            'mobile_number' => UserProfile::where('mobile_number', $value)->exists(),
            'person' => UserProfile::where('first_name', $value['first_name'])
                ->where('last_name', $value['last_name'])
                ->where('date_of_birth', $value['date_of_birth'])
                ->exists(),
            default => false,
        };

        return response()->json(['unique' => ! $exists]);
    }

    public function getSessionData(): JsonResponse
    {
        return response()->json(
            session()->get('owner_registration', [
                'personal_information' => [],
                'contact_information' => [],
                'address_information' => [],
                'identity_verification' => [],
            ])
        );
    }
}
