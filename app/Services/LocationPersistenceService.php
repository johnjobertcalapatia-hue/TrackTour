<?php

namespace App\Services;

use App\Models\RiderLocation;
use Illuminate\Support\Facades\Config;

class LocationPersistenceService
{
    public function __construct(
        private GpsService $gps
    ) {}

    public function shouldSave(int $riderId, float $latitude, float $longitude, ?int &$distance = null, ?int &$elapsed = null): bool
    {
        $lastLocation = RiderLocation::where('rider_id', $riderId)
            ->latest('recorded_at')
            ->first();

        if (! $lastLocation) {
            return true;
        }

        $distance = (int) round($this->gps->distanceMeters(
            (float) $lastLocation->latitude,
            (float) $lastLocation->longitude,
            $latitude,
            $longitude
        ));

        $elapsed = now()->diffInSeconds($lastLocation->recorded_at);

        $minDist = Config::get('tracking.min_distance', 5);
        $maxAge = Config::get('tracking.checkpoint_seconds', 60);

        return $distance > $minDist || $elapsed >= $maxAge;
    }
}
