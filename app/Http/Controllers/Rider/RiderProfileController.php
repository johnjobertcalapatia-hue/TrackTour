<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RiderProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return $this->successResponse(UserResource::make($request->user()->load('riderDetail')));
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'phone' => 'sometimes|string|max:20',
            'email' => 'sometimes|email|max:255',
        ]);

        $request->user()->update($validated);

        return $this->successResponse(UserResource::make($request->user()->fresh()->load('riderDetail')), 'Profile updated.');
    }
}
