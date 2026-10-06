<?php

namespace App\Http\Controllers\Rider;

use App\Enums\TripStatus;
use App\Events\DeliveryStatusChanged;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\LocationPersistenceService;
use App\Services\NearestRiderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RiderMapController extends Controller
{
    public function __construct(
        private NearestRiderService $dispatchService,
        private LocationPersistenceService $persistence,
    ) {}

    public function index(): JsonResponse
    {
        $user = auth()->user();

        $activeDelivery = Delivery::where('rider_id', $user->id)
            ->whereIn('status', ['assigned', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'])
            ->with('order.business')
            ->first();

        $lastLocation = RiderLocation::where('rider_id', $user->id)
            ->latest('recorded_at')
            ->first();

        return $this->successResponse([
            'user' => [
                'id' => $user->id,
                'rider_status' => $user->riderDetail?->rider_status,
                'current_service' => $user->riderDetail?->current_service,
            ],
            'active_delivery' => $activeDelivery ? [
                'id' => $activeDelivery->id,
                'status' => $activeDelivery->status->value ?? $activeDelivery->status,
                'pickup_address' => $activeDelivery->pickup_address,
                'delivery_address' => $activeDelivery->delivery_address,
                'pickup_latitude' => $activeDelivery->pickup_latitude,
                'pickup_longitude' => $activeDelivery->pickup_longitude,
                'delivery_latitude' => $activeDelivery->delivery_latitude,
                'delivery_longitude' => $activeDelivery->delivery_longitude,
                'business_name' => $activeDelivery->order?->business?->business_name,
            ] : null,
            'last_location' => $lastLocation ? [
                'latitude' => $lastLocation->latitude,
                'longitude' => $lastLocation->longitude,
                'recorded_at' => $lastLocation->recorded_at,
            ] : null,
        ]);
    }

    public function location(): JsonResponse
    {
        $user = auth()->user();

        $lastLocation = RiderLocation::where('rider_id', $user->id)
            ->latest('recorded_at')
            ->first();

        $deliveries = Delivery::where('rider_id', $user->id)
            ->whereIn('status', ['assigned', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'])
            ->with('order.business')
            ->get()
            ->map(fn (Delivery $delivery) => [
                'id' => $delivery->id,
                'order_id' => $delivery->order_id,
                'status' => $delivery->status->value ?? $delivery->status,
                'pickup_address' => $delivery->pickup_address,
                'pickup_lat' => $delivery->pickup_latitude,
                'pickup_lng' => $delivery->pickup_longitude,
                'delivery_address' => $delivery->delivery_address,
                'delivery_lat' => $delivery->delivery_latitude,
                'delivery_lng' => $delivery->delivery_longitude,
                'business_name' => $delivery->primaryOrder()?->business?->business_name,
                'customer_name' => $delivery->primaryOrder()?->customer_name,
                'created_at' => $delivery->created_at,
            ]);

        return $this->successResponse([
            'rider' => [
                'latitude' => $lastLocation?->latitude,
                'longitude' => $lastLocation?->longitude,
            ],
            'deliveries' => $deliveries,
        ]);
    }

    public function updateLocation(Request $request): JsonResponse
    {
        $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'heading' => ['nullable', 'numeric', 'between:0,360'],
            'speed' => ['nullable', 'numeric', 'min:0'],
            'accuracy' => ['nullable', 'numeric', 'min:0'],
        ]);

        $riderId = auth()->id();
        $lat = (float) $request->latitude;
        $lng = (float) $request->longitude;
        $hdg = $request->has('heading') ? (float) $request->heading : null;
        $spd = $request->has('speed') ? (float) $request->speed : null;
        $acc = $request->has('accuracy') ? (float) $request->accuracy : null;

        $lastLocation = RiderLocation::where('rider_id', $riderId)
            ->latest('recorded_at')
            ->first();

        // Teleport guard: an implausible jump (e.g. a client jumping straight to
        // the destination coordinates) must not trigger an arrival geofence or
        // poison the persisted trail.
        if ($lastLocation && ! $this->movementIsPlausible($lastLocation, $lat, $lng)) {
            return $this->successResponse([
                'moved' => false,
                'interval' => 30,
                'reason' => 'implausible_movement',
                'delivery' => $this->currentActiveDeliverySummary($riderId),
            ]);
        }

        $activeDelivery = $this->applyProximityAndGetStatus($riderId, $lat, $lng);

        if ($lastLocation) {
            $dLat = deg2rad($lat - (float) $lastLocation->latitude);
            $dLng = deg2rad($lng - (float) $lastLocation->longitude);
            $a = sin($dLat / 2) ** 2 + cos(deg2rad((float) $lastLocation->latitude)) * cos(deg2rad($lat)) * sin($dLng / 2) ** 2;
            $distance = 6371000 * 2 * atan2(sqrt($a), sqrt(1 - $a));

            if ($distance < 5) {
                // No meaningful movement, but persist an elapsed-based checkpoint
                // (LocationPersistenceService::shouldSave) when the last record is
                // older than checkpoint_seconds. Without this, a stationary online
                // rider can never refresh recorded_at via the heartbeat and silently
                // ages out of COD/radar dispatch (cod_location_max_age_minutes).
                if (($acc === null || $acc <= 50) && $this->persistence->shouldSave($riderId, $lat, $lng)) {
                    RiderLocation::create([
                        'rider_id' => $riderId,
                        'latitude' => $lat,
                        'longitude' => $lng,
                        'recorded_at' => now(),
                    ]);
                }

                return $this->successResponse([
                    'moved' => false,
                    'interval' => $this->getAdaptiveInterval($riderId, $lat, $lng, $spd),
                    'delivery' => $activeDelivery,
                ]);
            }
        }

        if ($acc !== null && $acc > 50) {
            return $this->successResponse([
                'moved' => false,
                'interval' => 30,
                'reason' => 'low_accuracy',
                'delivery' => $activeDelivery,
            ]);
        }

        $locationId = null;
        $recordedAt = null;
        if ($this->persistence->shouldSave($riderId, $lat, $lng)) {
            $loc = RiderLocation::create([
                'rider_id' => $riderId,
                'latitude' => $lat,
                'longitude' => $lng,
                'recorded_at' => now(),
            ]);
            $locationId = $loc->id;
            $recordedAt = $loc->recorded_at;
        }

        $interval = $this->getAdaptiveInterval($riderId, $lat, $lng, $spd);

        return $this->successResponse([
            'moved' => true,
            'id' => $locationId,
            'recorded_at' => $recordedAt,
            'interval' => $interval,
            'delivery' => $activeDelivery,
        ]);
    }

    private const ACTIVE_DELIVERY_STATUSES = [
        'assigned',
        'arrived_pickup',
        'picked_up',
        'in_transit',
        'arrived_destination',
    ];

    private function currentActiveDeliverySummary(int $riderId): ?array
    {
        $delivery = Delivery::where('rider_id', $riderId)
            ->whereIn('status', self::ACTIVE_DELIVERY_STATUSES)
            ->first();

        if (! $delivery) {
            return null;
        }

        return [
            'delivery_id' => $delivery->id,
            'status' => $delivery->status->value ?? $delivery->status,
        ];
    }

    private function movementIsPlausible(RiderLocation $last, float $lat, float $lng): bool
    {
        $maxSpeedKph = (float) config('tracking.max_speed_kph', 150);
        $windowSeconds = (int) config('tracking.plausibility_window_seconds', 120);

        // Not enough temporal context (same tick or a long offline gap): do not
        // second-guess the rider.
        $elapsed = abs(now()->timestamp - (int) $last->recorded_at->timestamp);

        if ($elapsed === 0 || $elapsed > $windowSeconds) {
            return true;
        }

        $distanceKm = $this->dispatchService->calculateDistance(
            (float) $last->latitude,
            (float) $last->longitude,
            $lat,
            $lng
        );

        $impliedKph = $distanceKm / ($elapsed / 3600);

        return $impliedKph <= $maxSpeedKph;
    }

    private function applyProximityAndGetStatus(int $riderId, float $lat, float $lng): ?array
    {
        // Arrival geofence radius in kilometers (defaults to 100m to tolerate
        // real-world GPS accuracy, configurable via TRACKING_ARRIVAL_RADIUS_METERS).
        $arrivalRadiusKm = (float) config('tracking.arrival_radius_meters', 100) / 1000;

        $delivery = Delivery::where('rider_id', $riderId)
            ->whereIn('status', ['assigned', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'])
            ->first();

        if (! $delivery) {
            return null;
        }

        $status = $delivery->status->value;

        if ($status === 'assigned' && is_numeric($delivery->pickup_latitude) && is_numeric($delivery->pickup_longitude)) {
            $distance = $this->dispatchService->calculateDistance(
                $lat, $lng,
                (float) $delivery->pickup_latitude,
                (float) $delivery->pickup_longitude
            );

            if ($distance <= $arrivalRadiusKm) {
                $oldStatus = (string) $delivery->status->value;
                $delivery->update(['status' => 'arrived_pickup', 'arrived_pickup_at' => now()]);

                if ((string) $delivery->status->value !== $oldStatus) {
                    DeliveryStatusChanged::dispatch($delivery, $oldStatus, 'arrived_pickup');
                }

                return ['delivery_id' => $delivery->id, 'status' => 'arrived_pickup'];
            }
        }

        if (in_array($status, ['picked_up', 'in_transit']) && is_numeric($delivery->delivery_latitude) && is_numeric($delivery->delivery_longitude)) {
            $distance = $this->dispatchService->calculateDistance(
                $lat, $lng,
                (float) $delivery->delivery_latitude,
                (float) $delivery->delivery_longitude
            );

            if ($distance <= $arrivalRadiusKm) {
                $oldStatus = (string) $delivery->status->value;
                $delivery->update(['status' => 'arrived_destination', 'arrived_destination_at' => now()]);

                if ((string) $delivery->status->value !== $oldStatus) {
                    DeliveryStatusChanged::dispatch($delivery, $oldStatus, 'arrived_destination');
                }

                return ['delivery_id' => $delivery->id, 'status' => 'arrived_destination'];
            }
        }

        return ['delivery_id' => $delivery->id, 'status' => $status];
    }

    private function getAdaptiveInterval(int $riderId, float $lat, float $lng, ?float $speed): int
    {
        $activeDelivery = Delivery::where('rider_id', $riderId)
            ->whereIn('status', ['assigned', 'picked_up', 'in_transit', 'en_route_pickup', 'arrived_pickup', 'tour_started', 'en_route_destination', 'arrived_destination'])
            ->first();

        if (! $activeDelivery) {
            return 30;
        }

        if ($speed !== null && $speed == 0) {
            return 60;
        }

        $status = $activeDelivery->status;

        if (in_array($status, ['assigned', 'waiting'])) {
            return 30;
        }

        $isEnRoute = in_array($status, ['en_route_pickup', 'assigned']);
        $targetLat = $isEnRoute ? (float) $activeDelivery->pickup_latitude : (float) $activeDelivery->delivery_latitude;
        $targetLng = $isEnRoute ? (float) $activeDelivery->pickup_longitude : (float) $activeDelivery->delivery_longitude;

        if ($targetLat && $targetLng) {
            $dLat = deg2rad($targetLat - $lat);
            $dLng = deg2rad($targetLng - $lng);
            $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat)) * cos(deg2rad($targetLat)) * sin($dLng / 2) ** 2;
            $dist = 6371000 * 2 * atan2(sqrt($a), sqrt(1 - $a));

            if ($dist < 500) {
                return 5;
            }
        }

        return 10;
    }

    public function currentDelivery(): JsonResponse
    {
        $user = auth()->user();

        $delivery = Delivery::where('rider_id', $user->id)
            ->whereIn('status', ['assigned', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'])
            ->with('order.business')
            ->first();

        if (! $delivery) {
            return $this->successResponse(['delivery' => null]);
        }

        return $this->successResponse([
            'delivery' => [
                'id' => $delivery->id,
                'order_id' => $delivery->order_id,
                'status' => $delivery->status,
                'pickup_address' => $delivery->pickup_address,
                'pickup_latitude' => $delivery->pickup_latitude,
                'pickup_longitude' => $delivery->pickup_longitude,
                'delivery_address' => $delivery->delivery_address,
                'delivery_latitude' => $delivery->delivery_latitude,
                'delivery_longitude' => $delivery->delivery_longitude,
                'business_name' => $delivery->primaryOrder()?->business?->name,
                'rider_commission' => $delivery->rider_commission,
                'notes' => $delivery->notes,
            ],
        ]);
    }

    public function updateDeliveryStatus(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()?->id) {
            return $this->forbiddenResponse('Not assigned to this delivery.');
        }

        $validStatuses = [
            'arrived_pickup' => 'arrived_pickup_at',
            'picked_up' => 'picked_up_at',
            'in_transit' => null,
            'arrived_destination' => 'arrived_destination_at',
            'delivered' => 'delivered_at',
        ];

        $newStatus = $request->input('status');
        if (! isset($validStatuses[$newStatus])) {
            return $this->errorResponse('Invalid status transition.', 422);
        }

        // Perform the transition under a row lock on the delivery so the
        // proximity completion cannot race the auto-cancel / restaurant-cancel
        // path into a torn terminal state.
        $outcome = DB::transaction(function () use ($delivery, $newStatus, $request) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked || (int) $locked->rider_id !== (int) auth()->id()) {
                return ['error' => 'forbidden'];
            }

            $oldStatus = (string) ($locked->status->value ?? $locked->status);

            $updateData = ['status' => $newStatus];
            $timestampField = $this->timestampFieldFor($newStatus);
            if ($timestampField) {
                $updateData[$timestampField] = now();
            }

            if ($newStatus === 'delivered' && $request->has('route_history')) {
                $updateData['route_history'] = $request->input('route_history');
            }

            $locked->update($updateData);

            // P14 — tourist delivery-confirmation gate. Evaluated BEFORE the status
            // write so a rejected rider 'delivered' never mutates the delivery.
            if (
                $newStatus === 'delivered'
                && $this->dispatchService->requiresTouristConfirmation($locked)
            ) {
                return ['error' => 'tourist_confirmation_required'];
            }

            $locked->update($updateData);

            $finalStatus = $newStatus;

            if ($newStatus === 'delivered') {
                $routeHistory = $request->has('route_history') ? $request->input('route_history') : null;

                if ($this->dispatchService->isCodDelivery($locked)) {
                    // COD: freeze the cash snapshot and keep the rider busy until the
                    // cash settlement step (POST /rider/deliveries/{id}/settle-cod).
                    $this->dispatchService->markCodDelivered($locked);
                } else {
                    $this->dispatchService->completeDelivery($locked, $routeHistory);
                    $locked->update(['status' => TripStatus::COMPLETED->value]);
                    $finalStatus = TripStatus::COMPLETED->value;
                    $user = $request->user();
                    $user?->riderDetail()->updateOrCreate(
                        ['user_id' => $user->id],
                        ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
                    );
                }
            }

            return ['error' => null, 'old_status' => $oldStatus, 'new_status' => $newStatus, 'final_status' => $finalStatus];
        });

        if ($outcome['error'] === 'forbidden') {
            return $this->forbiddenResponse('Not assigned to this delivery.');
        }

        if (($outcome['error'] ?? null) === 'tourist_confirmation_required') {
            return $this->errorResponse('The tourist must confirm the delivery before it can be marked as delivered.', 422);
        }

        // Emit the real-time event only after commit, so listeners never run
        // while the row lock is held. The event carries the delivery's ACTUAL
        // end state (prepaid confirmation completes the delivery -> 'completed';
        // COD stays 'delivered' until cash settlement).
        $fresh = $delivery->fresh()->load('order.business');
        if ($outcome['old_status'] !== $outcome['new_status']) {
            DeliveryStatusChanged::dispatch($fresh, $outcome['old_status'], $outcome['final_status']);
        }

        return $this->successResponse([
            'delivery' => $fresh,
        ], 'Status updated to ' . ucfirst(str_replace('_', ' ', $newStatus)) . '.');
    }

    private function timestampFieldFor(string $status): ?string
    {
        return match ($status) {
            'arrived_pickup' => 'arrived_pickup_at',
            'picked_up' => 'picked_up_at',
            'arrived_destination' => 'arrived_destination_at',
            'delivered' => 'delivered_at',
            default => null,
        };
    }
}
