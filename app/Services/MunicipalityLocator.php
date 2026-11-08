<?php

namespace App\Services;

use App\Models\Municipality;
use Illuminate\Support\Collection;

/**
 * Which covered municipality a coordinate is in: the nearest municipality
 * centre with coordinates, within MAX_DISTANCE_KM (farther = not covered).
 * Shared by the tourist "locate me" endpoint and My Activities → Travels.
 */
class MunicipalityLocator
{
    public const MAX_DISTANCE_KM = 25.0;

    /** @var Collection<int, Municipality>|null */
    private ?Collection $centres = null;

    /** @return array{municipality: Municipality, km: float}|null */
    public function nearest(float $lat, float $lng): ?array
    {
        $best = null;
        $bestKm = INF;
        foreach ($this->centres() as $m) {
            $km = self::haversineKm($lat, $lng, (float) $m->latitude, (float) $m->longitude);
            if ($km < $bestKm) {
                $bestKm = $km;
                $best = $m;
            }
        }

        return $best !== null && $bestKm <= self::MAX_DISTANCE_KM ? ['municipality' => $best, 'km' => $bestKm] : null;
    }

    /** @return Collection<int, Municipality> Loaded once per instance. */
    private function centres(): Collection
    {
        return $this->centres ??= Municipality::query()
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get(['id', 'name', 'province', 'cover_photo', 'latitude', 'longitude']);
    }

    public static function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return 2 * $r * asin(min(1.0, sqrt($a)));
    }
}
