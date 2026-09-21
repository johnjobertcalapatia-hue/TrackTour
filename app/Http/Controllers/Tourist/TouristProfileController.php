<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tourist\UpdateTouristProfileRequest;
use App\Http\Resources\UserResource;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

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

    public function uploadPhoto(Request $request)
    {
        $request->validate([
            'photo' => ['required', 'image', 'max:2048'],
        ]);

        $user = Auth::user();
        $path = $request->file('photo')->store('profiles', 'public');

        if ($user->profile) {
            $user->profile->update(['profile_photo' => $path]);
        }

        return back()->with('success', 'Profile photo updated.');
    }
}
