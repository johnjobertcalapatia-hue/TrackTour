<?php

namespace App\Services;

use App\Events\OrderStatusChanged;
use App\Models\Barangay;
use App\Models\Business;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\TouristDestination;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class TransportationService
{
    /** Ride-rating tags a tourist may select after a completed trip (Phase 5). */
    public const RATING_TAGS = [
        'friendly',
        'safe_driving',
        'clean_vehicle',
        'good_communication',
        'arrived_on_time',
    ];

    protected NearestRiderService $dispatchService;

    protected DeliveryFeeService $routeService;

    public function __construct(NearestRiderService $dispatchService, DeliveryFeeService $routeService)
    {
        $this->dispatchService = $dispatchService;
        $this->routeService = $routeService;
    }

    public function getVehicleTypes(): array
    {
        return [
            [
                'slug' => 'motorcycle',
                'name' => 'Motorcycle',
                'base_fare' => 50.00,
                'per_km' => 15.00,
                'max_passengers' => 1,
                'icon' => 'motorcycle',
            ],
            [
                'slug' => 'tricycle',
                'name' => 'Tricycle',
                'base_fare' => 60.00,
                'per_km' => 20.00,
                'max_passengers' => 3,
                'icon' => 'tricycle',
            ],
            [
                'slug' => 'car',
                'name' => 'Car',
                'base_fare' => 100.00,
                'per_km' => 25.00,
                'max_passengers' => 4,
                'icon' => 'car',
            ],
            [
                'slug' => 'van',
                'name' => 'Van',
                'base_fare' => 150.00,
                'per_km' => 30.00,
                'max_passengers' => 8,
                'icon' => 'van',
            ],
        ];
    }

    public function estimateFare(float $pickupLat, float $pickupLng, float $destLat, float $destLng): array
    {
        $distanceKm = $this->calculateDistance($pickupLat, $pickupLng, $destLat, $destLng);
        $durationMin = max(5, ceil($distanceKm * 3));
        $serviceFee = (float) config('delivery.service_fee', 0.00);

        $fares = [];
        foreach ($this->getVehicleTypes() as $v) {
            $distanceFare = round($distanceKm * $v['per_km'], 2);
            $fare = round(max($v['base_fare'] + $distanceFare, $v['base_fare']), 2);
            $fares[$v['slug']] = [
                'base_fare' => $v['base_fare'],
                'per_km' => $v['per_km'],
                // Explicit line items (ride-hailing plan Phase 3): total_fare
                // is the bookable fare (base + distance). service_fee is shown
                // when > 0 but not part of orders.total in MVP.
                'distance_km' => round($distanceKm, 2),
                'duration_min' => $durationMin,
                'distance_fare' => $distanceFare,
                'fare' => $fare,
                'total_fare' => $fare,
                'service_fee' => $serviceFee,
                'fare_text' => '₱'.number_format($fare, 2),
            ];
        }

        return [
            'distance_km' => round($distanceKm, 2),
            'distance_text' => $distanceKm < 1 ? round($distanceKm * 1000).' m' : round($distanceKm, 1).' km',
            'duration_min' => $durationMin,
            'duration_text' => $durationMin.' min',
            'service_fee' => $serviceFee,
            'fares' => $fares,
        ];
    }

    /**
     * Deterministic fare breakdown for a booked ride (plan Phase 5 receipt math).
     *
     * base_fare comes from the vehicle config; the distance leg is the residual
     * against the authoritative booked fare. The fare was computed at booking
     * from the unrounded distance, so recomputing distance x per_km from the
     * stored (rounded) distance would drift from the paid total by sub-cent
     * rounding. Deriving the distance leg as `total - base` guarantees the
     * receipt always reconciles: base + distance === total. service_fee is
     * config-driven, shown only when > 0, and NOT part of the total in MVP.
     */
    public function getFareBreakdown(string $vehicleType, float $totalFare): array
    {
        $vehicle = collect($this->getVehicleTypes())
            ->first(fn ($v) => (string) $v['slug'] === $vehicleType) ?? $this->getVehicleTypes()[0];

        $baseFare = round((float) $vehicle['base_fare'], 2);
        $totalFare = round((float) $totalFare, 2);

        return [
            'base_fare' => $baseFare,
            'distance_fare' => round(max($totalFare - $baseFare, 0), 2),
            'service_fee' => (float) config('delivery.service_fee', 0.00),
            'total_fare' => $totalFare,
        ];
    }

    /**
     * Local-registry search for ride pickup/destination selection (Phase 2).
     *
     * Searches only records that carry usable coordinates (a ride needs lat/lng):
     * active tourist destinations, approved restaurant/accommodation businesses,
     * municipalities, and barangays (barangays fall back to their municipality
     * coords). No external geocoder — this is a local registry search.
     *
     * Result contract: [{id, type: attraction|stay|restaurant|municipality|barangay,
     * name, address, lat, lng}]
     */
    public function searchLocations(string $q): array
    {
        $q = trim($q);
        if ($q === '') {
            return [];
        }

        $results = collect();

        TouristDestination::with('municipality')
            ->where('status', 'active')
            ->where(function ($query) use ($q) {
                $query->where('name', 'like', "%{$q}%")
                    ->orWhere('address', 'like', "%{$q}%");
            })
            ->limit(6)
            ->get()
            ->each(function ($destination) use (&$results) {
                if ($destination->latitude === null || $destination->longitude === null) {
                    return;
                }
                $results->push([
                    'id' => $destination->id,
                    'type' => 'attraction',
                    'name' => $destination->name,
                    'address' => $destination->address ?: ($destination->municipality?->name ?? ''),
                    'lat' => (float) $destination->latitude,
                    'lng' => (float) $destination->longitude,
                ]);
            });

        Business::with('category', 'municipality')
            ->where('status', 'approved')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->where(function ($query) use ($q) {
                $query->where('business_name', 'like', "%{$q}%")
                    ->orWhere('address', 'like', "%{$q}%");
            })
            ->limit(6)
            ->get()
            ->each(function ($business) use (&$results) {
                $type = $business->isRestaurant() ? 'restaurant' : ($business->isAccommodation() ? 'stay' : null);
                if (! $type) {
                    return;
                }
                $results->push([
                    'id' => $business->id,
                    'type' => $type,
                    'name' => $business->business_name,
                    'address' => $business->address ?: ($business->municipality?->name ?? ''),
                    'lat' => (float) $business->latitude,
                    'lng' => (float) $business->longitude,
                ]);
            });

        Municipality::where('name', 'like', "%{$q}%")
            ->limit(4)
            ->get()
            ->each(function ($municipality) use (&$results) {
                if ($municipality->latitude === null || $municipality->longitude === null) {
                    return;
                }
                $results->push([
                    'id' => $municipality->id,
                    'type' => 'municipality',
                    'name' => $municipality->name,
                    'address' => $municipality->province ?? 'Oriental Mindoro',
                    'lat' => (float) $municipality->latitude,
                    'lng' => (float) $municipality->longitude,
                ]);
            });

        Barangay::with('municipality')
            ->where(function ($query) use ($q) {
                $query->where('name', 'like', "%{$q}%")
                    ->orWhereHas('municipality', fn ($municipality) => $municipality->where('name', 'like', "%{$q}%"));
            })
            ->limit(4)
            ->get()
            ->each(function ($barangay) use (&$results) {
                if (! $barangay->municipality || $barangay->municipality->latitude === null || $barangay->municipality->longitude === null) {
                    return;
                }
                $results->push([
                    'id' => $barangay->id,
                    'type' => 'barangay',
                    'name' => $barangay->name,
                    'address' => $barangay->municipality->name,
                    'lat' => (float) $barangay->municipality->latitude,
                    'lng' => (float) $barangay->municipality->longitude,
                ]);
            });

        $needle = strtolower($q);

        return $results
            ->map(function ($result) use ($needle) {
                $result['_sort'] = (str_starts_with(strtolower($result['name']), $needle) ? '0' : '1').':'.strtolower($result['name']);

                return $result;
            })
            ->sortBy('_sort')
            ->values()
            ->map(function ($result) {
                unset($result['_sort']);

                return $result;
            })
            ->take(20)
            ->all();
    }

    /**
     * Nearest known local place to (lat, lng) within $radiusKm, else the
     * documented "Picked location" fallback. Radius is tight (2 km) so a tap
     * near a registered point resolves to that point instead of a made-up label.
     */
    public function reverseGeocodeLocation(float $lat, float $lng, float $radiusKm = 2.0): array
    {
        $nearest = null;
        $nearestDistance = PHP_FLOAT_MAX;

        $candidates = collect();

        TouristDestination::where('status', 'active')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get()
            ->each(function ($destination) use (&$candidates) {
                $candidates->push([
                    'id' => $destination->id,
                    'type' => 'attraction',
                    'name' => $destination->name,
                    'address' => $destination->address,
                    'lat' => (float) $destination->latitude,
                    'lng' => (float) $destination->longitude,
                ]);
            });

        Business::with('category')
            ->where('status', 'approved')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get()
            ->each(function ($business) use (&$candidates) {
                $type = $business->isRestaurant() ? 'restaurant' : ($business->isAccommodation() ? 'stay' : null);
                if (! $type) {
                    return;
                }
                $candidates->push([
                    'id' => $business->id,
                    'type' => $type,
                    'name' => $business->business_name,
                    'address' => $business->address,
                    'lat' => (float) $business->latitude,
                    'lng' => (float) $business->longitude,
                ]);
            });

        Municipality::whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get()
            ->each(function ($municipality) use (&$candidates) {
                $candidates->push([
                    'id' => $municipality->id,
                    'type' => 'municipality',
                    'name' => $municipality->name,
                    'address' => $municipality->province ?? '',
                    'lat' => (float) $municipality->latitude,
                    'lng' => (float) $municipality->longitude,
                ]);
            });

        foreach ($candidates as $candidate) {
            $distance = $this->calculateDistance($lat, $lng, $candidate['lat'], $candidate['lng']);
            if ($distance <= $radiusKm && $distance < $nearestDistance) {
                $nearest = $candidate;
                $nearestDistance = $distance;
            }
        }

        return $nearest ?? [
            'id' => null,
            'type' => 'custom',
            'name' => 'Picked location',
            'address' => '',
            'lat' => $lat,
            'lng' => $lng,
        ];
    }

    /**
     * Route preview polyline for the ride summary (ride-hailing plan Phase 3).
     *
     * OSRM geometry when the router is reachable, otherwise a straight-line
     * fallback so the frontend always has a renderable route.
     *
     * Contract: {polyline: [[lat, lng], ...], distance_km, duration_min, source}
     * where source is 'osrm' | 'straight_line'.
     */
    public function getRoute(float $pickupLat, float $pickupLng, float $destLat, float $destLng): array
    {
        $osrm = $this->routeService->routePolyline($pickupLat, $pickupLng, $destLat, $destLng);

        if ($osrm !== null && count($osrm['polyline']) >= 2) {
            return [
                'polyline' => $osrm['polyline'],
                'distance_km' => round((float) $osrm['distance_km'], 2),
                'duration_min' => max(5, (int) ($osrm['duration_minutes'] ?? ceil($osrm['distance_km'] * 3))),
                'source' => 'osrm',
            ];
        }

        $distanceKm = $this->calculateDistance($pickupLat, $pickupLng, $destLat, $destLng);

        return [
            'polyline' => [[$pickupLat, $pickupLng], [$destLat, $destLng]],
            'distance_km' => round($distanceKm, 2),
            'duration_min' => max(5, (int) ceil($distanceKm * 3)),
            'source' => 'straight_line',
        ];
    }

    public function createRide(array $data): Order
    {
        $vehicleType = $data['vehicle_type'] ?? 'motorcycle';
        $passengerCount = (int) ($data['passenger_count'] ?? 1);

        // The server is the fare authority (spec §64): re-derive fare, distance
        // and duration from the canonical coordinates + vehicle type, ignoring
        // any client-supplied values. This guards every caller, not just book().
        foreach (['pickup_lat', 'pickup_lng', 'destination_lat', 'destination_lng'] as $field) {
            if (! isset($data[$field])) {
                throw new \InvalidArgumentException("Missing required coordinate: {$field}");
            }
        }

        $estimate = $this->estimateFare(
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['destination_lat'],
            (float) $data['destination_lng'],
        );
        $fareBlock = $estimate['fares'][$vehicleType] ?? null;
        if ($fareBlock === null) {
            throw new \InvalidArgumentException("Unknown vehicle type: {$vehicleType}");
        }

        $fare = (float) $fareBlock['fare'];
        $distanceKm = (float) $estimate['distance_km'];
        $durationMin = (int) $estimate['duration_min'];
        $riderCommission = max(20, $fare * 0.4);

        $ridePin = str_pad(random_int(1000, 9999), 4, '0', STR_PAD_LEFT);

        // Order + item + delivery must commit atomically: the item insert and the
        // delivery row are both required for the ride to reach dispatch, and a
        // partial failure previously left an orphaned order behind.
        [$order, $delivery] = DB::transaction(function () use ($data, $fare, $vehicleType, $passengerCount, $riderCommission, $ridePin, $distanceKm, $durationMin) {
            $order = Order::create([
                'order_number' => 'TRP-'.strtoupper(uniqid()),
                // Rides have no owning restaurant: a NULL business_id keeps ride
                // hailing out of business-owner order lists, dashboards, sales
                // ledgers and restaurant settlements.
                'business_id' => null,
                'user_id' => Auth::id(),
                'customer_name' => Auth::user()->fullName,
                'customer_email' => Auth::user()->email,
                'customer_phone' => $data['customer_phone'] ?? null,
                // 'transport' is the value every consumer already expects:
                // validateRiderAcceptance() and redispatchIfOffered() derive the
                // gated service from it, and TransportController/HistoryController
                // filter ride history on it.
                'order_type' => 'transport',
                'payment_method' => $data['payment_method'] ?? 'cash',
                'status' => 'pending',
                'subtotal' => $fare,
                'delivery_fee' => 0,
                'discount' => 0,
                'total' => $fare,
                'paid_amount' => 0,
            ]);

            $order->items()->create([
                'product_name' => 'Ride: '.ucfirst($vehicleType).' ('.$passengerCount.' pax)',
                'quantity' => 1,
                'unit_price' => $fare,
                'subtotal' => $fare,
            ]);

            $delivery = Delivery::create([
                'order_id' => $order->id,
                'status' => 'waiting',
                'dispatch_status' => 'waiting_for_rider',
                'pickup_address' => $data['pickup_address'] ?? '',
                'pickup_latitude' => $data['pickup_lat'],
                'pickup_longitude' => $data['pickup_lng'],
                'delivery_address' => $data['destination_address'] ?? '',
                'delivery_latitude' => $data['destination_lat'],
                'delivery_longitude' => $data['destination_lng'],
                'rider_commission' => $riderCommission,
                'notes' => json_encode([
                    'vehicle_type' => $vehicleType,
                    'passenger_count' => $passengerCount,
                    'estimated_distance_km' => $distanceKm,
                    'estimated_duration_min' => $durationMin,
                    'booking_notes' => $data['booking_notes'] ?? '',
                    'ride_pin' => $ridePin,
                    'payment_method' => $data['payment_method'] ?? 'cash',
                    'fare' => $fare,
                ]),
            ]);

            return [$order, $delivery];
        });

        try {
            $this->dispatchService->dispatchToNearest($delivery, 'transport');
        } catch (\Exception $e) {
            // Dispatch failure is non-blocking
        }

        return $order;
    }

    public function getRideStatus(Order $order): array
    {
        $order->load('delivery.rider.profile', 'delivery.rider.riderDetail', 'items');

        $delivery = $order->delivery;
        $rider = $delivery?->rider;
        $riderProfile = $rider?->profile;

        $statusMap = [
            // order-level statuses
            'pending' => 'searching',
            'confirmed' => 'searching',
            'preparing' => 'searching',
            'cancelled' => 'cancelled',
            'completed' => 'completed',
            // delivery-level statuses
            'waiting' => 'searching',
            'assigned' => 'arriving',
            'en_route_pickup' => 'arriving',
            'arrived_pickup' => 'driver_arrived',
            'picked_up' => 'in_progress',
            'in_transit' => 'in_progress',
            'en_route_destination' => 'in_progress',
            'arrived_destination' => 'completed',
            'completed' => 'completed',
            'cancelled' => 'cancelled',
        ];

        // The delivery is the authoritative live-tracking source for a ride:
        // order.status stays 'pending' for transport rides until completion, so
        // delivery-derived statuses (assigned → arrived_pickup → picked_up → …)
        // must take precedence once a delivery exists. Order-level terminal
        // states always win.
        $deliveryStatus = $delivery?->status?->value ?? 'waiting';
        $orderStatus = (string) $order->status;

        if (in_array($orderStatus, ['cancelled', 'completed'], true)) {
            $rideStatus = $statusMap[$orderStatus];
        } elseif ($delivery) {
            $rideStatus = $statusMap[$deliveryStatus] ?? $statusMap[$orderStatus] ?? 'searching';
        } else {
            $rideStatus = $statusMap[$orderStatus] ?? 'searching';
        }

        $dispatchLogs = null;
        if ($delivery) {
            $dispatchLogs = $delivery->dispatchLogs()
                ->with('rider.profile')
                ->latest()
                ->get();
        }

        $vehicleType = 'motorcycle';
        $passengerCount = 1;
        $ridePin = null;
        $paymentMethod = 'cash';
        $bookingFare = 0;
        $bookingNotes = '';
        $bookingDistance = 0;
        $bookingDuration = 0;
        if ($delivery && $delivery->notes) {
            $notes = json_decode($delivery->notes, true);
            $vehicleType = $notes['vehicle_type'] ?? 'motorcycle';
            $passengerCount = $notes['passenger_count'] ?? 1;
            $ridePin = $notes['ride_pin'] ?? null;
            $paymentMethod = $notes['payment_method'] ?? 'cash';
            $bookingFare = $notes['fare'] ?? 0;
            $bookingNotes = $notes['booking_notes'] ?? '';
            $bookingDistance = $notes['estimated_distance_km'] ?? 0;
            $bookingDuration = $notes['estimated_duration_min'] ?? 0;
        }

        $vehicleColors = [
            'motorcycle' => '#16a34a',
            'tricycle' => '#2563eb',
            'car' => '#7c3aed',
            'van' => '#ea580c',
        ];

        $riderEmergency = null;
        if ($riderProfile && isset($riderProfile->emergency_contact)) {
            $riderEmergency = $riderProfile->emergency_contact;
        }

        $orderNumber = 'TR-'.date('Y', strtotime($order->created_at)).'-'.str_pad($order->id, 6, '0', STR_PAD_LEFT);

        return [
            'order' => $order,
            'order_number' => $orderNumber,
            'delivery' => $delivery,
            'ride_status' => $rideStatus,
            'rider' => $rider,
            'rider_profile' => $riderProfile,
            'vehicle_type' => $vehicleType,
            'vehicle_color' => $vehicleColors[$vehicleType] ?? '#16a34a',
            'passenger_count' => $passengerCount,
            'ride_pin' => $ridePin,
            'payment_method' => $paymentMethod,
            'booking_fare' => $bookingFare,
            'booking_notes' => $bookingNotes,
            'booking_distance' => $bookingDistance,
            'booking_duration' => $bookingDuration,
            'rider_emergency' => $riderEmergency,
            'dispatch_logs' => $dispatchLogs,
            'pickup_lat' => $delivery?->pickup_latitude ?? 13,
            'pickup_lng' => $delivery?->pickup_longitude ?? 121.4,
            'destination_lat' => $delivery?->delivery_latitude ?? 13,
            'destination_lng' => $delivery?->delivery_longitude ?? 121.4,
            'pickup_address' => $delivery?->pickup_address ?? '',
            'destination_address' => $delivery?->delivery_address ?? '',
        ];
    }

    public function cancelRide(Order $order, ?string $reason = null): bool
    {
        if (! in_array($order->status, ['pending', 'confirmed', 'preparing'])) {
            return false;
        }

        $order->update([
            'status' => 'cancelled',
            'cancelled_by' => Auth::id(),
            'cancellation_reason' => $reason,
            'cancelled_at' => now(),
        ]);

        if ($order->delivery) {
            $order->delivery->update([
                'status' => 'cancelled',
                'dispatch_status' => null,
            ]);
        }

        return true;
    }

    /**
     * Driver-initiated cancellation of an accepted ride.
     *
     * The driver may release the trip any time BEFORE the pickup is confirmed
     * (delivery status assigned / en_route_pickup / arrived_pickup). Once the
     * ride has started (picked_up) it is governed by the delivery lifecycle and
     * may not be cancelled by the driver.
     *
     * Authoritative side effects (single transaction):
     *   - order    → cancelled (cancelled_by = driver id, cancellation_reason)
     *   - delivery → cancelled, dispatch claim released
     *   - rider    → released back to 'available' for the next offer
     *
     * After commit:
     *   - OrderStatusChanged (cancelled) → user:{userId} bridge room + the
     *     tourist's in-app Notification row via the canonical listener
     *   - notifyTripCancelled → best-effort drop of the transient socket trip
     */
    public function cancelRideByDriver(Delivery $delivery, User $rider, ?string $reason = null): array
    {
        $order = $delivery->primaryOrder();

        if (! $order || $order->order_type !== 'transport') {
            throw new \InvalidArgumentException('Only rides may be cancelled by a driver.');
        }

        if ((int) $delivery->rider_id !== (int) $rider->id) {
            throw new \InvalidArgumentException('You are not assigned to this ride.');
        }

        $deliveryStatus = $delivery->status?->value ?? $delivery->status;
        if (! in_array($deliveryStatus, ['assigned', 'en_route_pickup', 'arrived_pickup'], true)) {
            throw new \InvalidArgumentException('This ride can no longer be cancelled by the driver.');
        }

        $orderStatus = (string) $order->status;
        if (! in_array($orderStatus, ['pending', 'confirmed', 'preparing'], true)) {
            throw new \InvalidArgumentException('This ride can no longer be cancelled.');
        }

        $riderId = (int) $rider->id;

        DB::transaction(function () use ($delivery, $riderId, $reason) {
            $lockedDelivery = Delivery::lockForUpdate()->findOrFail($delivery->id);
            $lockedOrder = $lockedDelivery->primaryOrder();

            if (! $lockedOrder || $lockedOrder->order_type !== 'transport') {
                throw new \InvalidArgumentException('Only rides may be cancelled by a driver.');
            }

            $lockedDeliveryStatus = $lockedDelivery->status?->value ?? $lockedDelivery->status;
            if (! in_array($lockedDeliveryStatus, ['assigned', 'en_route_pickup', 'arrived_pickup'], true)) {
                throw new \InvalidArgumentException('This ride can no longer be cancelled by the driver.');
            }

            if (! in_array((string) $lockedOrder->status, ['pending', 'confirmed', 'preparing'], true)) {
                throw new \InvalidArgumentException('This ride can no longer be cancelled.');
            }

            $lockedOrder->update([
                'status' => 'cancelled',
                'cancelled_by' => $riderId,
                'cancellation_reason' => $reason ?: 'Driver cancelled the ride.',
                'cancelled_at' => now(),
            ]);

            $lockedDelivery->update([
                'status' => 'cancelled',
                'dispatch_status' => null,
            ]);

            User::where('id', $riderId)->first()?->riderDetail()?->updateOrCreate(
                ['user_id' => $riderId],
                ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
            );
        });

        // Emit after the transaction commits: bridges to user:{userId} and
        // persists the tourist's ride-cancelled Notification row.
        OrderStatusChanged::dispatch($order->fresh(), $orderStatus, 'cancelled', $rider);

        // Best effort: ask the socket engine to drop the transient trip room.
        try {
            app(WebsocketNotifierService::class)->notifyTripCancelled($delivery->id, $riderId);
        } catch (\Throwable $e) {
            // Best effort — MySQL remains authoritative.
        }

        return [
            'status' => 'cancelled',
            'cancelled_by' => $riderId,
            'cancelled_at' => now()->toIso8601String(),
        ];
    }

    private function calculateDistance(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) * sin($dLat / 2) +
             cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
             sin($dLng / 2) * sin($dLng / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadius * $c;
    }
}
