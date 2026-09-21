<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return $this->successResponse(UserResource::make($request->user()->load('businesses', 'profile')));
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'sometimes|email|max:255',
            'phone' => 'sometimes|string|max:20',
        ]);
        $request->user()->update($validated);
        return $this->successResponse(UserResource::make($request->user()->fresh()), 'Profile updated.');
    }

    public function accountStatus(Request $request): JsonResponse
    {
        $user = $request->user();
        return $this->successResponse([
            'account_status' => $user->account_status,
            'email_verified' => $user->email_verified_at !== null,
            'businesses_count' => $user->businesses()->count(),
            'approved_businesses' => $user->businesses()->where('status', 'approved')->count(),
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'sometimes|email',
            'current_password' => 'required_with:new_password',
            'new_password' => 'sometimes|string|min:8|confirmed',
        ]);
        $user = $request->user();
        if (isset($validated['new_password'])) {
            if (!\Hash::check($validated['current_password'], $user->password)) {
                return $this->errorResponse('Current password is incorrect.', 422);
            }
            $user->password = \Hash::make($validated['new_password']);
            $user->save();
            unset($validated['current_password'], $validated['new_password']);
        }
        unset($validated['current_password']);
        if (!empty($validated)) {
            $user->update($validated);
        }
        return $this->successResponse(null, 'Settings updated.');
    }

    public function activityLogs(Request $request): JsonResponse
    {
        $logs = $request->user()->activityLogs()->latest()->paginate(20);
        return $this->paginatedResponse($logs);
    }
}
