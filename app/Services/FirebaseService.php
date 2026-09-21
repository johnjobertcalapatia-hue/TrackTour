<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FirebaseService
{
    protected string $databaseUrl;

    protected ?string $secret;

    public function __construct()
    {
        $this->databaseUrl = rtrim(config('firebase.credentials.database_url', ''), '/');
        $this->secret = config('firebase.credentials.database_secret');
    }

    public function isConfigured(): bool
    {
        return ! empty($this->databaseUrl);
    }

    protected function url(string $path): string
    {
        $query = http_build_query(array_filter([
            'auth' => $this->secret,
        ]));

        return "{$this->databaseUrl}/{$path}.json?{$query}";
    }

    public function get(string $path): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }
        try {
            $response = Http::timeout(config('firebase.database.timeout', 5))
                ->get($this->url($path));

            return $response->successful() ? $response->json() : null;
        } catch (\Exception $e) {
            Log::warning('Firebase get failed: '.$e->getMessage());

            return null;
        }
    }

    public function patch(string $path, array $data): bool
    {
        if (! $this->isConfigured()) {
            return false;
        }
        try {
            $response = Http::timeout(config('firebase.database.timeout', 5))
                ->patch($this->url($path), $data);

            return $response->successful();
        } catch (\Exception $e) {
            Log::warning('Firebase patch failed: '.$e->getMessage());

            return false;
        }
    }

    public function put(string $path, array $data): bool
    {
        if (! $this->isConfigured()) {
            return false;
        }
        try {
            $response = Http::timeout(config('firebase.database.timeout', 5))
                ->put($this->url($path), $data);

            return $response->successful();
        } catch (\Exception $e) {
            Log::warning('Firebase put failed: '.$e->getMessage());

            return false;
        }
    }

    public function update(array $data): bool
    {
        if (! $this->isConfigured()) {
            return false;
        }
        try {
            $query = http_build_query(array_filter(['auth' => $this->secret]));
            $url = "{$this->databaseUrl}/.json?{$query}";
            $response = Http::timeout(config('firebase.database.timeout', 5))
                ->patch($url, $data);

            return $response->successful();
        } catch (\Exception $e) {
            Log::warning('Firebase update failed: '.$e->getMessage());

            return false;
        }
    }

    public function delete(string $path): bool
    {
        if (! $this->isConfigured()) {
            return false;
        }
        try {
            $response = Http::timeout(config('firebase.database.timeout', 5))
                ->delete($this->url($path));

            return $response->successful();
        } catch (\Exception $e) {
            Log::warning('Firebase delete failed: '.$e->getMessage());

            return false;
        }
    }

    public function updateRiderLocation(int $riderId, float $lat, float $lng, ?float $hdg = null, ?float $spd = null, ?string $svc = null, ?int $mun = null, ?int $seq = null, ?string $status = null, ?float $acc = null, ?int $hb = null, ?int $dts = null): bool
    {
        $ts = now()->timestamp;

        return $this->patch("riders/{$riderId}", array_filter([
            'lat' => $lat,
            'lng' => $lng,
            'hdg' => $hdg,
            'spd' => $spd,
            'acc' => $acc,
            'svc' => $svc,
            'mun' => $mun,
            'seq' => $seq,
            'hb' => $hb ?? $seq,
            'status' => $status,
            'ts' => $ts,
            'dts' => $dts ?? $ts,
        ], fn ($v) => $v !== null));
    }

    public function getRiderLocation(int $riderId): ?array
    {
        return $this->get("riders/{$riderId}");
    }

    public function getOnlineRiders(): array
    {
        $riders = $this->get('riders');
        if (! $riders) {
            return [];
        }

        $online = [];
        foreach ($riders as $id => $data) {
            $id = (int) $id;
            if (isset($data['status']) && in_array($data['status'], ['online', 'available'], true)) {
                $data['id'] = $id;
                $online[$id] = $data;
            }
        }

        return $online;
    }

    public function setRiderStatus(int $riderId, string $status, ?string $svc = null, ?int $mun = null): bool
    {
        return $this->patch("riders/{$riderId}", array_filter([
            'status' => $status,
            'svc' => $svc,
            'mun' => $mun,
            'ts' => now()->timestamp,
        ], fn ($v) => $v !== null));
    }

    public function removeRider(int $riderId): bool
    {
        return $this->delete("riders/{$riderId}");
    }

    public function removeOnlineRider(int $riderId): bool
    {
        return $this->delete("online/riders/{$riderId}");
    }

    public function setTouristLocation(int $touristId, float $lat, float $lng): bool
    {
        return $this->patch("tourists/{$touristId}", [
            'lat' => $lat,
            'lng' => $lng,
            'ts' => now()->timestamp,
        ]);
    }

    public function getTouristLocation(int $touristId): ?array
    {
        return $this->get("tourists/{$touristId}");
    }

    public function setOnlineStatus(string $type, int $userId, bool $online): bool
    {
        if ($online) {
            return $this->put("online/{$type}/{$userId}", [
                'online' => true,
                'ts' => now()->timestamp,
            ]);
        }

        return $this->delete("online/{$type}/{$userId}");
    }

    public function startTracking(int $deliveryId, int $riderId, float $pickupLat, float $pickupLng, float $deliveryLat, float $deliveryLng, string $status = 'assigned'): bool
    {
        return $this->put("active_trackings/{$deliveryId}", [
            'rider' => $riderId,
            'plat' => $pickupLat,
            'plng' => $pickupLng,
            'dlat' => $deliveryLat,
            'dlng' => $deliveryLng,
            'status' => $status,
            'ts' => now()->timestamp,
        ]);
    }

    public function updateTrackingStatus(int $deliveryId, string $status): bool
    {
        return $this->patch("active_trackings/{$deliveryId}", [
            'status' => $status,
            'ts' => now()->timestamp,
        ]);
    }

    public function getTracking(int $deliveryId): ?array
    {
        return $this->get("active_trackings/{$deliveryId}");
    }

    public function stopTracking(int $deliveryId): bool
    {
        return $this->delete("active_trackings/{$deliveryId}");
    }

    public function createRiderRequest(int $riderId, int $deliveryId, array $data): bool
    {
        return $this->put("rider_requests/{$riderId}/{$deliveryId}", $data);
    }

    public function updateRiderRequestStatus(int $riderId, int $deliveryId, string $status): bool
    {
        return $this->patch("rider_requests/{$riderId}/{$deliveryId}", [
            'status' => $status,
            'ts' => now()->timestamp,
        ]);
    }

    public function removeRiderRequest(int $riderId, int $deliveryId): bool
    {
        return $this->delete("rider_requests/{$riderId}/{$deliveryId}");
    }

    public function removeAllRiderRequests(int $riderId): bool
    {
        return $this->delete("rider_requests/{$riderId}");
    }

    public function createBookingRequest(int $deliveryId, array $data): bool
    {
        return $this->put("booking_requests/{$deliveryId}", $data);
    }

    public function updateBookingRequestStatus(int $deliveryId, string $status): bool
    {
        return $this->patch("booking_requests/{$deliveryId}", [
            'status' => $status,
            'ts' => now()->timestamp,
        ]);
    }

    public function removeBookingRequest(int $deliveryId): bool
    {
        return $this->delete("booking_requests/{$deliveryId}");
    }

    public function getFrontendConfig(): array
    {
        return [
            'apiKey' => config('firebase.credentials.api_key'),
            'authDomain' => config('firebase.credentials.auth_domain'),
            'databaseURL' => config('firebase.credentials.database_url'),
            'projectId' => config('firebase.credentials.project_id'),
            'storageBucket' => config('firebase.credentials.storage_bucket'),
            'messagingSenderId' => config('firebase.credentials.messaging_sender_id'),
            'appId' => config('firebase.credentials.app_id'),
        ];
    }
}
