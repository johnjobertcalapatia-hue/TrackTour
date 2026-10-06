<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class RiderProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return $this->successResponse(UserResource::make($request->user()->load('riderDetail', 'profile')));
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'phone' => 'sometimes|string|max:20',
            'email' => 'sometimes|email|max:255',
        ]);

        $request->user()->update($validated);

        return $this->successResponse(UserResource::make($request->user()->fresh()->load('riderDetail', 'profile')), 'Profile updated.');
    }

    public function uploadPhoto(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'photo' => ['required', 'image', 'max:2048'],
        ]);

        $user = $request->user();
        $profile = $user->profile;

        if ($profile?->avatar) {
            Storage::disk('public')->delete($profile->avatar);
        }

        $path = $request->file('photo')->store('profiles', 'public');

        $user->profile()->updateOrCreate([], ['avatar' => $path]);

        return $this->successResponse(
            UserResource::make($user->fresh()->load('riderDetail', 'profile')),
            'Profile photo updated.'
        );
    }
}
