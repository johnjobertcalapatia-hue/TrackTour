<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MunicipalityLocator;
use App\Traits\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/municipalities/locate?lat=&lng=
 *
 * Resolves the municipality a visitor is currently in, used to personalise
 * the tourist "Discover <municipality>" card. Picks the nearest municipality
 * centre that has coordinates; anything farther than MAX_DISTANCE_KM (i.e.
 * outside the covered municipalities) resolves to null so the client keeps
 * its default.
 */
class MunicipalityLocateController extends Controller
{
    use ApiResponse;

    public const MAX_DISTANCE_KM = MunicipalityLocator::MAX_DISTANCE_KM;

    public function __invoke(Request $request, MunicipalityLocator $locator): JsonResponse
    {
        $validated = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $found = $locator->nearest((float) $validated['lat'], (float) $validated['lng']);

        if ($found === null) {
            return $this->successResponse(null, 'No covered municipality near this location.');
        }

        $nearest = $found['municipality'];

        return $this->successResponse([
            'id' => $nearest->id,
            'name' => $nearest->name,
            'province' => $nearest->province,
            'cover_photo' => $nearest->cover_photo,
            'distance_km' => round($found['km'], 2),
        ], 'Municipality located.');
    }
}
