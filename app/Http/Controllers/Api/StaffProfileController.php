<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Services\StaffAccess;
use App\Support\StaffPermissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rules\Password;

/**
 * The staff member's own profile (2026-11-24). Staff see their details and
 * what their roles allow; they may change only their contact details, photo
 * and password. Name, email, roles, pay, status and hire date stay with the
 * business owner (BusinessOwnerStaffController). Every route sits behind
 * staff.active, so a suspended or removed staff member reaches none of it.
 */
class StaffProfileController extends Controller
{
    private function staff(Request $request): Staff
    {
        $staff = $request->attributes->get('staff') ?? app(StaffAccess::class)->activeStaff($request->user());
        abort_unless($staff, 404, 'No staff profile found.');

        return $staff;
    }

    /** GET /staff/profile */
    public function show(Request $request): JsonResponse
    {
        return $this->successResponse($this->present($this->staff($request)));
    }

    /** PUT /staff/profile: contact details only. */
    public function update(Request $request): JsonResponse
    {
        $staff = $this->staff($request);
        $validated = $request->validate([
            'mobile_number' => ['nullable', 'string', 'max:20', 'regex:/^[0-9+()\-\s]*$/'],
            'address' => ['nullable', 'string', 'max:500'],
        ], [
            'mobile_number.regex' => 'Use digits only, e.g. 09171234567.',
        ]);

        $mobile = ($validated['mobile_number'] ?? null) ?: null;
        $address = ($validated['address'] ?? null) ?: null;

        DB::transaction(function () use ($staff, $mobile, $address) {
            $staff->update(['mobile_number' => $mobile, 'address' => $address]);
            $staff->user->profile?->update(['mobile_number' => $mobile, 'house_no_street' => $address]);
        });
        StaffActivityLog::record($staff, 'staff.contact_updated', "{$staff->full_name} updated their contact details.");

        return $this->successResponse($this->present($staff->fresh()), 'Contact details saved.');
    }

    /** POST /staff/profile/photo */
    public function uploadPhoto(Request $request): JsonResponse
    {
        $staff = $this->staff($request);
        $request->validate([
            'photo' => ['required', 'file', 'mimes:jpg,jpeg,png', 'max:2048'],
        ], [
            'photo.mimes' => 'Use a JPG or PNG photo.',
            'photo.max' => 'The photo must be 2 MB or smaller.',
        ]);

        $old = $staff->profile_picture;
        $staff->update(['profile_picture' => $request->file('photo')->store('staff/profile-pictures', 'public')]);
        if ($old) {
            Storage::disk('public')->delete($old);
        }

        return $this->successResponse($this->present($staff->fresh()), 'Profile photo updated.');
    }

    /** DELETE /staff/profile/photo */
    public function deletePhoto(Request $request): JsonResponse
    {
        $staff = $this->staff($request);
        if ($old = $staff->profile_picture) {
            $staff->update(['profile_picture' => null]);
            Storage::disk('public')->delete($old);
        }

        return $this->successResponse($this->present($staff->fresh()), 'Profile photo removed.');
    }

    /**
     * PUT /staff/profile/password: needs the current password. Every other
     * signed-in session is signed out; this one stays.
     */
    public function updatePassword(Request $request): JsonResponse
    {
        $staff = $this->staff($request);
        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'confirmed', Password::min(8), 'different:current_password'],
        ], [
            'password.different' => 'Choose a password different from your current one.',
        ]);

        $user = $request->user();
        if (! Hash::check($validated['current_password'], $user->password)) {
            return $this->errorResponse('Your current password is incorrect.', 422, ['current_password' => ['Your current password is incorrect.']]);
        }

        $user->forceFill(['password' => Hash::make($validated['password'])])->save();
        $currentTokenId = $user->currentAccessToken()?->id;
        $user->tokens()->when($currentTokenId, fn ($q) => $q->whereKeyNot($currentTokenId))->delete();
        StaffActivityLog::record($staff, 'staff.password_changed', "{$staff->full_name} changed their password.");

        return $this->successResponse(null, 'Password changed. Other devices were signed out.');
    }

    private function present(Staff $staff): array
    {
        $staff->loadMissing(['user.profile', 'business.category', 'staffRole', 'roles']);
        $profile = $staff->user?->profile;
        $granted = $staff->grantedPermissions();

        return [
            'id' => $staff->id,
            'employee_id' => $staff->employee_id,
            'full_name' => $staff->full_name,
            'first_name' => $profile?->first_name,
            'middle_name' => $staff->middle_name,
            'last_name' => $profile?->last_name,
            'suffix' => $staff->suffix,
            'email' => $staff->user?->email,
            'mobile_number' => $staff->mobile_number,
            'address' => $staff->address,
            'gender' => $staff->gender,
            'date_of_birth' => $staff->date_of_birth?->toDateString(),
            'profile_picture' => $staff->profile_picture,
            'status' => $staff->status,
            'roles' => $staff->roleNames(),
            'date_hired' => $staff->date_hired?->toDateString(),
            'employment_status' => $staff->employment_status,
            'last_login_at' => $staff->last_login_at?->toIso8601String(),
            'business' => [
                'id' => $staff->business?->id,
                'name' => $staff->business?->business_name,
                'category' => $staff->business?->category?->name,
                'logo' => $staff->business?->logo,
            ],
            // What the roles allow, in plain words (StaffPermissions::CATALOGUE).
            'permissions' => collect($granted)
                ->filter(fn ($key) => isset(StaffPermissions::CATALOGUE[$key]))
                ->map(fn ($key) => ['key' => $key, 'group' => StaffPermissions::CATALOGUE[$key][0], 'label' => StaffPermissions::CATALOGUE[$key][1]])
                ->values(),
        ];
    }
}
