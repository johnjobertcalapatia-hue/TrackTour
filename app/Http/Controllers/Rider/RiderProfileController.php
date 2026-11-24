<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class RiderProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return $this->successResponse($this->payload($request, $request->user()));
    }

    /**
     * Name and email live on users; the phone on user_profiles. The rider's
     * municipality and barangay are set at registration (the municipality's
     * Tourism Office trains, interviews and manages the rider) and cannot be
     * changed here: a request that tries is refused, never silently applied.
     */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
            'municipality_id' => ['prohibited'],
            'barangay_id' => ['prohibited'],
            'municipality' => ['prohibited'],
            'barangay' => ['prohibited'],
        ], [
            'municipality_id.prohibited' => 'Your municipality was set when you registered and cannot be changed.',
            'barangay_id.prohibited' => 'Your barangay was set when you registered and cannot be changed.',
            'municipality.prohibited' => 'Your municipality was set when you registered and cannot be changed.',
            'barangay.prohibited' => 'Your barangay was set when you registered and cannot be changed.',
        ]);

        DB::transaction(function () use ($user, $validated) {
            $user->update(array_intersect_key($validated, array_flip(['name', 'email'])));

            if (array_key_exists('phone', $validated)) {
                $user->profile()->updateOrCreate([], ['mobile_number' => $validated['phone']]);
            }
        });

        return $this->successResponse($this->payload($request, $user->fresh()), 'Profile updated.');
    }

    public function uploadPhoto(Request $request): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        $user = $request->user();
        $old = $user->profile?->avatar;

        $path = $request->file('photo')->store('profiles', 'public');

        $user->profile()->updateOrCreate([], ['avatar' => $path]);

        if ($old && $old !== $path) {
            Storage::disk('public')->delete($old);
        }

        return $this->successResponse(
            $this->payload($request, $user->fresh()),
            'Profile photo updated.'
        );
    }

    /**
     * The shared user resource plus the rider's address. A photo whose file
     * is missing from the public disk is reported as no photo, so the page
     * shows initials instead of a broken image.
     */
    private function payload(Request $request, User $user): array
    {
        $user->load('riderDetail', 'profile.municipality:id,name', 'profile.barangay:id,name', 'municipality:id,name');
        $profile = $user->profile;

        $data = UserResource::make($user)->resolve($request);

        $avatar = $profile?->avatar;
        if ($avatar && ! Storage::disk('public')->exists($avatar)) {
            $avatar = null;
        }

        return array_merge($data, [
            'profile_photo' => $avatar,
            'address_municipality_id' => $profile?->municipality_id ?? $user->municipality_id,
            'address_barangay_id' => $profile?->barangay_id,
            'municipality' => $profile?->municipality?->name ?? $user->municipality?->name,
            'barangay' => $profile?->barangay?->name,
        ]);
    }
}
