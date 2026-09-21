<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WebsocketNotifierService
{
    private string $serverUrl;

    public function __construct()
    {
        $this->serverUrl = rtrim(config('socket.server_url', 'http://127.0.0.1:3002'), '/');
    }

    /**
     * Header set for every bridge request. The socket engine rejects any
     * request that does not present the configured shared secret.
     */
    private function bridgeHeaders(): array
    {
        $secret = (string) config('socket.bridge_secret', '');

        return $secret !== '' ? ['x-socket-secret' => $secret] : [];
    }

    /**
     * Notify the WebSocket dispatch engine about a newly dispatched delivery so
     * the target rider receives an instant order ping over their websocket.
     */
    public function notifyDispatch(array $payload): bool
    {
        Log::info('[SocketDispatch] notifier called', [self::class, 'url' => $this->serverUrl . '/dispatch', 'payload' => $payload]);

        try {
            $response = Http::timeout(2)
                ->withHeaders($this->bridgeHeaders())
                ->post($this->serverUrl . '/dispatch', $payload);

            Log::info('[SocketDispatch] bridge responded', [
                'status' => $response->status(),
                'body' => (string) $response->body(),
            ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('[SocketDispatch] notifier POST failed', ['error' => $e->getMessage()]);
            report($e);

            return false;
        }
    }

    /**
     * Notify the WebSocket engine that an active trip has been completed so it can
     * drop the ephemeral RAM trip state and tell the customer's live room to stop
     * tracking (Zero-DB replacement for the removed Firebase stopTracking call).
     */
    /**
     * Read the socket engine's live RAM radar of online available riders. Used as
     * a fallback when MySQL rider_locations is stale/empty, so an online rider
     * (regardless of radius) still receives a pollable dispatch request.
     *
     * @return array<int, array{riderId:int, status:string, lat:?float, lng:?float, socketId:string}>
     */
    public function getOnlineRidersFromBridge(): array
    {
        try {
            $response = Http::timeout(2)->withHeaders($this->bridgeHeaders())->get($this->serverUrl . '/status');

            if (! $response->successful()) {
                Log::warning('[SocketDispatch] bridge /status failed', ['status' => $response->status()]);

                return [];
            }

            $data = $response->json();

            return $data['onlineRiders'] ?? [];
        } catch (\Throwable $e) {
            Log::warning('[SocketDispatch] bridge /status threw', ['error' => $e->getMessage()]);

            return [];
        }
    }

    /**
     * Push the authoritative delivery assignment to the socket engine so that
     * only the assigned rider's socket is allowed to stream location into the
     * trip room, and the room is notified of the assignment.
     */
    public function notifyTripAssigned(int $deliveryId, int $riderId): bool
    {
        try {
            $response = Http::timeout(2)
                ->withHeaders($this->bridgeHeaders())
                ->post($this->serverUrl . '/trip/assign', [
                    'deliveryId' => $deliveryId,
                    'riderId' => $riderId,
                ]);

            Log::info('[SocketDispatch] trip assign bridge responded', [
                'delivery_id' => $deliveryId,
                'rider_id' => $riderId,
                'status' => $response->status(),
            ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('[SocketDispatch] trip assign POST failed', ['error' => $e->getMessage()]);

            return false;
        }
    }

    public function notifyTripCompleted(int $deliveryId, ?int $riderId = null): bool
    {
        try {
            $response = Http::timeout(2)
                ->withHeaders($this->bridgeHeaders())
                ->post($this->serverUrl . '/trip/complete', [
                    'deliveryId' => $deliveryId,
                    'riderId' => $riderId,
                ]);

            Log::info('[SocketDispatch] trip complete bridge responded', [
                'delivery_id' => $deliveryId,
                'status' => $response->status(),
            ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('[SocketDispatch] trip complete POST failed', ['error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * P11.5 — Route a canonical status event to the socket engine's audience
     * rooms (business:{id}, user:{id}, rider:{id}, trip:{deliveryId}).
     *
     * Rooms are computed by Laravel (the source of truth); the engine only
     * echoes the payload to those rooms. An empty room list is a no-op.
     */
    public function notifyStatusEvent(string $eventName, array $rooms, array $data): bool
    {
        $rooms = array_values(array_unique($rooms));

        if ($rooms === []) {
            return true;
        }

        try {
            $response = Http::timeout(2)
                ->withHeaders($this->bridgeHeaders())
                ->post($this->serverUrl . '/event', [
                    'eventName' => $eventName,
                    'rooms' => $rooms,
                    'data' => $data,
                ]);

            Log::info('[SocketDispatch] status-event bridge responded', [
                'event_name' => $eventName,
                'rooms' => $rooms,
                'status' => $response->status(),
            ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('[SocketDispatch] status-event bridge POST failed', ['error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * P11.5 — Ask the socket engine to terminate a live trip (cancellation):
     * notify the authorized rooms with `trip_cancelled`, evict members from the
     * transient trip room, and drop the RAM trip. Duplicate cancels must be
     * harmless no-ops. Best effort — MySQL remains authoritative.
     */
    public function notifyTripCancelled(int $deliveryId, ?int $riderId = null): bool
    {
        try {
            $response = Http::timeout(2)
                ->withHeaders($this->bridgeHeaders())
                ->post($this->serverUrl . '/trip/cancel', [
                    'deliveryId' => $deliveryId,
                    'riderId' => $riderId,
                ]);

            Log::info('[SocketDispatch] trip cancel bridge responded', [
                'delivery_id' => $deliveryId,
                'status' => $response->status(),
            ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('[SocketDispatch] trip cancel POST failed', ['error' => $e->getMessage()]);

            return false;
        }
    }
}
