<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tourist\UpdateTouristProfileRequest;
use App\Http\Resources\UserResource;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;

class TouristProfileController extends Controller
{
    public function __construct(private UserService $userService) {}

    public function show(Request $request)
    {
        $user = Auth::user()->load('profile');

        if ($request->expectsJson()) {
            return $this->successResponse(UserResource::make($user));
        }

        return response()->json($user);
    }

    public function edit()
    {
        $user = Auth::user()->load('profile');

        return response()->json($user);
    }

    public function update(UpdateTouristProfileRequest $request): JsonResponse
    {
        $user = Auth::user();

        $this->userService->updateUser($user, $request->only('email'));

        if ($user->profile) {
            $user->profile->update([
                'first_name' => $request->name,
                'mobile_number' => $request->mobile_number,
            ]);
        }

        return $this->successResponse(
            UserResource::make($user->fresh()->load('profile')),
            'Profile updated successfully.'
        );
    }

    /**
     * POST /api/tourist/profile/photo — the tourist's profile picture
     * (sidebar avatar, profile page, map "you are here" pin). Stored on
     * user_profiles.avatar, the column UserResource exposes as profile_photo;
     * the previous file is deleted so replacements don't pile up.
     */
    public function uploadPhoto(Request $request): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
        ]);

        $user = $request->user();
        $old = $user->profile?->avatar;

        $path = $request->file('photo')->store('profiles', 'public');
        $user->profile()->updateOrCreate([], ['avatar' => $path]);

        if ($old) {
            Storage::disk('public')->delete($old);
        }

        return $this->successResponse(
            UserResource::make($user->fresh()->load('profile')),
            'Profile photo updated.'
        );
    }

    /** DELETE /api/tourist/profile/photo — back to the initials avatar. */
    public function deletePhoto(Request $request): JsonResponse
    {
        $user = $request->user();
        $old = $user->profile?->avatar;

        if ($old) {
            $user->profile->update(['avatar' => null]);
            Storage::disk('public')->delete($old);
        }

        return $this->successResponse(
            UserResource::make($user->fresh()->load('profile')),
            'Profile photo removed.'
        );
    }
}
