<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Services\TransportationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Ride pickup/destination selection sources (Phase 2 — local registry search).
 *
 * Both endpoints are read-only lookups over the same local registry the rest of
 * the tourist experience uses (destinations, approved businesses, municipalities,
 * barangays). No external geocoder is involved.
 */
class TransportLocationController extends Controller
{
    public function __construct(protected TransportationService $transport) {}

    public function search(Request $request): JsonResponse
    {
        $q = (string) $request->query('q', '');

        return $this->successResponse($this->transport->searchLocations($q));
    }

    public function reverseGeocode(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'lat' => 'required|numeric|between:-90,90',
            'lng' => 'required|numeric|between:-180,180',
        ]);

        return $this->successResponse($this->transport->reverseGeocodeLocation(
            (float) $validated['lat'],
            (float) $validated['lng'],
        ));
    }
}