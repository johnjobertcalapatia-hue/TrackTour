<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Services\RiderDestinationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Rider "My Destination": set a preferred end point (e.g. heading home) so
 * only offers on the way to it are received. See RiderDestinationService.
 */
class RiderDestinationController extends Controller
{
    public function __construct(private RiderDestinationService $destinations) {}

    public function show(Request $request): JsonResponse
    {
        return $this->successResponse($this->destinations->state($request->user()));
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90', 'not_in:0'],
            'longitude' => ['required', 'numeric', 'between:-180,180', 'not_in:0'],
            'label' => ['nullable', 'string', 'max:160'],
        ]);

        return $this->successResponse(
            $this->destinations->set($request->user(), (float) $validated['latitude'], (float) $validated['longitude'], $validated['label'] ?? null),
            'My Destination is on. You will only get offers on your way.'
        );
    }

    public function destroy(Request $request): JsonResponse
    {
        return $this->successResponse($this->destinations->clear($request->user()), 'My Destination is off.');
    }
}
