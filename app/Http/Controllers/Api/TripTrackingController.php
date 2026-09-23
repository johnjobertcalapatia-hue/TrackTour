<?php

namespace App\Http\Controllers\Api;

use App\Enums\TripStatus;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\RiderLocation;
use App\Models\TripLog;
use App\Models\User;
use App\Services\GpsService;
use App\Services\LocationPersistenceService;
use App\Services\PolylineEncoder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class TripTrackingController extends Controller
{
    public function __construct(
        private LocationPersistenceService $persistence,
    ) {}

    /**
     * Start a trip - mark it active in the database
     * POST /api/trips/{trip}/start
     */
    public function start(Delivery $trip): JsonResponse
    {
        $guide = Auth::user();

        if ($trip->guide_id !== $guide->id) {
            return response()->json([
                'success' => false,
                'message' => 'Not assigned to this trip.',
            ], 403);
        }

        $currentStatus = TripStatus::tryFrom($trip->status);
        if (! $currentStatus || ! $currentStatus->isActive()) {
            return response()->json([
                'success' => false,
                'message' => 'Trip cannot be started in current status.',
            ], 422);
        }

        $tourist = $trip->order?->customer;
        if (! $tourist) {
            return response()->json([
                'success' => false,
                'message' => 'No tourist assigned to this trip.',
            ], 422);
        }

        try {
            DB::transaction(function () use ($trip, $guide) {
                $trip->update([
                    'status' => TripStatus::TOUR_STARTED->value,
                    'started_at' => now(),
                ]);

                $guide->riderDetail()->updateOrCreate(
                    ['user_id' => $guide->id],
                    ['rider_status' => User::RIDER_STATUS_BUSY, 'rider_status_updated_at' => now()]
                );
            });

            return response()->json([
                'success' => true,
                'message' => 'Trip started successfully.',
                'data' => [
                    'trip_id' => $trip->id,
                    'status' => TripStatus::TOUR_STARTED->value,
                    'guide_id' => $guide->id,
                ],
            ]);
        } catch (\Exception $e) {
            \Log::error('Trip start failed: '.$e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to start trip.',
            ], 500);
        }
    }

    /**
     * Update guide location during trip
     * POST /api/trips/{trip}/location
     */
    public function updateLocation(Request $request, Delivery $trip): JsonResponse
    {
        $guide = Auth::user();

        if ($trip->guide_id !== $guide->id) {
            return response()->json([
                'success' => false,
                'message' => 'Not assigned to this trip.',
            ], 403);
        }

        $currentStatus = TripStatus::tryFrom($trip->status);
        if (! $currentStatus || ! $currentStatus->isActive()) {
            return response()->json([
                'success' => false,
                'message' => 'Trip is not active.',
            ], 422);
        }

        $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'heading' => ['nullable', 'numeric', 'between:0,360'],
            'speed' => ['nullable', 'numeric', 'min:0'],
            'accuracy' => ['nullable', 'numeric', 'min:0'],
            'device_time' => ['nullable', 'integer'],
        ]);

        $lat = (float) $request->latitude;
        $lng = (float) $request->longitude;
        $heading = $request->has('heading') ? (float) $request->heading : null;
        $speed = $request->has('speed') ? (float) $request->speed : null;
        $accuracy = $request->has('accuracy') ? (float) $request->accuracy : null;

        if ($accuracy !== null && $accuracy > 50) {
            return response()->json([
                'success' => true,
                'message' => 'GPS accuracy too low, reading ignored.',
            ]);
        }

        // MySQL: save checkpoint only if moved > 5m or 60s elapsed
        if ($this->persistence->shouldSave($guide->id, $lat, $lng)) {
            RiderLocation::create([
                'rider_id' => $guide->id,
                'latitude' => $lat,
                'longitude' => $lng,
                'recorded_at' => now(),
            ]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Location updated.',
        ]);
    }

    /**
     * End a trip - mark it completed in the database
     * POST /api/trips/{trip}/end
     */
    public function end(Delivery $trip): JsonResponse
    {
        $guide = Auth::user();

        if ($trip->guide_id !== $guide->id) {
            return response()->json([
                'success' => false,
                'message' => 'Not assigned to this trip.',
            ], 403);
        }

        $currentStatus = TripStatus::tryFrom($trip->status);
        if (! $currentStatus || ! $currentStatus->isActive()) {
            return response()->json([
                'success' => false,
                'message' => 'Trip is not active.',
            ], 422);
        }

        try {
            DB::transaction(function () use ($trip, $guide) {
                $trip->update([
                    'status' => TripStatus::COMPLETED->value,
                    'delivered_at' => now(),
                ]);

                $guide->riderDetail()->updateOrCreate(
                    ['user_id' => $guide->id],
                    ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
                );

                // Compress route history into encoded polyline
                $this->storeTripLog($trip, $guide);
            });

            return response()->json([
                'success' => true,
                'message' => 'Trip completed successfully.',
                'data' => [
                    'trip_id' => $trip->id,
                    'status' => TripStatus::COMPLETED->value,
                ],
            ]);
        } catch (\Exception $e) {
            \Log::error('Trip end failed: '.$e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Failed to end trip.',
            ], 500);
        }
    }

    /**
     * Get tracking info for frontend (guide ID + tracking path)
     * GET /api/trips/{trip}/tracking
     */
    public function tracking(Delivery $trip): JsonResponse
    {
        $user = Auth::user();

        $isGuide = $trip->guide_id === $user->id;
        $isTourist = $trip->order?->customer_id === $user->id;

        if (! $isGuide && ! $isTourist) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized.',
            ], 403);
        }

        if (! $trip->guide_id) {
            return response()->json([
                'success' => false,
                'message' => 'No guide assigned yet.',
            ], 404);
        }

        $guide = User::find($trip->guide_id);

        if (! $guide) {
            return response()->json([
                'success' => false,
                'message' => 'Guide not found.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'trip_id' => $trip->id,
                'status' => $trip->status,
                'guide' => [
                    'id' => $guide->id,
                    'name' => $guide->name,
                    'photo' => $guide->profile?->photo_url,
                    'vehicle' => $guide->riderDetail?->vehicle_type,
                    'plate_number' => $guide->riderDetail?->vehicle_plate_number,
                ],
                'tracking' => [
                    'guide_id' => $guide->id,
                ],
                'pickup' => [
                    'lat' => $trip->pickup_latitude,
                    'lng' => $trip->pickup_longitude,
                    'address' => $trip->pickup_address,
                ],
                'delivery' => [
                    'lat' => $trip->delivery_latitude,
                    'lng' => $trip->delivery_longitude,
                    'address' => $trip->delivery_address,
                ],
            ],
        ]);
    }

    private function storeTripLog(Delivery $trip, User $guide): void
    {
        /** @var RiderLocation[] $locations */
        $locations = RiderLocation::where('rider_id', $guide->id)
            ->whereBetween('recorded_at', [
                $trip->started_at ?? $trip->created_at,
                $trip->delivered_at ?? now(),
            ])
            ->orderBy('recorded_at')
            ->get();

        if ($locations->isEmpty()) {
            return;
        }

        $gps = app(GpsService::class);
        $encoder = app(PolylineEncoder::class);

        $points = [];
        $totalDistance = 0.0;
        $prevLat = null;
        $prevLng = null;

        foreach ($locations as $loc) {
            $lat = (float) $loc->latitude;
            $lng = (float) $loc->longitude;

            if ($prevLat !== null && $prevLng !== null) {
                $totalDistance += $gps->distanceMeters($prevLat, $prevLng, $lat, $lng);
            }

            $points[] = [$lat, $lng];
            $prevLat = $lat;
            $prevLng = $lng;
        }

        $startedAt = $trip->started_at ?? $locations->first()->recorded_at;
        $endedAt = $trip->delivered_at ?? $locations->last()->recorded_at;
        $duration = $startedAt->diffInSeconds($endedAt);

        $avgSpeed = $duration > 0
            ? ($totalDistance / 1000) / ($duration / 3600)
            : 0;

        TripLog::create([
            'delivery_id' => $trip->id,
            'rider_id' => $guide->id,
            'distance_meters' => round($totalDistance, 1),
            'duration_seconds' => $duration,
            'average_speed_kph' => round($avgSpeed, 1),
            'encoded_polyline' => $encoder->encode($points),
            'point_count' => count($points),
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
        ]);
    }
}
