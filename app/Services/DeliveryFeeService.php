<?php

namespace App\Services;

use App\Models\Business;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

class DeliveryFeeService
{
    public function calculateOrderDeliveryFee(Business $business, float $deliveryLatitude, float $deliveryLongitude): array
    {
        $pickupLatitude = $this->coordinate($business->latitude, 'restaurant latitude');
        $pickupLongitude = $this->coordinate($business->longitude, 'restaurant longitude');
        $this->validateCoordinates($deliveryLatitude, $deliveryLongitude, 'delivery location');

        $route = $this->calculateRouteDistance(
            $pickupLatitude,
            $pickupLongitude,
            $deliveryLatitude,
            $deliveryLongitude
        );
        $isEstimated = false;

        if ($route === null) {
            $route = [
                'distance_km' => $this->calculateFallbackDistance(
                    $pickupLatitude,
                    $pickupLongitude,
                    $deliveryLatitude,
                    $deliveryLongitude
                ),
                'duration_minutes' => null,
            ];
            $isEstimated = true;
        }

        $distanceKm = round($route['distance_km'], 2);
        $baseFare = (float) config('delivery.base_fare');
        $includedKilometers = (float) config('delivery.included_kilometers', 2.00);
        $distanceRate = (float) config('delivery.per_kilometer');
        $distanceCharge = round(max($distanceKm - $includedKilometers, 0) * $distanceRate, 2);
        $serviceAdjustment = (float) config('delivery.service_adjustment');
        $surgeMultiplier = (float) config('delivery.surge_multiplier');
        $calculatedFee = ($baseFare + $distanceCharge + $serviceAdjustment) * $surgeMultiplier;
        $deliveryFee = round(max($calculatedFee, (float) config('delivery.minimum_fee')), 2);

        return [
            'business_id' => $business->id,
            'distance_km' => $distanceKm,
            'estimated_duration_minutes' => $route['duration_minutes'],
            'base_fare' => round($baseFare, 2),
            'included_kilometers' => round($includedKilometers, 2),
            'distance_rate' => round($distanceRate, 2),
            'distance_charge' => $distanceCharge,
            'service_adjustment' => round($serviceAdjustment, 2),
            'surge_multiplier' => $surgeMultiplier,
            'delivery_fee' => $deliveryFee,
            'pickup_latitude' => $pickupLatitude,
            'pickup_longitude' => $pickupLongitude,
            'delivery_latitude' => $deliveryLatitude,
            'delivery_longitude' => $deliveryLongitude,
            'is_estimated' => $isEstimated,
            'calculated_at' => now(),
        ];
    }

    public function calculateDistance(float $fromLatitude, float $fromLongitude, float $toLatitude, float $toLongitude): float
    {
        $route = $this->calculateRouteDistance($fromLatitude, $fromLongitude, $toLatitude, $toLongitude);

        return $route['distance_km'] ?? $this->calculateFallbackDistance(
            $fromLatitude,
            $fromLongitude,
            $toLatitude,
            $toLongitude
        );
    }

    public function calculateRouteDistance(float $fromLatitude, float $fromLongitude, float $toLatitude, float $toLongitude): ?array
    {
        $url = rtrim((string) config('delivery.routing_url'), '/')
            ."/{$fromLongitude},{$fromLatitude};{$toLongitude},{$toLatitude}";

        try {
            $response = Http::timeout((int) config('delivery.routing_timeout', 5))
                ->acceptJson()
                ->get($url, ['overview' => 'false']);

            if (! $response->successful() || $response->json('code') !== 'Ok') {
                return null;
            }

            $route = $response->json('routes.0');
            if (! is_array($route) || ! isset($route['distance'])) {
                return null;
            }

            return [
                'distance_km' => ((float) $route['distance']) / 1000,
                'duration_minutes' => isset($route['duration'])
                    ? (int) ceil(((float) $route['duration']) / 60)
                    : null,
            ];
        } catch (ConnectionException) {
            return null;
        }
    }

    public function calculateFallbackDistance(float $fromLatitude, float $fromLongitude, float $toLatitude, float $toLongitude): float
    {
        $earthRadiusKm = 6371;
        $latitudeDelta = deg2rad($toLatitude - $fromLatitude);
        $longitudeDelta = deg2rad($toLongitude - $fromLongitude);
        $a = sin($latitudeDelta / 2) ** 2
            + cos(deg2rad($fromLatitude)) * cos(deg2rad($toLatitude)) * sin($longitudeDelta / 2) ** 2;

        return $earthRadiusKm * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    private function coordinate(mixed $value, string $label): float
    {
        if ($value === null || ! is_numeric($value)) {
            throw new InvalidArgumentException("Unable to calculate delivery fee because the {$label} is unavailable.");
        }

        return (float) $value;
    }

    private function validateCoordinates(float $latitude, float $longitude, string $label): void
    {
        if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
            throw new InvalidArgumentException("Unable to calculate delivery fee because the {$label} is invalid.");
        }
    }
}
