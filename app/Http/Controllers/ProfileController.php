<?php

namespace App\Http\Controllers;

use App\Http\Requests\ProfileUpdateRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Support\Facades\Storage;
class ProfileController extends Controller
{
    public function update(ProfileUpdateRequest $request): RedirectResponse
    {
        $user = $request->user();
        $user->fill($request->validated());

        if ($user->isDirty('email')) {
            $user->email_verified_at = null;
        }

        $user->save();

        if ($user->role === User::ROLE_BUSINESS_OWNER) {
            $profileData = $request->only([
                'first_name', 'middle_name', 'last_name', 'suffix',
                'date_of_birth', 'sex', 'nationality', 'mobile_number',
                'barangay', 'house_no_street', 'zip_code',
            ]);

            if ($user->profile) {
                $user->profile()->update($profileData);
            }

            foreach (['valid_id_front', 'valid_id_back', 'selfie_holding_id'] as $field) {
                if ($request->hasFile($field)) {
                    $kyc = $user->kyc;
                    if ($kyc && $kyc->$field) {
                        Storage::disk('public')->delete($kyc->$field);
                    }
                    $path = $request->file($field)->store('ids', 'public');
                    if ($kyc) {
                        $kyc->update([$field => $path]);
                    }
                }
            }
        }

        return Redirect::route('profile.edit')->with('status', 'profile-updated');
    }

    public function destroy(Request $request): RedirectResponse
    {
        $request->validateWithBag('userDeletion', [
            'password' => ['required', 'current_password'],
        ]);

        $user = $request->user();

        Auth::logout();

        $user->update(['account_status' => 'archived']);

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return Redirect::to('/')->with('success', 'Your account has been archived.');
    }
}
