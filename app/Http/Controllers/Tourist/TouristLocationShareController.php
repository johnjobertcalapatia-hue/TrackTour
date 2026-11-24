<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\TouristLocationShare;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Opt-in sharing of the tourist's live location with the Bansud Tourism
 * Office. Off by default; only the latest position is kept.
 */
class TouristLocationShareController extends Controller
{
    /** GET /tourist/location-sharing */
    public function show(Request $request): JsonResponse
    {
        return $this->successResponse($this->present($this->shareFor($request)));
    }

    /** PUT /tourist/location-sharing {enabled} */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(['enabled' => ['required', 'boolean']]);
        $share = $this->shareFor($request);

        if ($data['enabled']) {
            $share->fill(['enabled' => true, 'consented_at' => now()])->save();
        } else {
            $share->fill(['enabled' => false])->save();
            $share->clearPosition();
        }

        return $this->successResponse(
            $this->present($share->fresh()),
            $data['enabled'] ? 'Location sharing turned on.' : 'Location sharing turned off and your location was removed.'
        );
    }

    /** POST /tourist/location-sharing/ping {latitude, longitude, accuracy?} */
    public function ping(Request $request): JsonResponse
    {
        $data = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'accuracy' => ['nullable', 'numeric', 'min:0', 'max:100000'],
        ]);

        $share = TouristLocationShare::where('user_id', $request->user()->id)->first();
        if (! $share?->enabled) {
            return $this->errorResponse('Location sharing is off.', 409);
        }
        // An exact 0 on an axis is a broken reading, never a real position here.
        if ((float) $data['latitude'] == 0.0 || (float) $data['longitude'] == 0.0) {
            return $this->errorResponse('Your device reported an invalid location.', 422);
        }

        $share->forceFill([
            'latitude' => $data['latitude'],
            'longitude' => $data['longitude'],
            'accuracy_m' => $data['accuracy'] ?? null,
            'location_at' => now(),
        ])->save();

        return $this->successResponse(['location_at' => $share->location_at?->toIso8601String()]);
    }

    private function shareFor(Request $request): TouristLocationShare
    {
        return TouristLocationShare::firstOrCreate(['user_id' => $request->user()->id], ['enabled' => false]);
    }

    private function present(TouristLocationShare $share): array
    {
        return [
            'enabled' => $share->enabled,
            'consented_at' => $share->consented_at?->toIso8601String(),
            'location_at' => $share->location_at?->toIso8601String(),
        ];
    }
}
